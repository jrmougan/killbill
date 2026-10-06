"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysUntil } from "@/lib/space-ui";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { Sheet } from "@/components/ui/sheet";
import {
    fetchInvites,
    forgetInvite,
    isInviteLive,
    recallInvite,
    rememberInvite,
    type InviteRow,
} from "./invite-session";

/**
 * Invitation links of a space (`/spaces/[id]`). No short codes — only secure,
 * expirable `/i/<token>` links (GroupInvite: the DB keeps hash + prefix). The
 * plaintext is shown right after creation and remembered for this tab
 * (`invite-session.ts`); afterwards links are listed by prefix with their
 * uses/expiry and can be revoked.
 *
 * `kind` decides what the space accepts: MEMBER links for an ACTIVE COUPLE/GROUP
 * with room, GUEST links for an ACTIVE EPHEMERAL trip (flag on). `kind = null`
 * (full, closing, archived…) hides creation and explains why in `reason`.
 */

const EXPIRY_OPTIONS = [
    { label: "1 día", days: 1 },
    { label: "7 días", days: 7 },
    { label: "30 días", days: 30 },
];

function inviteUrl(token: string): string {
    return `${window.location.origin}/i/${token}`;
}

/** Human status for a listed invite (never the token itself). */
function inviteStatus(inv: InviteRow): { label: string; live: boolean } {
    if (inv.revokedAt) return { label: "Revocado", live: false };
    const days = daysUntil(inv.expiresAt);
    if (days !== null && days <= 0 && new Date(inv.expiresAt).getTime() <= Date.now()) return { label: "Caducado", live: false };
    if (inv.usedCount >= inv.maxUses) return { label: "Agotado", live: false };
    const left = inv.maxUses - inv.usedCount;
    const expiry = days === null ? "" : days <= 1 ? " · caduca hoy" : ` · caduca en ${days} días`;
    return { label: `${left} uso${left === 1 ? "" : "s"} restante${left === 1 ? "" : "s"}${expiry}`, live: true };
}

export function InviteManager({
    spaceId,
    kind,
    maxUsesCap,
    reason,
}: {
    spaceId: string;
    /** Link kind this space accepts now, or null when it can't take anyone. */
    kind: "MEMBER" | "GUEST" | null;
    /** Most uses a new link may get (free places, capped). */
    maxUsesCap: number;
    /** Why no link can be created (shown when `kind` is null). */
    reason?: string;
}) {
    const [invites, setInvites] = useState<InviteRow[] | null>(null);
    const [current, setCurrent] = useState<{ inviteId: string; url: string } | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [expiryDays, setExpiryDays] = useState(7);
    const [maxUses, setMaxUses] = useState(1);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [toast, showToast] = useEqToast();

    const load = useCallback(async () => {
        const list = await fetchInvites(spaceId);
        setInvites(list ?? []);
        if (!kind || !list) return;
        const remembered = recallInvite(spaceId, kind);
        const row = remembered && list.find((i) => i.id === remembered.inviteId);
        if (remembered && row && isInviteLive(row)) setCurrent({ inviteId: remembered.inviteId, url: remembered.url });
        else if (remembered) forgetInvite(spaceId, kind);
    }, [spaceId, kind]);

    useEffect(() => {
        void load();
    }, [load]);

    const create = async () => {
        if (!kind) return;
        setCreating(true);
        setError(null);
        try {
            const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
            const res = await fetch(`/api/spaces/${spaceId}/invites`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, maxUses: Math.min(maxUses, maxUsesCap), expiresAt }),
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.token && data.invite) {
                const url = inviteUrl(data.token as string);
                const row = data.invite as InviteRow;
                rememberInvite(spaceId, { inviteId: row.id, url, kind, expiresAt: String(row.expiresAt) });
                setCurrent({ inviteId: row.id, url });
                setInvites((prev) => [{ ...row, revokedAt: null }, ...(prev ?? [])]);
                setSheetOpen(false);
            } else {
                setError(data?.error || "No se pudo crear el enlace");
            }
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setCreating(false);
        }
    };

    const shareCurrent = async () => {
        if (!current) return;
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: "Únete a mi espacio en EQUIL", url: current.url });
                return;
            } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") return;
            }
        }
        try {
            await navigator.clipboard.writeText(current.url);
            setCopied(true);
            showToast("Enlace copiado");
            setTimeout(() => setCopied(false), 2000);
        } catch {
            showToast("Copia el enlace de arriba");
        }
    };

    const revoke = async (inv: InviteRow) => {
        if (!confirm(`El enlace ${inv.tokenPrefix}… dejará de funcionar de inmediato. ¿Revocarlo?`)) return;
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/invites?inviteId=${encodeURIComponent(inv.id)}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                setError(data?.error || "No se pudo revocar el enlace");
                return;
            }
            setInvites((prev) => (prev ?? []).map((i) => (i.id === inv.id ? { ...i, revokedAt: new Date().toISOString() } : i)));
            if (current?.inviteId === inv.id) {
                setCurrent(null);
                if (kind) forgetInvite(spaceId, kind);
            }
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        }
    };

    const live = (invites ?? []).filter(isInviteLive);
    const usesOptions = [1, 5, 10].filter((n) => n <= Math.max(1, maxUsesCap));

    return (
        <div className="flex flex-col gap-2.5" data-testid="invite-manager">
            {current && (
                <div className="rounded-2xl bg-[var(--accent-tint)] px-4 py-3.5 flex flex-col gap-2">
                    <span className="text-[13px] font-semibold">Enlace para compartir</span>
                    <div className="flex items-center gap-2">
                        <span data-testid="invite-current-link" className="flex-1 min-w-0 h-11 rounded-xl bg-card flex items-center px-3 font-mono text-[13px] select-all">
                            <span className="truncate">{current.url.replace(/^https?:\/\//, "")}</span>
                        </span>
                        <button
                            type="button"
                            onClick={shareCurrent}
                            aria-label="Compartir enlace"
                            className="h-11 w-11 flex-none rounded-xl bg-primary text-primary-foreground flex items-center justify-center active:scale-[0.97]"
                        >
                            {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                        </button>
                    </div>
                </div>
            )}

            {kind ? (
                <button
                    type="button"
                    onClick={() => {
                        setError(null);
                        setMaxUses(kind === "GUEST" ? Math.min(10, maxUsesCap) : 1);
                        setSheetOpen(true);
                    }}
                    className="h-12 rounded-[14px] border border-dashed border-[color:var(--line-strong)] bg-card flex items-center justify-center gap-2 text-sm font-semibold"
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {kind === "GUEST" ? "Crear enlace para invitados" : "Crear enlace de invitación"}
                </button>
            ) : (
                reason && <p className="text-[13px] text-muted-foreground px-1">{reason}</p>
            )}

            {invites === null ? (
                <p className="text-xs text-muted-foreground px-1">Cargando enlaces…</p>
            ) : invites.length > 0 ? (
                <ul className="flex flex-col divide-y divide-[color:var(--line-2)] rounded-[18px] bg-card border border-[color:var(--line-2)] px-4">
                    {invites.slice(0, 8).map((inv) => {
                        const st = inviteStatus(inv);
                        return (
                            <li key={inv.id} className="flex items-center gap-3 py-2 min-h-14" data-testid="invite-row" data-live={st.live ? "true" : "false"}>
                                <span className="flex-1 min-w-0">
                                    <span className="block font-mono text-[13px]">{inv.tokenPrefix}…</span>
                                    <span className={cn("block text-[12.5px] truncate", st.live ? "text-muted-foreground" : "text-muted-foreground line-through")}>
                                        {inv.kind === "GUEST" ? "Invitados · " : ""}{st.label}
                                    </span>
                                </span>
                                {st.live && (
                                    <button
                                        type="button"
                                        onClick={() => revoke(inv)}
                                        aria-label={`Revocar enlace ${inv.tokenPrefix}`}
                                        className="h-11 w-11 -mr-2 flex-none rounded-xl text-destructive flex items-center justify-center hover:bg-[var(--negative-tint)]"
                                    >
                                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
            {live.length > 1 && (
                <p className="text-xs text-muted-foreground px-1">Hay {live.length} enlaces activos. Revoca los que ya no uses.</p>
            )}
            {error && !sheetOpen && <p role="alert" className="text-xs text-destructive px-1">{error}</p>}

            {sheetOpen && kind && (
                <Sheet title={kind === "GUEST" ? "Enlace para invitados" : "Nuevo enlace"} onClose={() => setSheetOpen(false)}>
                    <div className="flex flex-col gap-4">
                        <p className="text-[13px] text-muted-foreground">
                            {kind === "GUEST"
                                ? "Quien lo abra entra sin cuenta, solo a este viaje."
                                : "Quien lo abra podrá unirse con su cuenta después de confirmarlo."}
                        </p>
                        <fieldset className="flex flex-col gap-2">
                            <legend className="text-xs font-semibold text-muted-foreground pb-2">Caduca en</legend>
                            <div className="flex gap-2">
                                {EXPIRY_OPTIONS.map((o) => (
                                    <button
                                        key={o.days}
                                        type="button"
                                        aria-pressed={expiryDays === o.days}
                                        onClick={() => setExpiryDays(o.days)}
                                        className={cn(
                                            "h-11 flex-1 rounded-xl border text-sm font-semibold",
                                            expiryDays === o.days ? "bg-foreground text-white border-foreground" : "bg-card border-[color:var(--line)]",
                                        )}
                                    >
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        {usesOptions.length > 1 && (
                            <fieldset className="flex flex-col gap-2">
                                <legend className="text-xs font-semibold text-muted-foreground pb-2">Personas que pueden usarlo</legend>
                                <div className="flex gap-2">
                                    {usesOptions.map((n) => (
                                        <button
                                            key={n}
                                            type="button"
                                            aria-pressed={maxUses === n}
                                            onClick={() => setMaxUses(n)}
                                            className={cn(
                                                "h-11 flex-1 rounded-xl border text-sm font-semibold",
                                                maxUses === n ? "bg-foreground text-white border-foreground" : "bg-card border-[color:var(--line)]",
                                            )}
                                        >
                                            {n === 1 ? "1 persona" : `${n}`}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                        <button
                            type="button"
                            onClick={create}
                            disabled={creating}
                            className="h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {creating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                            Crear enlace
                        </button>
                    </div>
                </Sheet>
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}
