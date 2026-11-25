"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { JoinLinkForm } from "./join-link-form";

/**
 * "Crear espacio" (black) + "Unirme con enlace" (white) tiles from the
 * prototype's Espacios screen. Joining opens an inline paste-the-link form —
 * invites are secure `/i/<token>` links only (no short codes).
 */
export function SpaceActionTiles({ defaultJoinOpen = false }: { defaultJoinOpen?: boolean }) {
    const [joinOpen, setJoinOpen] = useState(defaultJoinOpen);
    const tile = "min-h-[76px] rounded-2xl px-3.5 py-3 flex flex-col justify-between gap-2 text-left active:scale-[0.98] transition-transform";
    return (
        <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
                <Link href="/spaces/new" className={cn(tile, "bg-foreground text-white")}>
                    <Plus className="h-5 w-5 flex-none" aria-hidden="true" />
                    <span className="text-sm font-semibold">Crear espacio</span>
                </Link>
                <button
                    type="button"
                    aria-expanded={joinOpen}
                    aria-controls="join-link-panel"
                    onClick={() => setJoinOpen((v) => !v)}
                    className={cn(tile, "bg-card border", joinOpen ? "border-primary" : "border-[color:var(--line)]")}
                >
                    <Ticket className="h-5 w-5 flex-none" aria-hidden="true" />
                    <span className="text-sm font-semibold">Unirme con enlace</span>
                </button>
            </div>
            {joinOpen && (
                <div id="join-link-panel" className="eq-in rounded-2xl bg-card border border-[color:var(--line)] p-3.5">
                    <JoinLinkForm focusOnMount />
                </div>
            )}
        </div>
    );
}
