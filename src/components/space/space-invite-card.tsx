"use client";

import { useEffect, useState } from "react";
import { Loader2, Share } from "lucide-react";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { cn } from "@/lib/utils";
import { fetchInvites, forgetInvite, isInviteLive, recallInvite, rememberInvite } from "./invite-session";

const LINK_DAYS = 7;

/**
 * "Invitar a {espacio}" card (prototype `is.espacios`). No short codes: the
 * first tap on "Enviar" mints a secure `/i/[token]` link through the GroupInvite
 * API (`POST /api/spaces/[id]/invites` — OWNER/ADMIN, re-checked server-side),
 * shows it in DM Mono and hands it to the share sheet (clipboard fallback +
 * toast). The link is remembered for this tab (`invite-session.ts`): later taps —
 * even after a reload — share the SAME link while it is still live, so a couple
 * never ends up with several valid links. "Generar nuevo" asks first (the link
 * already sent stops working), deactivates the old one and only then mints a
 * fresh one — if the DELETE fails nothing new is created.
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
    const [regenOpen, setRegenOpen] = useState(false);
    const [regenError, setRegenError] = useState<string | null>(null);
    const [toast, showToast, toastAction] = useEqToast();

    // Restore the link minted earlier in this tab, if the server says it is live.
    useEffect(() => {
        const remembered = recallInvite(spaceId, kind);
        if (!remembered) return;
        let cancelled = false;
        void fetchInvites(spaceId).then((list) => {
            if (cancelled || !list) return;
            const row = list.find((i) => i.id === remembered.inviteId);
            if (row && isInviteLive(row)) setUrl(remembered.url);
            else forgetInvite(spaceId, kind);
        });
        return () => {
            cancelled = true;
        };
    }, [spaceId, kind]);

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

    const mint = async () => {
        setLoading(true);
        setError(null);
        try {
            const expiresAt = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
            const res = await fetch(`/api/spaces/${spaceId}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, maxUses, expiresAt }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.token) {
                const link = `${window.location.origin}/i/${data.token}`;
                setUrl(link);
                if (data.invite?.id) {
                    rememberInvite(spaceId, { inviteId: data.invite.id, url: link, kind, expiresAt: String(data.invite.expiresAt ?? expiresAt) });
                }
                return link;
            }
            setError(data?.error || "No se pudo crear el enlace");
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setLoading(false);
        }
        return null;
    };

    const onSend = async () => {
        setError(null);
        const link = url ?? (await mint());
        if (link) await share(link);
    };

    // A fresh link replaces the old one: deactivate it first so only one stays
    // valid. A 404 means it was already revoked (e.g. from the space page).
    const onRegenerate = async () => {
        setRegenError(null);
        const previous = recallInvite(spaceId, kind);
        if (previous) {
            setLoading(true);
            const res = await fetch(`/api/spaces/${spaceId}/invites?inviteId=${encodeURIComponent(previous.inviteId)}`, {
                method: "DELETE",
            }).catch(() => null);
            setLoading(false);
            if (!res || (!res.ok && res.status !== 404)) {
                setRegenError("No se pudo desactivar el enlace anterior. Inténtalo de nuevo.");
                return;
            }
        }
        forgetInvite(spaceId, kind);
        setUrl(null);
        const link = await mint();
        setRegenOpen(false);
        if (link) showToast("Enlace nuevo listo. El anterior ya no funciona.", { label: "Enviar", onAction: () => void share(link) });
    };

    const hint = maxUses === 1 ? `Un solo uso · caduca en ${LINK_DAYS} días` : `Hasta ${maxUses} personas · caduca en ${LINK_DAYS} días`;

    return (
        <section
            data-testid="space-invite-card"
            aria-label={`Invitar a ${spaceName}`}
            className={cn("rounded-2xl bg-[var(--accent-tint)] px-4 py-3.5 flex flex-col gap-2.5", className)}
        >
            <span className="text-[13px] font-semibold truncate">Invitar a {spaceName}</span>
            <div className="flex items-center gap-2">
                <span
                    data-testid="invite-link"
                    className={cn(
                        "flex-1 min-w-0 h-11 rounded-xl bg-card flex items-center px-3 text-[13px] truncate",
                        url ? "font-mono select-all" : "text-muted-foreground",
                    )}
                >
                    <span className="truncate">{url ? url.replace(/^https?:\/\//, "") : "Se crea un enlace seguro"}</span>
                </span>
                <button
                    type="button"
                    onClick={onSend}
                    disabled={loading}
                    className="h-11 flex-none rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground flex items-center gap-1.5 disabled:opacity-60 active:scale-[0.97]"
                >
                    {loading ? <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden="true" /> : <Share className="h-[15px] w-[15px]" aria-hidden="true" />}
                    Enviar
                </button>
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")} role={error ? "alert" : undefined}>
                    {error ?? hint}
                </span>
                {url && (
                    <button
                        type="button"
                        onClick={() => {
                            setRegenError(null);
                            setRegenOpen(true);
                        }}
                        disabled={loading}
                        className="-my-3 min-h-11 px-1 flex-none text-xs font-semibold text-primary disabled:opacity-60"
                    >
                        Generar nuevo
                    </button>
                )}
            </div>
            {regenOpen && (
                <CriticalActionSheet
                    testId="regenerate-sheet"
                    title="¿Crear un enlace nuevo?"
                    consequences={[
                        "El enlace que ya enviaste dejará de funcionar: quien no haya entrado necesitará el nuevo.",
                        "Las personas que ya entraron siguen en el espacio.",
                    ]}
                    confirmLabel="Crear enlace nuevo"
                    busy={loading}
                    error={regenError}
                    onConfirm={onRegenerate}
                    onClose={() => setRegenOpen(false)}
                />
            )}
            {toast && <EqToast action={toastAction}>{toast}</EqToast>}
        </section>
    );
}
