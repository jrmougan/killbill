"use client";

import { useState } from "react";
import { Loader2, Share } from "lucide-react";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { cn } from "@/lib/utils";

/**
 * "Invitar a {espacio}" card (prototype `is.espacios`). No short codes: the
 * first tap on "Enviar" mints a secure `/i/[token]` link through the existing
 * GroupInvite API (`POST /api/spaces/[id]/invites` — OWNER/ADMIN, re-checked
 * server-side), shows it once in DM Mono and hands it to the share sheet
 * (clipboard fallback + toast). Later taps reuse the same link (no spam).
 *
 * `kind` is GUEST for EPHEMERAL spaces (only rendered when the ephemeral flag is
 * on) and MEMBER otherwise.
 */
export function SpaceInviteCard({
    spaceId,
    spaceName,
    kind = "MEMBER",
    maxUses,
    className,
}: {
    spaceId: string;
    spaceName: string;
    kind?: "MEMBER" | "GUEST";
    /** Uses allowed for the link (1 for a couple, more for groups). */
    maxUses: number;
    className?: string;
}) {
    const [url, setUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, showToast] = useEqToast();

    const share = async (link: string) => {
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: `Únete a ${spaceName} en EQUIL`, url: link });
                return;
            } catch (e) {
                // AbortError = the user closed the sheet: nothing else to do.
                if (e instanceof DOMException && e.name === "AbortError") return;
            }
        }
        try {
            await navigator.clipboard.writeText(link);
            showToast("Enlace copiado");
        } catch {
            showToast("Copia el enlace de arriba");
        }
    };

    const onSend = async () => {
        setError(null);
        if (url) return share(url);
        setLoading(true);
        try {
            const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            const res = await fetch(`/api/spaces/${spaceId}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, maxUses, expiresAt }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.token) {
                const link = `${window.location.origin}/i/${data.token}`;
                setUrl(link);
                await share(link);
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
        <section
            data-testid="space-invite-card"
            className={cn("rounded-2xl bg-[var(--accent-tint)] px-4 py-3.5 flex flex-col gap-2.5", className)}
        >
            <span className="text-[13px] font-semibold truncate">Invitar a {spaceName}</span>
            <div className="flex items-center gap-2">
                <span
                    data-testid="invite-link"
                    className={cn(
                        "flex-1 min-w-0 h-10 rounded-xl bg-card flex items-center px-3 font-mono text-[13px] truncate select-all",
                        !url && "text-[color:var(--ink-3)]",
                    )}
                >
                    <span className="truncate">{url ? url.replace(/^https?:\/\//, "") : "Enlace seguro · se crea al enviar"}</span>
                </span>
                <button
                    type="button"
                    onClick={onSend}
                    disabled={loading}
                    className="h-10 flex-none rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground flex items-center gap-1.5 disabled:opacity-60 active:scale-[0.97]"
                >
                    {loading ? <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden="true" /> : <Share className="h-[15px] w-[15px]" aria-hidden="true" />}
                    Enviar
                </button>
            </div>
            <span className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
                {error ?? (maxUses === 1 ? "Un solo uso · caduca en 7 días" : `Hasta ${maxUses} personas · caduca en 7 días`)}
            </span>
            {toast && <EqToast>{toast}</EqToast>}
        </section>
    );
}
