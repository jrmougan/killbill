"use client";

import { cn } from "@/lib/utils";
import { SETTLE_METHODS, methodName, type SettleMethod } from "./settle-model";

/**
 * "¿Cómo?" — three method tiles (Bizum / Transfer. / Efectivo). Native radio
 * inputs (visually hidden) give radio-group semantics and arrow-key navigation
 * for free; the tile is the label. Selected = 2px green border.
 */
export function MethodPicker({
    value,
    onChange,
    label = "¿Cómo?",
    disabled,
}: {
    value: SettleMethod;
    onChange: (m: SettleMethod) => void;
    label?: string;
    disabled?: boolean;
}) {
    return (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
            <legend className="text-xs font-semibold text-muted-foreground mb-2">{label}</legend>
            <div className="grid grid-cols-3 gap-2 text-sm font-semibold">
                {SETTLE_METHODS.map((m) => {
                    const selected = m.value === value;
                    return (
                        <label
                            key={m.value}
                            className={cn(
                                "relative h-12 rounded-[14px] bg-card flex items-center justify-center cursor-pointer transition-colors",
                                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                                "has-[:disabled]:opacity-40 has-[:disabled]:cursor-default",
                                selected ? "border-2 border-primary" : "border border-[color:var(--line)]"
                            )}
                        >
                            <input
                                type="radio"
                                name="settle-method"
                                value={m.value}
                                checked={selected}
                                onChange={() => onChange(m.value)}
                                aria-label={methodName(m.value)}
                                className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
                            />
                            {m.label}
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
