"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActivateSpace } from "./use-activate-space";

export type SpaceRowData = {
    key: string;
    emoji: string;
    name: string;
    sub: string;
    /** "+12,00 €" / "−5,00 €" / "En paz" / "" */
    bal: string;
    tone: "positive" | "negative" | "neutral";
    /** `/spaces/[id]` management page (shared spaces only). */
    manageHref?: string;
    archived?: boolean;
};

/**
 * Espacios list (prototype `is.espacios`): tap a row to make it the active
 * space and go back to Inicio; the chevron opens the space's management page.
 */
export function SpacesList({ rows, activeKey }: { rows: SpaceRowData[]; activeKey: string }) {
    const { activate, pending } = useActivateSpace();
    return (
        <ul className="flex flex-col gap-2.5">
            {rows.map((r) => {
                const active = r.key === activeKey;
                return (
                    <li
                        key={r.key}
                        data-testid="space-row"
                        data-active={active ? "true" : undefined}
                        className={cn(
                            "rounded-[18px] bg-card flex items-center",
                            active ? "border-2 border-primary" : "border border-[color:var(--line)]",
                            r.archived && "opacity-70",
                        )}
                    >
                        <button
                            type="button"
                            disabled={pending}
                            onClick={() => activate(r.key)}
                            aria-current={active ? "true" : undefined}
                            aria-label={`${r.name}. ${r.sub}${r.bal ? `. ${r.bal}` : ""}${active ? ". Activo" : ""}`}
                            className={cn(
                                "flex-1 min-w-0 flex items-center gap-3 text-left disabled:opacity-60",
                                active ? "py-[13px] pl-[15px]" : "py-3.5 pl-4",
                                !r.manageHref && (active ? "pr-[15px]" : "pr-4"),
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className={cn(
                                    "h-11 w-11 flex-none rounded-[14px] flex items-center justify-center text-xl",
                                    active ? "bg-[var(--accent-tint)]" : "bg-[var(--track)]",
                                    r.archived && "grayscale",
                                )}
                            >
                                {r.emoji}
                            </span>
                            <span className="flex-1 min-w-0" aria-hidden="true">
                                <span className="block text-[15px] font-semibold truncate">{r.name}</span>
                                <span className="block text-[12.5px] text-muted-foreground truncate">{r.sub}</span>
                            </span>
                            {r.bal && (
                                <span
                                    aria-hidden="true"
                                    className={cn(
                                        "flex-none text-[15px] font-bold tabular-nums",
                                        r.tone === "positive" && "text-[color:var(--positive)]",
                                        r.tone === "negative" && "text-[color:var(--negative)]",
                                        r.tone === "neutral" && "text-muted-foreground",
                                    )}
                                >
                                    {r.bal}
                                </span>
                            )}
                        </button>
                        {r.manageHref && (
                            <Link
                                href={r.manageHref}
                                aria-label={`Gestionar ${r.name}`}
                                className="flex-none self-stretch flex items-center px-3 text-[color:var(--ink-4)] hover:text-foreground"
                            >
                                <ChevronRight className="h-5 w-5" />
                            </Link>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
