"use client";

import { ICON_KEYS, getIconComponent } from "@/lib/category-icons";
import { cn } from "@/lib/utils";

interface IconPickerProps {
    value: string;
    onChange: (iconName: string) => void;
    /** Accent color for the selected icon (defaults to the theme primary). */
    hex?: string;
}

/**
 * Icon sub-picker: offers exactly the ICON_REGISTRY keys (the single source the
 * server also validates against). Icons render via `getIconComponent`, never a
 * lucide import here.
 */
export function IconPicker({ value, onChange, hex }: IconPickerProps) {
    return (
        <div className="grid grid-cols-8 gap-1.5">
            {ICON_KEYS.map((name) => {
                const Icon = getIconComponent(name);
                const selected = value === name;
                return (
                    <button
                        key={name}
                        type="button"
                        onClick={() => onChange(name)}
                        aria-pressed={selected}
                        aria-label={`Icono ${name}`}
                        className={cn(
                            "aspect-square rounded-lg flex items-center justify-center border transition-all active:scale-90",
                            selected
                                ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)]"
                                : "bg-card border-[color:var(--line)] hover:bg-secondary",
                        )}
                    >
                        <Icon
                            className="h-4 w-4"
                            style={selected && hex ? { color: hex } : undefined}
                        />
                    </button>
                );
            })}
        </div>
    );
}
