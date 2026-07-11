"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";

/**
 * "Join a group" card (Fase 2). It no longer joins silently via
 * /api/couple/join — instead it routes to the public consent screen `/i/[token]`
 * where the user EXPLICITLY confirms the join (and sees any error: expired,
 * revoked, exhausted, SPACE_FULL, archived). Accepts either a pasted `/i/…`
 * invite link or a raw code/token; both resolve on the consent page (which falls
 * back to the legacy classic `Couple.code`). No membership write happens here.
 */

/** Pull the token out of a pasted `/i/<token>` URL, or return the raw input. */
function extractToken(raw: string): string {
    const trimmed = raw.trim();
    const match = trimmed.match(/\/i\/([^/?#\s]+)/);
    if (match) return decodeURIComponent(match[1]);
    return trimmed;
}

export function JoinGroupCard() {
    const [value, setValue] = useState("");
    const router = useRouter();

    const handleContinue = (e: React.FormEvent) => {
        e.preventDefault();
        const token = extractToken(value);
        if (!token) return;
        router.push(`/i/${encodeURIComponent(token)}`);
    };

    return (
        <div className="p-4 rounded-3xl bg-card border border-[color:var(--line)] space-y-3 mt-4">
            <div className="flex items-center gap-2 text-muted-foreground">
                <Heart className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Unirse a un grupo</span>
            </div>
            <form onSubmit={handleContinue} className="flex gap-2">
                <Input
                    placeholder="Enlace o código de invitación"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    className="bg-card border-[color:var(--line)]"
                />
                <Button type="submit" size="sm" className="px-6 font-bold" disabled={!value.trim()}>
                    Continuar
                </Button>
            </form>
        </div>
    );
}
