"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Count graphemes (mirror of the server's Intl.Segmenter check). */
function graphemeCount(s: string): number {
    const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (Seg) return [...new Seg("es", { granularity: "grapheme" }).segment(s)].length;
    return [...s].length;
}

/** Whether a string is exactly one grapheme cluster (matches server validation). */
export function isSingleGrapheme(s: string): boolean {
    const t = s.trim();
    return t.length > 0 && graphemeCount(t) === 1;
}

// Curated quick-pick set — one grapheme each.
const EMOJI_PRESETS = [
    "🛍️", "🍕", "🏠", "💡", "🚗", "🎬", "💊", "📦",
    "🍔", "☕", "🍷", "🎁", "👕", "✈️", "⛽", "🎮",
    "🎵", "🐶", "🐱", "💇", "🏋️", "📚", "🎓", "💳",
    "💰", "🎉", "🌱", "🧾", "🚿", "📱", "💻", "🎸",
];

interface EmojiPickerProps {
    value: string;
    onChange: (emoji: string) => void;
}

/** Emoji sub-picker: a curated grid plus a single-grapheme free input. */
export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
    const [custom, setCustom] = useState("");

    const applyCustom = (raw: string) => {
        setCustom(raw);
        if (isSingleGrapheme(raw)) onChange(raw.trim());
    };

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
                {EMOJI_PRESETS.map((e) => (
                    <button
                        key={e}
                        type="button"
                        onClick={() => onChange(e)}
                        aria-pressed={value === e}
                        aria-label={`Emoji ${e}`}
                        className={cn(
                            "h-9 w-9 rounded-lg text-lg flex items-center justify-center border transition-all active:scale-90",
                            value === e
                                ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]"
                                : "bg-card border-[color:var(--line)] hover:bg-secondary",
                        )}
                    >
                        {e}
                    </button>
                ))}
            </div>
            <input
                type="text"
                value={custom}
                onChange={(e) => applyCustom(e.target.value)}
                placeholder="…u otro emoji"
                aria-label="Emoji personalizado"
                className="w-full bg-card border border-[color:var(--line)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[color:var(--accent-border)]"
            />
        </div>
    );
}
