"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, RefreshCw, LinkIcon, Trash2, Plus } from "lucide-react";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysUntil } from "@/lib/space-ui";

/**
 * Invitation management for a space (Fase 2). Two surfaces:
 *
 *  1. The classic join code (COUPLE/GROUP): copy + "Rotar código"
 *     (POST /api/spaces/[id]/rotate-code) — invalidates the previous code.
 *  2. Expirable invite LINKS (GroupInvite, kind MEMBER): create a single-shown
 *     `/i/[token]` link (POST /api/spaces/[id]/invites — the DB only keeps the
 *     hash + prefix), list live links by `tokenPrefix` with their usage/expiry,
 *     and revoke them (DELETE). The plaintext token is returned ONCE by the API
 *     and rendered here exactly once; it can never be recovered afterwards.
 *
 * Links are only offered where a registered member can actually join: an ACTIVE
 * COUPLE/GROUP. GUEST links (EPHEMERAL) are a Fase 3 deliverable and shown as a
 * "próximamente" note here.
 */

type InviteRow = {
    id: string;
    tokenPrefix: string;
    kind: string;
    maxUses: number;
    usedCount: number;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
};

const EXPIRY_OPTIONS = [
    { label: "7 días", days: 7 },
    { label: "30 días", days: 30 },
];
const USES_OPTIONS = [1, 5, 10];

function inviteUrl(token: string): string {
    if (typeof window === "undefined") return `/i/${token}`;
    return `${window.location.origin}/i/${token}`;
}

/** Human status for a listed invite (never the token itself). */
function inviteStatus(inv: InviteRow): { label: string; tone: "live" | "spent" } {
    if (inv.revokedAt) return { label: "Revocado", tone: "spent" };
    const days = daysUntil(inv.expiresAt);
    if (days !== null && days < 0) return { label: "Caducado", tone: "spent" };
    if (inv.usedCount >= inv.maxUses) return { label: "Agotado", tone: "spent" };
    const usesLeft = inv.maxUses - inv.usedCount;
    const expiry = days === null ? "" : days <= 0 ? " · caduca hoy" : days === 1 ? " · caduca en 1 día" : ` · caduca en ${days} días`;
    return { label: `${usesLeft} uso${usesLeft === 1 ? "" : "s"} restante${usesLeft === 1 ? "" : "s"}${expiry}`, tone: "live" };
}

export function InviteManager({
    spaceId,
    type,
    status,
    initialCode,
    canManage,
}: {
    spaceId: string;
    type: SpaceType | string;
    status: SpaceStatus | string;
    initialCode: string;
    canManage: boolean;
}) {
    const [code, setCode] = useState(initialCode);
    const [copied, setCopied] = useState(false);
    const [rotating, setRotating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const usesCode = type === SpaceType.COUPLE || type === SpaceType.GROUP;
    // Member links only make sense where a registered member can join.
    const linksAllowed = usesCode && status === SpaceStatus.ACTIVE;
    const isEphemeral = type === SpaceType.EPHEMERAL;

    const copyCode = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const rotate = async () => {
        if (!confirm("Al rotar el código, el anterior dejará de funcionar. ¿Continuar?")) return;
        setRotating(true);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/rotate-code`, { method: "POST" });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.code) {
                setCode(data.code);
            } else {
                setError(data?.error || "No se pudo rotar el código");
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setRotating(false);
        }
    };

    // ── Invite links state ──────────────────────────────────────────────────
    const [invites, setInvites] = useState<InviteRow[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [creating, setCreating] = useState(false);
    const [linkError, setLinkError] = useState<string | null>(null);
    const [expiryDays, setExpiryDays] = useState(30);
    const [maxUses, setMaxUses] = useState(1);
    // The freshly minted plaintext link, shown ONCE right after creation.
    const [freshToken, setFreshToken] = useState<string | null>(null);
    const [freshCopied, setFreshCopied] = useState(false);

    const loadInvites = useCallback(async () => {
        setLoadingList(true);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/invites`);
            const data = await res.json().catch(() => null);
            if (res.ok && Array.isArray(data?.invites)) setInvites(data.invites);
        } catch {
            /* non-fatal: the list just stays empty */
        } finally {
            setLoadingList(false);
        }
    }, [spaceId]);

    useEffect(() => {
        if (canManage && (linksAllowed || isEphemeral)) void loadInvites();
    }, [canManage, linksAllowed, isEphemeral, loadInvites]);

    const createLink = async () => {
        setCreating(true);
        setLinkError(null);
        setFreshToken(null);
        try {
            const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
            const res = await fetch(`/api/spaces/${spaceId}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ maxUses, expiresAt }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.token) {
                setFreshToken(data.token as string);
                if (data.invite) setInvites((prev) => [data.invite as InviteRow, ...prev]);
            } else {
                setLinkError(data?.error || "No se pudo crear el enlace");
            }
        } catch {
            setLinkError("Error de conexión");
        } finally {
            setCreating(false);
        }
    };

    const shareFresh = async () => {
        if (!freshToken) return;
        const url = inviteUrl(freshToken);
        if (navigator.share) {
            try {
                await navigator.share({ title: "Únete a mi espacio en EQUIL", url });
                return;
            } catch {
                /* user cancelled — fall through to copy */
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            setFreshCopied(true);
            setTimeout(() => setFreshCopied(false), 2000);
        } catch {
            /* clipboard blocked — the URL is visible on screen anyway */
        }
    };

    const revoke = async (inviteId: string) => {
        if (!confirm("El enlace dejará de funcionar de inmediato. ¿Revocar?")) return;
        try {
            const res = await fetch(`/api/spaces/${spaceId}/invites?inviteId=${encodeURIComponent(inviteId)}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setInvites((prev) =>
                    prev.map((i) => (i.id === inviteId ? { ...i, revokedAt: new Date().toISOString() } : i)),
                );
            } else {
                const data = await res.json().catch(() => null);
                setLinkError(data?.error || "No se pudo revocar el enlace");
            }
        } catch {
            setLinkError("Error de conexión");
        }
    };

    return (
        <div className="space-y-3">
            {/* Classic join code (COUPLE/GROUP). */}
            {usesCode ? (
                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                                Código de invitación
                            </p>
                            <code className="text-lg font-mono font-bold tracking-tighter text-foreground">{code}</code>
                        </div>
                        <Button
                            size="icon"
                            variant="ghost"
                            onClick={copyCode}
                            className="h-10 w-10"
                            aria-label="Copiar código"
                        >
                            {copied ? <Check className="h-4 w-4 text-[color:var(--positive)]" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    {canManage && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={rotate}
                            isLoading={rotating}
                            className="w-full"
                        >
                            <RefreshCw className="h-4 w-4 mr-2" /> Rotar código
                        </Button>
                    )}
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
            ) : (
                <div className="rounded-xl bg-secondary border border-[color:var(--line)] p-4">
                    <p className="text-sm text-muted-foreground">
                        Este espacio se comparte con enlaces de invitación temporales.
                    </p>
                </div>
            )}

            {/* Expirable invite links. */}
            {canManage && linksAllowed && (
                <div className="rounded-xl border border-[color:var(--line)] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <LinkIcon className="h-4 w-4 text-primary shrink-0" />
                        <p className="text-sm font-semibold text-foreground">Enlaces de invitación</p>
                    </div>
                    <p className="text-[12px] text-muted-foreground">
                        Un enlace con caducidad y usos limitados. Al crearlo se muestra una sola vez.
                    </p>

                    {/* Create controls. */}
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`exp-${spaceId}`}>Caducidad</label>
                        <select
                            id={`exp-${spaceId}`}
                            value={expiryDays}
                            onChange={(e) => setExpiryDays(Number(e.target.value))}
                            className="h-9 rounded-lg border border-[color:var(--line)] bg-card px-2 text-xs text-foreground"
                        >
                            {EXPIRY_OPTIONS.map((o) => (
                                <option key={o.days} value={o.days}>{o.label}</option>
                            ))}
                        </select>
                        <label className="sr-only" htmlFor={`uses-${spaceId}`}>Usos</label>
                        <select
                            id={`uses-${spaceId}`}
                            value={maxUses}
                            onChange={(e) => setMaxUses(Number(e.target.value))}
                            className="h-9 rounded-lg border border-[color:var(--line)] bg-card px-2 text-xs text-foreground"
                        >
                            {USES_OPTIONS.map((n) => (
                                <option key={n} value={n}>{n === 1 ? "1 uso" : `${n} usos`}</option>
                            ))}
                        </select>
                        <Button size="sm" onClick={createLink} isLoading={creating} className="ml-auto">
                            <Plus className="h-4 w-4 mr-1" /> Crear enlace
                        </Button>
                    </div>

                    {linkError && <p className="text-xs text-destructive">{linkError}</p>}

                    {/* One-time reveal of the freshly created link. */}
                    {freshToken && (
                        <div className="rounded-lg bg-[var(--accent-tint)] border border-[color:var(--accent-border)] p-3 space-y-2">
                            <p className="text-[11px] font-semibold text-foreground">
                                Copia este enlace ahora — no se volverá a mostrar.
                            </p>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-foreground">
                                    {inviteUrl(freshToken)}
                                </code>
                                <Button size="icon" variant="ghost" onClick={shareFresh} className="h-8 w-8 shrink-0" aria-label="Copiar enlace">
                                    {freshCopied ? <Check className="h-4 w-4 text-[color:var(--positive)]" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Live links list (by prefix, never the token). */}
                    {invites.length > 0 && (
                        <ul className="space-y-2 pt-1">
                            {invites.map((inv) => {
                                const st = inviteStatus(inv);
                                return (
                                    <li key={inv.id} className="flex items-center gap-2 text-xs">
                                        <code className="font-mono text-muted-foreground shrink-0">{inv.tokenPrefix}…</code>
                                        <span
                                            className={
                                                st.tone === "live"
                                                    ? "text-muted-foreground truncate"
                                                    : "text-[color:var(--ink-3)] line-through truncate"
                                            }
                                        >
                                            {st.label}
                                        </span>
                                        {st.tone === "live" && (
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => revoke(inv.id)}
                                                className="h-7 w-7 ml-auto shrink-0"
                                                aria-label="Revocar enlace"
                                            >
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    {loadingList && invites.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">Cargando enlaces…</p>
                    )}
                </div>
            )}

            {/* EPHEMERAL guest links land in Fase 3. */}
            {isEphemeral && (
                <div className="rounded-xl border border-dashed border-[color:var(--line-strong)] p-4 flex items-center gap-3 opacity-70">
                    <LinkIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Enlaces para invitados</p>
                        <p className="text-[12px] text-muted-foreground">
                            Invitar sin cuenta a un viaje — próximamente.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
