"use client";

import { GlassCard } from "@/components/ui/glass-card";
import { Share2, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Dashboard "invite your group" card (Fase 2). Replaces the old eternal
 * `?code=` link: on tap it mints a single-use, 30-day GroupInvite via
 * POST /api/spaces/[id]/invites and shares the `/i/[token]` consent link. The
 * plaintext token is only known here, right after creation; we cache it in state
 * so repeated taps reuse the same link instead of spamming new invites.
 */
interface InviteCardProps {
    spaceId: string;
}

export function InviteCard({ spaceId }: InviteCardProps) {
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(false);
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const shareUrl = async (link: string) => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: "Únete a mi grupo de gastos",
                    text: "¡Hola! Únete a mi grupo en EQUIL para compartir gastos:",
                    url: link,
                });
                return;
            } catch {
                /* user cancelled — fall through to copy */
            }
        }
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard blocked — nothing else to do */
        }
    };

    const handleShare = async () => {
        setError(null);
        // Reuse an already-minted link if we have one.
        if (url) {
            await shareUrl(url);
            return;
        }
        setLoading(true);
        try {
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const res = await fetch(`/api/spaces/${spaceId}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ maxUses: 1, expiresAt }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.token) {
                const link = `${window.location.origin}/i/${data.token}`;
                setUrl(link);
                await shareUrl(link);
            } else {
                setError(data?.error || "No se pudo crear el enlace");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    return (
        <GlassCard className="p-3 bg-card border border-[color:var(--line)] flex items-center justify-between">
            <div className="text-sm">
                <p className="font-medium text-foreground">Invita a tu grupo</p>
                <p className="text-xs text-muted-foreground">
                    {error ?? "Toca para compartir un enlace de invitación"}
                </p>
            </div>

            <Button
                variant="ghost"
                size="sm"
                className="gap-2 bg-secondary hover:bg-[var(--surface-raised-hex)]"
                onClick={handleShare}
                disabled={loading}
            >
                <span className="text-xs font-semibold text-foreground">Compartir</span>
                {loading ? (
                    <Loader2 className="h-3 w-3 animate-spin opacity-70" />
                ) : copied ? (
                    <Check className="h-3 w-3 text-[color:var(--positive)]" />
                ) : (
                    <Share2 className="h-3 w-3 opacity-70" />
                )}
            </Button>
        </GlassCard>
    );
}
