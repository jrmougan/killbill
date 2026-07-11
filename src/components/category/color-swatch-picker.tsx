"use client";

import { Check } from "lucide-react";
import { CATEGORY_PALETTE } from "@/lib/category-colors";
import { cn } from "@/lib/utils";

interface ColorSwatchPickerProps {
    value: string;
    onChange: (hex: string) => void;
}

/**
 * Closed-palette color picker (decision #8). Offers exactly `CATEGORY_PALETTE`
 * — the same curated set the server validates membership against; no free-form
 * hex in V1. Swatches render inline via the hex value.
 */
export function ColorSwatchPicker({ value, onChange }: ColorSwatchPickerProps) {
    const selected = value.toLowerCase();
    return (
        <div className="flex flex-wrap gap-2">
            {CATEGORY_PALETTE.map((hex) => {
                const isSel = selected === hex.toLowerCase();
                return (
                    <button
                        key={hex}
                        type="button"
                        onClick={() => onChange(hex)}
                        aria-pressed={isSel}
                        aria-label={`Color ${hex}`}
                        className={cn(
                            "h-8 w-8 rounded-full border-2 flex items-center justify-center transition-transform active:scale-90",
                            isSel ? "border-foreground scale-110" : "border-transparent",
                        )}
                        style={{ backgroundColor: hex }}
                    >
                        {isSel && <Check className="h-4 w-4 text-white drop-shadow" />}
                    </button>
                );
            })}
        </div>
    );
}
