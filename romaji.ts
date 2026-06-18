/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lookupCompound } from "./compounds";
import { toRomaji } from "./kana";
import { getKanjiReading, lookupKanji, lookupNameOverride } from "./kanji";

const japaneseRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const kanaRegex = /[\u3040-\u30ff]/;
const hiraganaRegex = /[\u3040-\u309f]/;
const smallKanaRegex = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/;
const kanjiRegex = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const charOverrides: Record<string, string> = {
    "を": "o",
};

const forceOnKanji = new Set(["僕", "図", "気", "本"]);

// Kanji that prefer on'yomi when at end of a word (name suffixes, etc.)
const suffixKanji = new Set(["君", "様", "殿", "氏"]);

// Individual hiragana characters that act as grammatical particles (not okurigana)
const particles = new Set(["は", "が", "を", "に", "で", "へ", "の", "も", "と", "や", "か", "ね", "よ", "な", "ぞ", "ぜ", "わ", "さ"]);

// Known rendaku (sequential voicing) compounds: prefix kanji + target kanji → overridden kana reading
const compoundReadings: Record<string, string> = {
    "頑張": "ば",
    "手伝": "つだ",
    "友達": "だち",
};

export function containsJapanese(text: string): boolean {
    return japaneseRegex.test(text);
}

function isSmallKana(char: string): boolean {
    return smallKanaRegex.test(char);
}

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Renders compound text/name override: each kanji gets its own hoverable ruby,
 * non-kanji chars are plain text, and the reading is shown below in ruby-annotation style.
 */
function renderCompoundHtml(matchText: string, reading: string): string {
    let inner = "";
    for (const ch of matchText) {
        if (kanjiRegex.test(ch)) {
            inner += `<ruby data-kanji="${ch}">${ch}</ruby>`;
        } else {
            inner += escapeHtml(ch);
        }
    }
    return "<span style=\"display:inline-flex;flex-direction:column;align-items:center;vertical-align:top;line-height:1.3\">" +
        `<span>${inner}</span>` +
        `<span style="font-size:var(--jp-ruby-font-size,0.75em);line-height:1.1;opacity:0.65;display:block;text-align:center;letter-spacing:0">${reading}</span></span>`;
}

function getCharReading(char: string, nextChar: string, isLastInBlock: boolean): string {
    if (charOverrides[char]) return charOverrides[char];

    if (char === "は" && (isLastInBlock || !kanaRegex.test(nextChar)))
        return "wa";
    if (char === "へ" && (isLastInBlock || !kanaRegex.test(nextChar)))
        return "e";

    if (char === "っ" || char === "ッ") {
        if (!nextChar || !kanaRegex.test(nextChar)) return "っ";
        const nextReading = toRomaji(nextChar);
        return nextReading ? nextReading[0] : "っ";
    }

    const reading = toRomaji(char);
    return reading || char;
}

export interface RenderOptions {
    annotateKanji?: boolean;
    annotateKana?: boolean;
    readingPreference?: "kun" | "on";
}

export function renderRubyText(text: string, options: RenderOptions = {}): string {
    const {
        annotateKanji = true,
        annotateKana = true,
        readingPreference = "kun",
    } = options;

    let result = "";
    let i = 0;

    while (i < text.length) {
        const char = text[i];

        if (japaneseRegex.test(char)) {
            const nameMatch = lookupNameOverride(text, i);
            if (nameMatch) {
                if (!annotateKana && !annotateKanji) {
                    result += escapeHtml(nameMatch.name);
                } else {
                    result += renderCompoundHtml(nameMatch.name, nameMatch.reading);
                }
                i += nameMatch.name.length;
                continue;
            }

            const jpStart = i;
            while (i < text.length && japaneseRegex.test(text[i])) {
                if (i + 1 < text.length && isSmallKana(text[i + 1])) {
                    i += 2;
                } else {
                    i += 1;
                }
            }
            const jpBlock = text.slice(jpStart, i);
            const isLast = i >= text.length || !japaneseRegex.test(text[i]);

            for (let j = 0; j < jpBlock.length; j++) {
                const c = jpBlock[j];
                const next = j + 1 < jpBlock.length ? jpBlock[j + 1] : "";
                const isLastInBlock = j === jpBlock.length - 1 && isLast;

                if (j + 1 < jpBlock.length && isSmallKana(jpBlock[j + 1])) {
                    const digraph = c + jpBlock[j + 1];
                    if (annotateKana) {
                        const reading = toRomaji(digraph);
                        result += reading && reading !== digraph
                            ? `<ruby>${digraph}<rt>${reading}</rt></ruby>`
                            : escapeHtml(digraph);
                    } else {
                        result += escapeHtml(digraph);
                    }
                    j++;
                } else if (kanaRegex.test(c)) {
                    if (annotateKana) {
                        const reading = getCharReading(c, next, isLastInBlock);
                        result += reading !== c
                            ? `<ruby>${c}<rt>${reading}</rt></ruby> `
                            : escapeHtml(c);
                    } else {
                        result += escapeHtml(c);
                    }
                } else {
                    if (annotateKanji) {
                        // 1. Check for compound word starting at this position
                        const compound = lookupCompound(jpBlock, j);
                        if (compound) {
                            // Try to split compound reading per-character by matching all possible readings
                            const perCharReadings: string[] = [];
                            let remaining = compound.reading;
                            let canSplit = true;
                            for (let ci = 0; ci < compound.match.length; ci++) {
                                const ch = compound.match[ci];
                                const candidates: string[] = [];
                                if (kanjiRegex.test(ch)) {
                                    if (ci > 0) {
                                        const pairKana = compoundReadings[compound.match[ci - 1] + ch];
                                        if (pairKana) candidates.push(toRomaji(pairKana));
                                    }
                                    const dictEntry = lookupKanji(ch);
                                    if (dictEntry) {
                                        for (const on of dictEntry.on) candidates.push(toRomaji(on));
                                        for (const kun of dictEntry.kun) {
                                            const dot = kun.lastIndexOf(".");
                                            const stem = dot >= 0 ? kun.slice(0, dot) : kun;
                                            candidates.push(toRomaji(stem));
                                        }
                                    }
                                } else {
                                    candidates.push(toRomaji(ch));
                                }
                                let matched = "";
                                for (const candidate of candidates) {
                                    if (candidate && remaining.startsWith(candidate)) {
                                        matched = candidate;
                                        break;
                                    }
                                }
                                if (!matched) { canSplit = false; break; }
                                perCharReadings.push(matched);
                                remaining = remaining.slice(matched.length);
                            }
                            if (canSplit && remaining === "") {
                                for (let k = 0; k < compound.match.length; k++) {
                                    const ch = compound.match[k];
                                    const reading = perCharReadings[k];
                                    if (kanjiRegex.test(ch)) {
                                        result += `<ruby data-kanji="${ch}">${ch}<rt>${reading}</rt></ruby> `;
                                    } else if (kanaRegex.test(ch) && annotateKana) {
                                        result += `<ruby>${ch}<rt>${reading}</rt></ruby> `;
                                    } else {
                                        result += escapeHtml(ch);
                                    }
                                }
                            } else {
                                result += renderCompoundHtml(compound.match, compound.reading);
                            }
                            j += compound.match.length - 1;
                            continue;
                        }

                        // 2. Collect okurigana (consecutive hiragana after this kanji)
                        let okurigana = "";
                        let k = j + 1;
                        while (k < jpBlock.length && hiraganaRegex.test(jpBlock[k])) {
                            okurigana += jpBlock[k];
                            k++;
                        }

                        // 3. If the collected hiragana are entirely grammatical particles, it's not okurigana
                        if (okurigana && [...okurigana].every(ch => particles.has(ch))) {
                            okurigana = "";
                        }

                        // 4. Determine reading preference
                        const nextIsKana = !!okurigana;
                        const nextNext = okurigana ? okurigana[0] : (jpBlock[j + 1] || "");
                        const nextIsKanji = nextNext && japaneseRegex.test(nextNext) && !kanaRegex.test(nextNext);
                        let pref: "kun" | "on" = nextIsKana ? "kun" : nextIsKanji ? "on" : readingPreference;
                        if (c === "歳" && /[0-9]/.test(text[jpStart + j - 1] || "")) pref = "on";
                        if (forceOnKanji.has(c)) pref = "on";

                        // 5. Compute reading via compound override → suffix → dictionary
                        let reading: string | undefined;
                        if (j > 0) {
                            const compoundKana = compoundReadings[jpBlock[j - 1] + c];
                            if (compoundKana) reading = toRomaji(compoundKana);
                        }
                        if (!reading && suffixKanji.has(c) && j > 0 && !okurigana && j === jpBlock.length - 1) {
                            reading = getKanjiReading(c, "on");
                        }
                        if (!reading) reading = getKanjiReading(c, pref, okurigana || undefined);

                        if (reading) {
                            result += `<ruby data-kanji="${c}">${c}<rt>${reading}</rt></ruby> `;
                        } else {
                            result += escapeHtml(c);
                        }
                    } else {
                        result += escapeHtml(c);
                    }
                }
            }
        } else {
            let end = i;
            while (end < text.length && !japaneseRegex.test(text[end])) {
                end++;
            }
            result += escapeHtml(text.slice(i, end));
            i = end;
        }
    }

    return result;
}
