"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAvatarUrl } from "@/lib/avatar";
import { formatCurrency } from "@/lib/currency";
import { Sheet } from "@/components/ui/sheet";
import { MembershipRole } from "@/generated/prisma/enums";

export type SpaceMember = {
    id: string;
    name: string;
    avatar: string | null;
    role: MembershipRole | string;
    isGuest?: boolean;
    /** Net balance in this space (cents, + is owed). */
    balanceCents?: number;
};

const ROLE_LABEL: Record<string, string> = {
    OWNER: "Propietario",
    ADMIN: "Admin",
    MEMBER: "Miembro",
    GUEST: "Invitado",
};

const ASSIGNABLE: { role: MembershipRole; label: string; hint: string }[] = [
    { role: MembershipRole.OWNER, label: "Propietario", hint: "Gestiona todo, incluidos los roles." },
    { role: MembershipRole.ADMIN, label: "Admin", hint: "Invita, quita miembros y gestiona el espacio." },
    { role: MembershipRole.MEMBER, label: "Miembro", hint: "Apunta gastos y salda deudas." },
];

/**
 * Roster of a space (EQUIL): avatar, name, role and balance per member. OWNERs
 * change roles (PATCH …/members/[userId]) — that is how the space is handed over
 * before its only owner leaves; OWNER/ADMIN remove others (DELETE → REMOVED,
 * history kept). Leaving yourself lives in `LeaveSpace`.
 */
export function MemberList({
    spaceId,
    members,
    currentUserId,
    myRole,
    readOnly = false,
}: {
    spaceId: string;
    members: SpaceMember[];
    currentUserId: string;
    myRole: MembershipRole | string;
    /** ARCHIVED: no role changes or removals. */
    readOnly?: boolean;
}) {
    const router = useRouter();
    const [refreshing, startTransition] = useTransition();
    const [editing, setEditing] = useState<SpaceMember | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isOwner = myRole === MembershipRole.OWNER;
    const canManage = isOwner || myRole === MembershipRole.ADMIN;

    const canEdit = (m: SpaceMember) => {
        if (readOnly || m.id === currentUserId) return false;
        const canRole = isOwner && m.role !== MembershipRole.GUEST && !m.isGuest;
        const canRemove = canManage && !(m.role === MembershipRole.OWNER && !isOwner);
        return canRole || canRemove;
    };

    const call = async (url: string, init: RequestInit) => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(url, init);
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                setError(data?.error || "No se pudo completar la acción");
                return;
            }
            setEditing(null);
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
        });

    const remove = (m: SpaceMember) => call(`/api/spaces/${spaceId}/members/${m.id}`, { method: "DELETE" });

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
                                <span className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-muted-foreground">
                                    <span className="min-w-0 truncate">
                                        {ROLE_LABEL[m.role] ?? "Miembro"}
                                        {m.isGuest && m.role !== MembershipRole.GUEST && " · Invitado"}
                                    </span>
                                    {m.balanceCents !== undefined && (
                                        <span
                                            className={cn(
                                                "ml-auto flex-none text-sm font-semibold tabular-nums",
                                                open && cents > 0 && "text-[color:var(--positive)]",
                                                open && cents < 0 && "text-[color:var(--negative)]",
                                            )}
                                        >
                                            {!open ? "En paz" : `${cents > 0 ? "+" : "−"}${formatCurrency(Math.abs(cents))}`}
                                        </span>
                                    )}
                                </span>
                            </span>
                            {canEdit(m) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setError(null);
                                        setEditing(m);
                                    }}
                                    aria-label={`Opciones de ${m.name}`}
                                    className="h-11 w-11 -mr-2 flex-none rounded-xl flex items-center justify-center text-muted-foreground hover:bg-[var(--track)]"
                                >
                                    <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {editing && (
                <Sheet title={editing.name} onClose={() => setEditing(null)}>
                    <div className="flex flex-col gap-4">
                        {isOwner && editing.role !== MembershipRole.GUEST && !editing.isGuest && (
                            <fieldset className="flex flex-col gap-2">
                                <legend className="text-xs font-semibold text-muted-foreground pb-2">Rol</legend>
                                {ASSIGNABLE.map((o) => {
                                    const selected = editing.role === o.role;
                                    return (
                                        <button
                                            key={o.role}
                                            type="button"
                                            aria-pressed={selected}
                                            disabled={busy || refreshing || selected}
                                            onClick={() => setRole(editing, o.role)}
                                            className={cn(
                                                "min-h-14 rounded-[14px] border px-3.5 py-2.5 text-left",
                                                selected ? "border-2 border-primary" : "border-[color:var(--line)]",
                                            )}
                                        >
                                            <span className="block text-[15px] font-semibold">{o.label}</span>
                                            <span className="block text-[12.5px] text-muted-foreground">{o.hint}</span>
                                        </button>
                                    );
                                })}
                            </fieldset>
                        )}
                        {canManage && !(editing.role === MembershipRole.OWNER && !isOwner) && (
                            <button
                                type="button"
                                onClick={() => remove(editing)}
                                disabled={busy || refreshing}
                                data-testid="member-remove"
                                className="min-h-12 rounded-[14px] bg-[var(--negative-tint)] px-4 py-3 text-destructive text-sm font-semibold break-words disabled:opacity-50"
                            >
                                Quitar a {editing.name} del espacio
                            </button>
                        )}
                        <p className="text-xs text-muted-foreground">Quitar a alguien no borra su historial: sus gastos y deudas se conservan.</p>
                        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
                    </div>
                </Sheet>
            )}
        </>
    );
}
