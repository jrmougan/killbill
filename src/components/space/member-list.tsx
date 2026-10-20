"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAvatarUrl } from "@/lib/avatar";
import { formatCurrency } from "@/lib/currency";
import { Sheet } from "@/components/ui/sheet";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { EqToast, useEqToast } from "@/components/ui/eq";
import { MembershipRole } from "@/generated/prisma/enums";

export type SpaceMember = {
    id: string;
    name: string;
    avatar: string | null;
    role: MembershipRole | string;
    isGuest?: boolean;
    /** Net balance in this space (cents, + is owed). */
    balanceCents?: number;
    /**
     * What the viewer settles with this member in the simplified plan (cents):
     * > 0 the member owes the viewer, < 0 the viewer owes the member, 0 none.
     */
    pairCents?: number;
};

const ROLE_LABEL: Record<string, string> = {
    OWNER: "Propietario",
    ADMIN: "Admin",
    MEMBER: "Miembro",
    GUEST: "Invitado",
};

const ROLE_NOUN: Record<string, string> = {
    OWNER: "propietario",
    ADMIN: "admin",
    MEMBER: "miembro",
};

const ASSIGNABLE: { role: MembershipRole; label: string; hint: string }[] = [
    { role: MembershipRole.OWNER, label: "Propietario", hint: "Gestiona todo, incluidos los roles." },
    { role: MembershipRole.ADMIN, label: "Admin", hint: "Invita, quita miembros y gestiona el espacio." },
    { role: MembershipRole.MEMBER, label: "Miembro", hint: "Apunta gastos y salda deudas." },
];

/**
 * Roster of a space (EQUIL): avatar, name, role and balance per member. OWNERs
 * change roles (PATCH …/members/[userId]) — that is how the space is handed over
 * before its only owner leaves; making someone owner asks inline first. OWNER/
 * ADMIN remove others (DELETE → REMOVED, history kept) after a danger sheet,
 * and only at a closed balance: with an open one the member sheet shows the
 * debt and the way to settle it instead of a button that would 409.
 * Leaving yourself lives in `LeaveSpace`.
 */
export function MemberList({
    spaceId,
    spaceName,
    members,
    currentUserId,
    myRole,
    readOnly = false,
}: {
    spaceId: string;
    spaceName: string;
    members: SpaceMember[];
    currentUserId: string;
    myRole: MembershipRole | string;
    /** ARCHIVED: no role changes or removals. */
    readOnly?: boolean;
}) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [editing, setEditing] = useState<SpaceMember | null>(null);
    const [confirmOwner, setConfirmOwner] = useState(false);
    const [removing, setRemoving] = useState<SpaceMember | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [errorHref, setErrorHref] = useState<string | null>(null);
    const [toast, showToast] = useEqToast(3500);

    const isOwner = myRole === MembershipRole.OWNER;
    const canManage = isOwner || myRole === MembershipRole.ADMIN;

    const canEdit = (m: SpaceMember) => {
        if (readOnly || m.id === currentUserId) return false;
        const canRole = isOwner && m.role !== MembershipRole.GUEST && !m.isGuest;
        const canRemove = canManage && !(m.role === MembershipRole.OWNER && !isOwner);
        return canRole || canRemove;
    };

    const settleHref = `/settle?space=${encodeURIComponent(spaceId)}`;

    const openMember = (m: SpaceMember) => {
        setError(null);
        setErrorHref(null);
        setConfirmOwner(false);
        setEditing(m);
    };

    const call = async (url: string, init: RequestInit, done: string) => {
        setBusy(true);
        setError(null);
        setErrorHref(null);
        try {
            const res = await fetch(url, init);
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                setError(data?.error || "No se pudo completar la acción");
                if (data?.code === "HAS_BALANCE") setErrorHref(data.settleUrl ?? settleHref);
                return;
            }
            setEditing(null);
            setRemoving(null);
            setConfirmOwner(false);
            showToast(done);
            startTransition(() => router.refresh());
        } catch {
            setError("Sin conexión. Inténtalo de nuevo.");
        } finally {
            setBusy(false);
        }
    };

    const setRole = (m: SpaceMember, role: MembershipRole) =>
        call(`/api/spaces/${spaceId}/members/${m.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
        }, `${m.name} ahora es ${ROLE_NOUN[role]}`);

    const remove = (m: SpaceMember) =>
        call(`/api/spaces/${spaceId}/members/${m.id}`, { method: "DELETE" }, `${m.name} ya no está en ${spaceName}`);

    /** Same reminder text as /settle (creditor → debtor), shared or copied. */
    const remind = async (m: SpaceMember) => {
        const pair = m.pairCents ?? 0;
        const text = pair > 0
            ? `¡Hola, ${m.name}! En ${spaceName} me debes ${formatCurrency(pair)}. Puedes saldarlo desde EQUIL.`
            : `¡Hola, ${m.name}! En ${spaceName} debes ${formatCurrency(Math.abs(m.balanceCents ?? 0))}. Puedes saldarlo desde EQUIL.`;
        const url = `${window.location.origin}${settleHref}`;
        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title: "Deuda pendiente en EQUIL", text, url });
                return;
            } catch (e) {
                if (e instanceof DOMException && e.name === "AbortError") return;
                // fall through to the clipboard
            }
        }
        try {
            await navigator.clipboard.writeText(`${text} ${url}`);
            showToast("Recordatorio copiado");
        } catch {
            showToast("No se pudo copiar el recordatorio");
        }
    };

    const anyEditable = members.some(canEdit);

    return (
        <>
            <ul className="rounded-[18px] bg-card border border-[color:var(--line-2)] divide-y divide-[color:var(--line-2)] px-4" data-testid="member-list">
                {members.map((m) => {
                    const isSelf = m.id === currentUserId;
                    const cents = m.balanceCents ?? 0;
                    const open = Math.abs(cents) > 1;
                    return (
                        <li key={m.id} className="flex items-center gap-3 py-2.5 min-h-[60px]" data-testid="member-row">
                            <span className="h-10 w-10 flex-none rounded-full bg-[var(--track)] flex items-center justify-center overflow-hidden text-sm font-bold text-muted-foreground" aria-hidden="true">
                                {isAvatarUrl(m.avatar) ? (
                                    // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions
                                    <img src={m.avatar!} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                ) : (
                                    (m.avatar ?? "").trim() || m.name.charAt(0).toUpperCase()
                                )}
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="flex min-w-0 text-[15px] font-semibold">
                                    <span className="truncate">{m.name}</span>
                                    {isSelf && <span className="flex-none whitespace-pre text-muted-foreground font-normal"> (tú)</span>}
                                </span>
                                <span className="block truncate text-[12.5px] text-muted-foreground">
                                    {ROLE_LABEL[m.role] ?? "Miembro"}
                                    {m.isGuest && m.role !== MembershipRole.GUEST && " · Invitado"}
                                </span>
                            </span>
                            {m.balanceCents !== undefined && (
                                <span
                                    className={cn(
                                        "flex-none text-sm font-semibold tabular-nums",
                                        open && cents > 0 && "text-[color:var(--positive)]",
                                        open && cents < 0 && "text-[color:var(--negative)]",
                                        !open && "text-muted-foreground",
                                    )}
                                >
                                    {!open ? "Al día" : `${cents > 0 ? "+" : "−"}${formatCurrency(Math.abs(cents))}`}
                                </span>
                            )}
                            {canEdit(m) && (
                                <button
                                    type="button"
                                    onClick={() => openMember(m)}
                                    aria-label={`Opciones de ${m.name}`}
                                    data-owner-candidate={(isOwner && m.role !== MembershipRole.GUEST && !m.isGuest) || undefined}
                                    className="h-11 w-11 -mr-2 flex-none rounded-xl flex items-center justify-center text-muted-foreground hover:bg-[var(--track)]"
                                >
                                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                                </button>
                            )}
                            {/* Keeps every balance in the same column when only some rows have ⋯. */}
                            {anyEditable && !canEdit(m) && <span aria-hidden="true" className="w-11 -mr-2 flex-none" />}
                        </li>
                    );
                })}
            </ul>

            {editing && (
                <Sheet title={editing.name} onClose={() => setEditing(null)}>
                    <MemberSheetBody
                        member={editing}
                        settleHref={settleHref}
                        canRole={isOwner && editing.role !== MembershipRole.GUEST && !editing.isGuest}
                        canRemove={canManage && !(editing.role === MembershipRole.OWNER && !isOwner)}
                        confirmOwner={confirmOwner}
                        busy={busy || refreshing}
                        error={error}
                        onRole={(role) => {
                            if (role === MembershipRole.OWNER) setConfirmOwner(true);
                            else void setRole(editing, role);
                        }}
                        onConfirmOwner={() => void setRole(editing, MembershipRole.OWNER)}
                        onCancelOwner={() => setConfirmOwner(false)}
                        onRemove={() => {
                            setError(null);
                            setErrorHref(null);
                            setRemoving(editing);
                            setEditing(null);
                        }}
                        onRemind={() => void remind(editing)}
                    />
                </Sheet>
            )}

            {removing && (
                <CriticalActionSheet
                    testId="remove-sheet"
                    tone="danger"
                    title={`¿Quitar a ${removing.name}?`}
                    consequences={[
                        `${removing.name} dejará de ver ${spaceName} con sus gastos y listas. Para volver necesitará un enlace nuevo.`,
                        "Su historial se conserva: sus gastos y pagos siguen en las cuentas.",
                    ]}
                    confirmLabel={`Quitar a ${removing.name}`}
                    busy={busy}
                    error={error}
                    errorHref={errorHref}
                    onConfirm={() => void remove(removing)}
                    onClose={() => setRemoving(null)}
                />
            )}

            {toast && <EqToast>{toast}</EqToast>}
        </>
    );
}

function MemberSheetBody({
    member,
    settleHref,
    canRole,
    canRemove,
    confirmOwner,
    busy,
    error,
    onRole,
    onConfirmOwner,
    onCancelOwner,
    onRemove,
    onRemind,
}: {
    member: SpaceMember;
    settleHref: string;
    canRole: boolean;
    canRemove: boolean;
    confirmOwner: boolean;
    busy: boolean;
    error: string | null;
    onRole: (role: MembershipRole) => void;
    onConfirmOwner: () => void;
    onCancelOwner: () => void;
    onRemove: () => void;
    onRemind: () => void;
}) {
    const cents = member.balanceCents ?? 0;
    const open = Math.abs(cents) > 1;
    const pair = member.pairCents ?? 0;
    const amount = formatCurrency(Math.abs(cents));
    const linkCls = "min-h-11 flex items-center justify-center rounded-[14px] px-4 text-sm font-semibold";

    return (
        <div className="flex flex-col gap-4">
            {canRole && (
                <fieldset className="flex flex-col gap-2">
                    <legend className="text-xs font-semibold text-muted-foreground pb-2">Rol</legend>
                    {ASSIGNABLE.map((o) => {
                        const selected = member.role === o.role;
                        const pending = confirmOwner && o.role === MembershipRole.OWNER;
                        return (
                            <div key={o.role} className="flex flex-col gap-2">
                                <button
                                    type="button"
                                    aria-pressed={selected}
                                    aria-expanded={o.role === MembershipRole.OWNER && !selected ? pending : undefined}
                                    disabled={busy || selected}
                                    onClick={() => onRole(o.role)}
                                    className={cn(
                                        "min-h-14 rounded-[14px] border px-3.5 py-2.5 text-left",
                                        selected || pending ? "border-2 border-primary" : "border-[color:var(--line)]",
                                    )}
                                >
                                    <span className="block text-[15px] font-semibold">{o.label}</span>
                                    <span className="block text-[12.5px] text-muted-foreground">{o.hint}</span>
                                </button>
                                {pending && (
                                    <div className="rounded-[14px] bg-[var(--track)] px-3.5 py-3 flex flex-col gap-2" data-testid="owner-confirm">
                                        <p className="text-sm leading-[1.45]">
                                            {member.name} podrá cambiar roles, quitar a personas (también a ti) y archivar el espacio.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={onConfirmOwner}
                                            disabled={busy}
                                            className={cn(linkCls, "bg-primary text-primary-foreground disabled:opacity-50")}
                                        >
                                            Hacer propietaria a {member.name}
                                        </button>
                                        <button type="button" onClick={onCancelOwner} disabled={busy} className={cn(linkCls, "text-muted-foreground")}>
                                            Cancelar
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </fieldset>
            )}

            {canRole && canRemove && <hr className="border-[color:var(--line-2)]" />}

            {canRemove && !open && (
                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        onClick={onRemove}
                        disabled={busy}
                        data-testid="member-remove"
                        className="min-h-12 rounded-[14px] bg-[var(--negative-tint)] px-4 py-3 text-[color:var(--negative-ink)] text-sm font-semibold break-words disabled:opacity-50"
                    >
                        Quitar a {member.name} del espacio
                    </button>
                    <p className="text-xs text-muted-foreground">Quitar a alguien no borra su historial: sus gastos y pagos se conservan.</p>
                </div>
            )}

            {canRemove && open && (
                <div className="rounded-[14px] bg-[var(--track)] px-3.5 py-3 flex flex-col gap-1" data-testid="member-balance-block">
                    <p className="text-[15px] font-semibold tabular-nums">
                        {cents < 0 ? `${member.name} debe ${amount} en este espacio` : `A ${member.name} le deben ${amount}`}
                    </p>
                    <p className="text-[13px] text-muted-foreground leading-[1.45]">
                        {cents < 0 || pair < 0
                            ? "Para quitarle, primero hay que saldar su deuda."
                            : "Cuando se salde su deuda podrás quitarle."}
                    </p>
                    <div className="mt-1 flex flex-col gap-1.5">
                        {cents < 0 && (
                            <button
                                type="button"
                                onClick={onRemind}
                                data-testid="member-remind"
                                className={cn(linkCls, pair > 0 ? "border border-[color:var(--line)] bg-card" : "bg-primary text-primary-foreground")}
                            >
                                Recordarle la deuda a {member.name}
                            </button>
                        )}
                        {pair !== 0 && (
                            <Link href={settleHref} data-testid="member-settle" className={cn(linkCls, "bg-primary text-primary-foreground")}>
                                Saldar deuda
                            </Link>
                        )}
                    </div>
                </div>
            )}

            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
