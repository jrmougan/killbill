"use client";

import { Delete } from "lucide-react";
import type { AmountKey } from "./amount-input";

const KEYS: AmountKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "del"];

/** On-screen 3×4 numpad (prototype `is.add`). Pure presentational. */
export function Numpad({ onKey }: { onKey: (k: AmountKey) => void }) {
    return (
        <fieldset aria-label="Teclado numérico" className="m-0 min-w-0 border-0 p-0 grid grid-cols-3 px-5 text-2xl font-medium text-center">
            {KEYS.map((k) => (
                <button
                    key={k}
                    type="button"
                    data-testid={`numpad-${k === "," ? "comma" : k}`}
                    aria-label={k === "del" ? "Borrar" : k === "," ? "Coma decimal" : k}
                    onClick={() => onKey(k)}
                    className="h-[50px] flex items-center justify-center rounded-[14px] select-none tabular-nums transition-colors active:bg-[var(--track)] [@media(hover:hover)]:hover:bg-[var(--track)]"
                >
                    {k === "del" ? <Delete className="h-6 w-6" aria-hidden /> : k}
                </button>
            ))}
        </fieldset>
    );
}
