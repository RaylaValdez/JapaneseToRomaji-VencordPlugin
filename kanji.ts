/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Source: scriptin/jmdict-simplified (kanjidic2-en)

import { toRomaji } from "./kana";

export interface KanjiInfo {
    on: string[];
    kun: string[];
    meanings: string[];
}

interface KanjiDataEntry {
    o: string[];
    k: string[];
    m: string[];
}

let kanjiDict: Record<string, KanjiDataEntry> = {};

export let isDictReady = false;

const readyCallbacks: Array<() => void> = [];

const nameOverrides: Record<string, string> = {
    "天道 剣": "Tendou Tsurugi",
};

export function lookupNameOverride(text: string, pos: number): { name: string; reading: string; } | null {
    const remaining = text.slice(pos);
    for (const [name, reading] of Object.entries(nameOverrides)) {
        if (remaining.startsWith(name)) {
            return { name, reading };
        }
    }
    return null;
}

export function onReady(cb: () => void) {
    if (isDictReady) {
        cb();
    } else {
        readyCallbacks.push(cb);
    }
}

export async function loadDict(url: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        kanjiDict = await res.json();
        isDictReady = true;
        readyCallbacks.splice(0).forEach(cb => cb());
    } catch (e) {
        console.error("[JapaneseToRomaji] Failed to load kanji dict:", e);
        setTimeout(() => loadDict(url), 30_000);
    }
}

function stripOkurigana(reading: string): string {
    const dot = reading.lastIndexOf(".");
    return dot >= 0 ? reading.slice(0, dot) : reading;
}

const readingCache = new Map<string, string>();

export function lookupKanji(char: string): KanjiInfo | undefined {
    const entry = kanjiDict[char];
    if (!entry) return undefined;
    return {
        on: entry.o || [],
        kun: entry.k || [],
        meanings: entry.m || [],
    };
}

export function getKanjiReading(char: string, preference: "kun" | "on" = "kun", okurigana?: string): string {
    if (!isDictReady) return "";

    const key = char + preference + (okurigana || "");
    const cached = readingCache.get(key);
    if (cached !== undefined) return cached;

    const raw = kanjiDict[char];
    if (!raw) {
        readingCache.set(key, "");
        return "";
    }
    const info = { o: raw.o || [], k: raw.k || [], m: raw.m || [] };

    if (preference === "on") {
        if (info.o.length > 0) {
            const reading = toRomaji(info.o[0]);
            readingCache.set(key, reading);
            return reading;
        }
        if (info.k.length > 0) {
            const stem = stripOkurigana(info.k[0]);
            const reading = toRomaji(stem);
            readingCache.set(key, reading);
            return reading;
        }
    } else {
        if (info.k.length > 0) {
            if (okurigana) {
                const matched = info.k.find(r => {
                    const dot = r.lastIndexOf(".");
                    return dot >= 0 && r.slice(dot + 1) === okurigana;
                });
                if (matched) {
                    const stem = matched.slice(0, matched.lastIndexOf("."));
                    const reading = toRomaji(stem);
                    readingCache.set(key, reading);
                    return reading;
                }
            }
            const stem = stripOkurigana(info.k[0]);
            const reading = toRomaji(stem);
            readingCache.set(key, reading);
            return reading;
        }
        if (info.o.length > 0) {
            const reading = toRomaji(info.o[0]);
            readingCache.set(key, reading);
            return reading;
        }
    }

    readingCache.set(key, "");
    return "";
}
