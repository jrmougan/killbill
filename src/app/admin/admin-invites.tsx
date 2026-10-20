"use client";

import { useState, useTransition } from "react";
import { Check, Plus, Trash2, UserCheck } from "lucide-react";
import { EqCard, EqCta, EqHeader, EqLabel, EqToast, useEqToast } from "@/components/ui/eq";
import { AuthError } from "@/components/auth/auth-shell";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { createInviteAction, deleteInviteAction } from "./actions";
import type { AdminInvite } from "./admin-data";

// No year: an invite lives 7 days, so the date is always close to today.
const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });

/**
 * Interactive part of the admin panel: create / copy / void (anular)
 * registration invites. Expired ones get their own "Caducadas" group: they
 * can no longer be used, so they are not "Disponibles" and cannot be copied. The list comes from the server page; the Server Actions re-check
 * the admin role and revalidate `/admin`, so the props are always fresh.
 */
export function AdminInvites({ invites }: { invites: AdminInvite[] }) {
    const [creating, startCreate] = useTransition();
    const [voiding, startVoid] = useTransition();
    const [now] = useState(() => Date.now());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [pendingVoid, setPendingVoid] = useState<AdminInvite | null>(null);
    const [voidError, setVoidError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [toast, showToast] = useEqToast();

    const createInvite = () =>
        startCreate(async () => {
            const res = await createInviteAction().catch(() => null);
            if (res?.ok) {
                setError(null);
                showToast("Invitación creada");
            } else {
                setError("No se pudo crear la invitación");
            }
        });

    const askVoid = (invite: AdminInvite) => {
        setVoidError(null);
        setPendingVoid(invite);
    };

    const voidInvite = () => {
        if (!pendingVoid) return;
        const id = pendingVoid.id;
        startVoid(async () => {
            const res = await deleteInviteAction(id).catch(() => null);
            if (res?.ok) {
                setPendingVoid(null);
                setError(null);
                showToast("Invitación anulada");
            } else {
                setVoidError("No se pudo anular la invitación. Inténtalo de nuevo.");
            }
        });
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

    const isExpired = (i: AdminInvite) => !!i.expiresAt && new Date(i.expiresAt).getTime() < now;
    const available = invites.filter((i) => !i.usedBy && !isExpired(i));
    const expired = invites.filter((i) => !i.usedBy && isExpired(i));
    const used = invites.filter((i) => i.usedBy);

    const voidButton = (invite: AdminInvite) => (
        <button
            type="button"
            onClick={() => askVoid(invite)}
            aria-label={`Anular invitación ${invite.code}`}
            className="h-11 w-11 flex-none flex items-center justify-center rounded-xl text-destructive"
        >
            <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
    );

    const rowCls = (i: number) =>
        "flex items-center gap-2 py-3" + (i > 0 ? " border-t border-[color:var(--line-2)]" : "");

    return (
        <div className="min-h-dvh flex flex-col gap-5 pb-10 pt-3 eq-in">
            <EqHeader title="Administración" back="/settings" />

            <div className="px-5 flex flex-col gap-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Enlaces para crear una cuenta en EQUIL. Cada enlace sirve una vez y caduca a los 7 días.
                </p>

                {error && <AuthError>{error}</AuthError>}

                <div className="grid grid-cols-2 gap-2.5">
                    <EqCard className="p-4">
                        <div className="text-[28px] font-bold leading-none" data-testid="admin-available-count">{available.length}</div>
                        <div className="mt-1.5 text-xs text-muted-foreground">Disponibles</div>
                    </EqCard>
                    <EqCard className="p-4">
                        <div className="text-[28px] font-bold leading-none">{used.length}</div>
                        <div className="mt-1.5 text-xs text-muted-foreground">Usadas</div>
                    </EqCard>
                </div>

                <EqCta onClick={createInvite} disabled={creating} aria-busy={creating}>
                    <Plus className="h-5 w-5" aria-hidden="true" />
                    {creating ? "Creando…" : "Nueva invitación"}
                </EqCta>

                <section aria-labelledby="admin-available" className="flex flex-col gap-2">
                    <EqLabel id="admin-available" className="pl-1">Disponibles</EqLabel>
                    {available.length === 0 ? (
                        <EqCard className="p-4 text-sm text-muted-foreground">
                            No hay invitaciones libres. Crea una nueva.
                        </EqCard>
                    ) : (
                        <EqCard className="px-4">
                            <ul>
                                {available.map((invite, i) => (
                                    <li key={invite.id} className={rowCls(i)}>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-mono text-[15px] font-medium tracking-[0.08em]">{invite.code}</div>
                                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                                {invite.expiresAt ? `Caduca el ${dateFmt.format(new Date(invite.expiresAt))}` : "Sin caducidad"}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => copyCode(invite.code, invite.id)}
                                            aria-label={`Copiar enlace de registro ${invite.code}`}
                                            className="h-11 flex-none flex items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary"
                                        >
                                            {copiedId === invite.id && <Check className="h-4 w-4" aria-hidden="true" />}
                                            {copiedId === invite.id ? "Copiado" : "Copiar enlace"}
                                        </button>
                                        {voidButton(invite)}
                                    </li>
                                ))}
                            </ul>
                        </EqCard>
                    )}
                </section>

                {expired.length > 0 && (
                    <section aria-labelledby="admin-expired" className="flex flex-col gap-2">
                        <EqLabel id="admin-expired" className="pl-1">Caducadas</EqLabel>
                        <EqCard className="px-4">
                            <ul>
                                {expired.map((invite, i) => (
                                    <li key={invite.id} className={rowCls(i)}>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-mono text-[15px] font-medium tracking-[0.08em] text-muted-foreground">
                                                {invite.code}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                Caducó el {dateFmt.format(new Date(invite.expiresAt!))}
                                            </div>
                                        </div>
                                        {voidButton(invite)}
                                    </li>
                                ))}
                            </ul>
                        </EqCard>
                    </section>
                )}

                {used.length > 0 && (
                    <section aria-labelledby="admin-used" className="flex flex-col gap-2">
                        <EqLabel id="admin-used" className="pl-1">Usadas</EqLabel>
                        <EqCard className="px-4">
                            <ul>
                                {used.map((invite, i) => (
                                    <li key={invite.id} className={rowCls(i) + " gap-3"}>
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
            </div>
            {pendingVoid && (
                <CriticalActionSheet
                    tone="danger"
                    testId="invite-void-sheet"
                    title={`¿Anular la invitación ${pendingVoid.code}?`}
                    consequences={[
                        isExpired(pendingVoid)
                            ? "Ya ha caducado: nadie puede usarla. Solo desaparecerá de la lista."
                            : "El enlace de registro que hayas enviado dejará de funcionar y nadie podrá crear una cuenta con él.",
                    ]}
                    reversible={false}
                    confirmLabel="Anular invitación"
                    busy={voiding}
                    error={voidError}
                    onConfirm={voidInvite}
                    onClose={() => setPendingVoid(null)}
                />
            )}
            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}
