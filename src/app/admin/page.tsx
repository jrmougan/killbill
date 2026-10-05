"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2, UserCheck } from "lucide-react";
import { EqCard, EqCta, EqHeader, EqLabel, EqToast, useEqToast } from "@/components/ui/eq";
import { AuthError } from "@/components/auth/auth-shell";

interface InviteCode {
    id: string;
    code: string;
    createdAt: string;
    usedAt: string | null;
    expiresAt: string | null;
    usedBy: { id: string; name: string; email: string | null } | null;
}

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });

/**
 * Admin panel (EQUIL): registration invitation codes. These are the ADMIN
 * `InviteCode`s that gate account creation (the instance is closed) — not space
 * invitations, which are 256-bit `/i/<token>` links.
 */
export default function AdminPage() {
    const [invites, setInvites] = useState<InviteCode[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [toast, showToast] = useEqToast();

    const fetchInvites = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/invites", { cache: "no-store", headers: { Pragma: "no-cache" } });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                if (res.status === 403 || res.status === 401) setForbidden(true);
                else setError(data?.error || "No se pudieron cargar las invitaciones");
                return;
            }
            setInvites(Array.isArray(data) ? data : []);
            setError(null);
        } catch {
            setError("Error de conexión al cargar las invitaciones");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchInvites();
    }, [fetchInvites]);

    const createInvite = async () => {
        setCreating(true);
        try {
            const res = await fetch("/api/admin/invites", { method: "POST" });
            if (!res.ok) throw new Error();
            await fetchInvites();
            showToast("Invitación creada");
        } catch {
            setError("No se pudo crear la invitación");
        } finally {
            setCreating(false);
        }
    };

    const deleteInvite = async (id: string) => {
        setConfirmId(null);
        try {
            const res = await fetch("/api/admin/invites", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            if (!res.ok) throw new Error();
            await fetchInvites();
            showToast("Invitación eliminada");
        } catch {
            setError("No se pudo eliminar la invitación");
        }
    };

    const copyCode = async (code: string, id: string) => {
        const url = `${window.location.origin}/register?code=${encodeURIComponent(code)}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
            showToast("Enlace de registro copiado");
        } catch {
            setError("No se pudo copiar el enlace");
        }
    };

    if (forbidden) {
        return (
            <div className="min-h-dvh flex flex-col eq-in px-6 pt-12 pb-10">
                <span className="text-[15px] font-extrabold tracking-[0.14em] text-primary">EQUIL</span>
                <h1 className="mt-3.5 text-[32px] font-bold tracking-[-0.03em] leading-[1.08]">Solo administración</h1>
                <p className="mt-3 text-[15px] text-muted-foreground leading-[1.45]">
                    No tienes permisos de administrador para ver esta página.
                </p>
                <div className="mt-auto pt-8">
                    <Link
                        href="/dashboard"
                        className="w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold flex items-center justify-center"
                    >
                        Ir a Inicio
                    </Link>
                </div>
            </div>
        );
    }

    const unused = invites.filter((i) => !i.usedBy);
    const used = invites.filter((i) => i.usedBy);

    return (
        <div className="min-h-dvh flex flex-col gap-5 pb-10 pt-3 eq-in">
            <EqHeader title="Administración" back="/settings" />

            <div className="px-5 flex flex-col gap-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Códigos para crear una cuenta en EQUIL. Cada código sirve una vez.
                </p>

                {error && <AuthError>{error}</AuthError>}

                <div className="grid grid-cols-2 gap-2.5">
                    <EqCard className="p-4">
                        <div className="text-[28px] font-bold leading-none">{loading ? "–" : unused.length}</div>
                        <div className="mt-1.5 text-xs text-muted-foreground">Disponibles</div>
                    </EqCard>
                    <EqCard className="p-4">
                        <div className="text-[28px] font-bold leading-none">{loading ? "–" : used.length}</div>
                        <div className="mt-1.5 text-xs text-muted-foreground">Usadas</div>
                    </EqCard>
                </div>

                <EqCta onClick={createInvite} disabled={creating} aria-busy={creating}>
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    {creating ? "Creando…" : "Nueva invitación"}
                </EqCta>

                {loading ? (
                    <p className="text-sm text-muted-foreground" aria-live="polite">Cargando…</p>
                ) : (
                    <>
                        <section aria-labelledby="admin-available" className="flex flex-col gap-2">
                            <EqLabel id="admin-available" className="pl-1">Disponibles</EqLabel>
                            {unused.length === 0 ? (
                                <EqCard className="p-4 text-sm text-muted-foreground">
                                    No hay invitaciones libres. Crea una nueva.
                                </EqCard>
                            ) : (
                                <EqCard className="px-4">
                                    <ul>
                                        {unused.map((invite, i) => (
                                            <li
                                                key={invite.id}
                                                className={
                                                    "flex items-center gap-3 py-3" +
                                                    (i > 0 ? " border-t border-[color:var(--line-2)]" : "")
                                                }
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-mono text-[15px] font-medium tracking-[0.08em]">{invite.code}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {invite.expiresAt ? `Caduca el ${dateFmt.format(new Date(invite.expiresAt))}` : "Sin caducidad"}
                                                    </div>
                                                </div>
                                                {confirmId === invite.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => deleteInvite(invite.id)}
                                                            className="h-11 rounded-xl px-3 text-sm font-semibold text-destructive"
                                                        >
                                                            Eliminar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmId(null)}
                                                            className="h-11 rounded-xl px-3 text-sm font-semibold text-muted-foreground"
                                                        >
                                                            Cancelar
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => copyCode(invite.code, invite.id)}
                                                            aria-label={`Copiar enlace de registro ${invite.code}`}
                                                            className="h-11 w-11 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
                                                        >
                                                            {copiedId === invite.id
                                                                ? <Check className="h-[18px] w-[18px] text-primary" />
                                                                : <Copy className="h-[18px] w-[18px]" />}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setConfirmId(invite.id)}
                                                            aria-label={`Eliminar invitación ${invite.code}`}
                                                            className="h-11 w-11 flex items-center justify-center rounded-xl text-destructive"
                                                        >
                                                            <Trash2 className="h-[18px] w-[18px]" />
                                                        </button>
                                                    </div>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </EqCard>
                            )}
                        </section>

                        {used.length > 0 && (
                            <section aria-labelledby="admin-used" className="flex flex-col gap-2">
                                <EqLabel id="admin-used" className="pl-1">Usadas</EqLabel>
                                <EqCard className="px-4">
                                    <ul>
                                        {used.map((invite, i) => (
                                            <li
                                                key={invite.id}
                                                className={
                                                    "flex items-center gap-3 py-3" +
                                                    (i > 0 ? " border-t border-[color:var(--line-2)]" : "")
                                                }
                                            >
                                                <span className="h-10 w-10 flex-none rounded-xl bg-[var(--accent-tint)] flex items-center justify-center text-primary">
                                                    <UserCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                                                </span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[15px] font-semibold truncate">{invite.usedBy?.name}</div>
                                                    <div className="text-xs text-muted-foreground truncate">{invite.usedBy?.email}</div>
                                                </div>
                                                <span className="font-mono text-xs text-muted-foreground">{invite.code}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </EqCard>
                            </section>
                        )}
                    </>
                )}
            </div>
            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}
