"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Scope } from "@/lib/scope";

const OPTIONS: { key: Scope; label: string }[] = [
    { key: "todo", label: "Todo" },
    { key: "comun", label: "Común" },
    { key: "personal", label: "Personal" },
];

/**
 * Persistent [Todo · Común · Personal] scope switcher. The scope is a lens, not a
 * destination — it lives in the ?scope= URL param so it survives navigation and can
 * be read server-side. Reused across the home (and, later, budgets/analytics).
 */
export function ScopeSegment({ scope }: { scope: Scope }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const select = (next: Scope) => {
        const params = new URLSearchParams(searchParams.toString());
        if (next === "todo") params.delete("scope");
        else params.set("scope", next);
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    return (
        <div className="flex gap-1.5 p-1 rounded-xl bg-white/5 border border-white/5">
            {OPTIONS.map(({ key, label }) => (
                <button
                    key={key}
                    type="button"
                    onClick={() => select(key)}
                    aria-pressed={scope === key}
                    className={cn(
                        "flex-1 h-10 rounded-lg text-sm font-semibold transition-all active:scale-[0.98]",
                        scope === key ? "bg-primary text-white shadow" : "text-muted-foreground"
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}
