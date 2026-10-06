"use client";

import { useEffect } from "react";
import type { AmountKey } from "./amount-input";

/**
 * Physical keyboard → numpad while the amount screen is in front (digits,
 * comma/period, Backspace). Keys typed into a real field are left alone.
 */
export function useAmountKeyboard(enabled: boolean, pressKey: (k: AmountKey) => void) {
    useEffect(() => {
        if (!enabled) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
            if (/^[0-9]$/.test(e.key)) pressKey(e.key as AmountKey);
            else if (e.key === "," || e.key === ".") pressKey(",");
            else if (e.key === "Backspace") pressKey("del");
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [enabled, pressKey]);
}
