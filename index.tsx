/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { useLayoutEffect, useRef, useState } from "@webpack/common";

import { loadKanaMap, toRomaji } from "./kana";
import type { KanjiInfo } from "./kanji";
// eslint-disable-next-line no-duplicate-imports
import { isDictReady, loadDict, lookupKanji, onReady } from "./kanji";
import type { RenderOptions } from "./romaji";
// eslint-disable-next-line no-duplicate-imports
import { containsJapanese, escapeHtml, renderRubyText } from "./romaji";

const settings = definePluginSettings({
    annotateKanji: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show romaji readings under kanji characters",
    },
    annotateKana: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show romaji readings under kana characters",
    },
    showTooltip: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show kanji info tooltip on hover",
    },
    readingPreference: {
        type: OptionType.SELECT,
        default: "kun",
        description: "Preferred reading for kanji",
        options: [
            { label: "Kun'yomi (訓読み)", value: "kun" },
            { label: "On'yomi (音読み)", value: "on" },
        ],
    },
    rubyFontSize: {
        type: OptionType.NUMBER,
        default: 75,
        description: "Ruby annotation font size (%)",
        isValid: (v: number) => v >= 30 && v <= 200,
    },
    annotateUsernames: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show romaji readings under Japanese usernames in chat",
    },
    tooltipFontSize: {
        type: OptionType.NUMBER,
        default: 85,
        description: "Tooltip font size (%)",
        isValid: (v: number) => v >= 50 && v <= 200,
    },
    dictUrl: {
        type: OptionType.STRING,
        default: "https://raw.githubusercontent.com/RaylaValdez/jp-kanji/refs/heads/main/kanji.json",
        description: "URL to fetch the kanji dictionary JSON from",
    },
    kanaUrl: {
        type: OptionType.STRING,
        default: "https://raw.githubusercontent.com/RaylaValdez/jp-kanji/refs/heads/main/kana.json",
        description: "URL to fetch the kana→romaji mapping JSON from",
    },
});

interface RubyAnnotatorProps {
    message?: {
        content?: string;
    };
}

interface TooltipState {
    x: number;
    y: number;
    kanji: string;
    info: KanjiInfo;
}

let sharedTooltipEl: HTMLDivElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function stripOkurigana(reading: string): string {
    const dot = reading.lastIndexOf(".");
    return dot >= 0 ? reading.slice(0, dot) : reading;
}

function tooltipHTML(state: TooltipState): string {
    const { kanji, info } = state;
    const jishoUrl = `https://jisho.org/search/${encodeURIComponent(kanji)}%20%23kanji`;
    let html = `<div class="jp-kanji-tooltip-char"><a href="${jishoUrl}" target="_blank" rel="noopener noreferrer" class="jp-kanji-link">${escapeHtml(kanji)}</a></div>`;
    if (info.kun.length > 0) {
        html += "<div class=\"jp-kanji-tooltip-row\"><span class=\"jp-kanji-tooltip-label\">訓</span><span>";
        html += info.kun.map(r => {
            const stem = stripOkurigana(r);
            const romaji = toRomaji(stem);
            return `<ruby>${stem}<rt>${romaji}</rt></ruby>`;
        }).join("、");
        html += "</span></div>";
    }
    if (info.on.length > 0) {
        html += "<div class=\"jp-kanji-tooltip-row\"><span class=\"jp-kanji-tooltip-label\">音</span><span>";
        html += info.on.map(r => {
            const romaji = toRomaji(r);
            return `<ruby>${r}<rt>${romaji}</rt></ruby>`;
        }).join("");
        html += "</span></div>";
    }
    html += `<div class="jp-kanji-tooltip-row" style="opacity:0.7"><span>${info.meanings.join(", ")}</span></div>`;
    return html;
}

function scheduleHide() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
        hideTooltip();
        hideTimeout = null;
    }, 500);
}

function cancelHide() {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
}

function showTooltip(state: TooltipState) {
    if (!sharedTooltipEl || !document.body.contains(sharedTooltipEl)) {
        sharedTooltipEl = document.createElement("div");
        sharedTooltipEl.className = "jp-kanji-tooltip";
        sharedTooltipEl.addEventListener("mouseenter", cancelHide);
        sharedTooltipEl.addEventListener("mouseleave", scheduleHide);
        document.body.appendChild(sharedTooltipEl);
    }
    sharedTooltipEl.style.cssText = `
        position: fixed;
        left: ${state.x}px;
        top: ${state.y}px;
        transform: translateY(-100%);
        z-index: 1000;
        pointer-events: auto;
        font-size: ${settings.store.tooltipFontSize / 100}em;
    `;
    sharedTooltipEl.innerHTML = tooltipHTML(state);
    cancelHide();
}

function hideTooltip() {
    if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
    }
    if (sharedTooltipEl) {
        sharedTooltipEl.remove();
        sharedTooltipEl = null;
    }
}

const RubyAnnotator: React.FC<RubyAnnotatorProps> = ({ message }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [dictReady, setDictReady] = useState(isDictReady);

    useLayoutEffect(() => {
        loadDict(settings.store.dictUrl);
        loadKanaMap(settings.store.kanaUrl);
        onReady(() => setDictReady(true));
    }, []);

    const { annotateKanji, annotateKana, readingPreference, rubyFontSize } = settings.store;

    useLayoutEffect(() => {
        if (!ref.current) return;
        const container = ref.current.parentElement;
        if (!container) return;

        const existing = container.querySelectorAll("[data-jp-ruby]");
        for (const span of existing) {
            const original = span.getAttribute("data-original-text") ?? span.textContent ?? "";
            const text = document.createTextNode(original);
            span.parentNode?.replaceChild(text, span);
        }

        const content = message?.content;
        if (!content || !containsJapanese(content)) return;

        if (!annotateKanji && !annotateKana) return;

        const renderOptions: RenderOptions = {
            annotateKanji: dictReady && annotateKanji,
            annotateKana,
            readingPreference: readingPreference as "kun" | "on",
        };

        container.style.setProperty("--jp-ruby-font-size", `${rubyFontSize / 100}em`);

        const walker = document.createTreeWalker(
            container,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (ref.current?.contains(node))
                        return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        const modifications: Array<{ node: Text; html: string; }> = [];
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            const text = node.textContent || "";
            if (!containsJapanese(text)) continue;
            modifications.push({ node, html: renderRubyText(text, renderOptions) });
        }

        for (const { node, html } of modifications) {
            const span = document.createElement("span");
            span.setAttribute("data-jp-ruby", "");
            span.setAttribute("data-original-text", node.textContent ?? "");
            span.innerHTML = html;
            node.parentNode?.replaceChild(span, node);
        }

        const handleKanjiEnter = (e: Event) => {
            if (!settings.store.showTooltip) return;
            const el = e.currentTarget as HTMLElement;
            const char = el.getAttribute("data-kanji") || "";
            const info = lookupKanji(char);
            if (info) {
                cancelHide();
                const mx = (e as MouseEvent).clientX;
                const my = (e as MouseEvent).clientY;
                showTooltip({
                    x: Math.min(mx, window.innerWidth - 160),
                    y: Math.max(40, my),
                    kanji: char,
                    info,
                });
            }
        };
        const handleKanjiLeave = () => scheduleHide();

        const kanjiEls = container.querySelectorAll("[data-kanji]");
        kanjiEls.forEach(el => {
            el.addEventListener("mouseenter", handleKanjiEnter);
            el.addEventListener("mouseleave", handleKanjiLeave);
        });

        return () => {
            kanjiEls.forEach(el => {
                el.removeEventListener("mouseenter", handleKanjiEnter);
                el.removeEventListener("mouseleave", handleKanjiLeave);
            });
        };
    }, [message?.content, dictReady, annotateKanji, annotateKana, readingPreference, rubyFontSize]);

    return <div ref={ref} style={{ display: "none" }} />;
};

const UsernameAnnotator: React.FC<{ name: string; }> = ({ name }) => {
    const [dictReady, setDictReady] = useState(isDictReady);

    useLayoutEffect(() => {
        onReady(() => setDictReady(true));
    }, []);

    const renderOptions: RenderOptions = {
        annotateKanji: dictReady && settings.store.annotateKanji,
        annotateKana: settings.store.annotateKana,
        readingPreference: settings.store.readingPreference as "kun" | "on",
    };

    const handleOver = (e: React.MouseEvent<HTMLSpanElement>) => {
        const target = (e.target as HTMLElement).closest("[data-kanji]");
        if (!target || !settings.store.showTooltip) return;
        const char = target.getAttribute("data-kanji") || "";
        const info = lookupKanji(char);
        if (info) {
            cancelHide();
            showTooltip({
                x: Math.min(e.clientX, window.innerWidth - 160),
                y: Math.max(40, e.clientY),
                kanji: char,
                info,
            });
        }
    };
    const handleLeave = () => scheduleHide();

    return (
        <span
            data-jp-ruby=""
            onMouseOver={handleOver}
            onMouseLeave={handleLeave}
            dangerouslySetInnerHTML={{
                __html: renderRubyText(name, renderOptions)
            }}
        />
    );
};

export default definePlugin({
    name: "JapaneseToRomaji",
    description: "Shows romaji under Japanese characters in messages",
    tags: ["Chat"],
    authors: [{
        name: "gerry_of_ravine",
        id: 294899635292602379n
    }],

    settings,

    start() {
        console.log("[JapaneseToRomaji] Loaded!");
    },

    patches: [
        {
            find: ".SEND_FAILED,",
            replacement: {
                match: /\]:\i.isUnsupported.{0,20}?,children:\[/,
                replace: "$&arguments[0]?.message?.content&&$self.RubyAnnotation({message: arguments[0].message}),"
            }
        },
        {
            find: '="SYSTEM_TAG"',
            replacement: {
                match: /(?<=onContextMenu:\i,children:)\i\?(?=.{0,100}?user[Nn]ame:)/,
                replace: "$self.UsernameAnnotation(arguments[0]),_oldChildren:$&"
            }
        }
    ],

    RubyAnnotation: ErrorBoundary.wrap(RubyAnnotator),

    UsernameAnnotation(props: any) {
        try {
            let name = typeof props._oldChildren === "string" ? props._oldChildren : "";

            if (!name) {
                const nick = props.author?.nick;
                const user = props.message?.author;
                name = nick || user?.globalName || user?.username || "";
            }

            if (!name) return null;
            if (!settings.store.annotateUsernames || !containsJapanese(name)) return name;

            return <UsernameAnnotator name={name} />;
        } catch {
            return null;
        }
    },
});
