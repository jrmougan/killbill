"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * "Común | Personal" picker built on native radio inputs: one tab stop and
 * arrow-key navigation come from the browser, and screen readers announce a
 * real radio group. Styled as the EQUIL segmented track. Used by the new-list
 * sheet, Etiquetas and Categorías.
 */
export function ScopeRadio({
    label,
    personal,
    onChange,
    sharedDisabled = false,
    sharedLabel = "Común",
    personalLabel = "Personal",
    className,
}: {
    /** Accessible name of the group ("Para", "Ámbito"). */
    label: string;
    personal: boolean;
    onChange: (personal: boolean) => void;
    /** e.g. an archived space: "Común" is shown but cannot be chosen. */
    sharedDisabled?: boolean;
    sharedLabel?: string;
    personalLabel?: string;
    className?: string;
}) {
    const name = useId();
    const options = [
        { personal: false, label: sharedLabel, disabled: sharedDisabled },
        { personal: true, label: personalLabel, disabled: false },
    ];
    return (
        <fieldset className={cn("m-0 min-w-0 border-0 p-0", className)}>
            <legend className="sr-only">{label}</legend>
            <div className="flex rounded-xl bg-[var(--track)] p-[3px]">
                {options.map((o) => {
                    const checked = o.personal === personal;
                    return (
                        <label
                            key={o.label}
                            className={cn(
                                "relative flex-1 min-h-[40px] flex items-center justify-center rounded-[10px] py-2 text-sm font-semibold transition-colors cursor-pointer",
                                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                                checked ? "bg-card text-foreground" : "text-muted-foreground",
                                o.disabled && "opacity-40 cursor-not-allowed",
                            )}
                        >
                            <input
                                type="radio"
                                name={name}
                                checked={checked}
                                disabled={o.disabled}
                                onChange={() => onChange(o.personal)}
                                // Covers the pill so taps and Playwright clicks hit the input itself.
                                className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
                            />
                            {o.label}
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
