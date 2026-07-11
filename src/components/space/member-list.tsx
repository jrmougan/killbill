"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAvatarUrl } from "@/lib/avatar";
import { Crown, Shield, UserRound, LogOut, UserMinus } from "lucide-react";
import { MembershipRole } from "@/generated/prisma/enums";

export type SpaceMember = {
    id: string;
    name: string;
    avatar: string | null;
    role: MembershipRole | string;
    isGuest?: boolean;
};

const ROLE_META: Record<string, { label: string; icon: typeof Crown }> = {
    OWNER: { label: "Propietario", icon: Crown },
    ADMIN: { label: "Admin", icon: Shield },
    MEMBER: { label: "Miembro", icon: UserRound },
    GUEST: { label: "Invitado", icon: UserRound },
};

/**
 * Roster of a space's members with role badges and removal (Fase 1). Removal is
 * NEVER a physical delete: a self-leave → LEFT, an expulsion by OWNER/ADMIN →
 * REMOVED (via DELETE /api/spaces/[id]/members/[userId]). Guests carry an
 * "Invitado" badge.
 */
export function MemberList({
    spaceId,
    members,
    currentUserId,
    myRole,
}: {
    spaceId: string;
    members: SpaceMember[];
    currentUserId: string;
    myRole: MembershipRole | string;
}) {
    const router = useRouter();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const canManage = myRole === MembershipRole.OWNER || myRole === MembershipRole.ADMIN;

    const remove = async (m: SpaceMember, isSelf: boolean) => {
        const msg = isSelf
            ? "¿Salir de este espacio? Si tiene historial, se archivará para ti."
            : `¿Quitar a ${m.name} del espacio? Conservará su historial de deudas.`;
        if (!confirm(msg)) return;
        setBusyId(m.id);
        setError(null);
        try {
            const res = await fetch(`/api/spaces/${spaceId}/members/${m.id}`, { method: "DELETE" });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                setError(data?.error || "No se pudo completar la acción");
                return;
            }
            if (isSelf) {
                router.push("/settings");
            } else {
                router.refresh();
            }
        } catch {
            setError("Error de conexión");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="space-y-2">
            {members.map((m) => {
                const isSelf = m.id === currentUserId;
                const meta = ROLE_META[m.role] ?? ROLE_META.MEMBER;
                const RoleIcon = meta.icon;
                // An ADMIN can't remove an OWNER; nobody removes via UI except self or by OWNER/ADMIN.
                const canRemoveOther =
                    canManage && !isSelf && !(m.role === MembershipRole.OWNER && myRole !== MembershipRole.OWNER);
                return (
                    <div
                        key={m.id}
                        className="flex items-center gap-3 rounded-xl bg-card border border-[color:var(--line-2)] px-3 py-2.5"
                    >
                        <span className="w-9 h-9 shrink-0 rounded-full bg-secondary border border-[color:var(--line)] flex items-center justify-center overflow-hidden text-sm font-bold text-muted-foreground">
                            {isAvatarUrl(m.avatar) ? (
                                // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions
                                <img src={m.avatar!} alt={m.name} className="w-full h-full object-cover" />
                            ) : (
                                m.name.charAt(0).toUpperCase()
                            )}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">
                                {m.name}
                                {isSelf && <span className="text-muted-foreground font-normal"> (tú)</span>}
                            </p>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <RoleIcon className="h-3 w-3" />
                                {meta.label}
                                {m.isGuest && m.role !== MembershipRole.GUEST && (
                                    <span className="ml-1 px-1.5 py-px rounded bg-secondary text-[10px] font-semibold">Invitado</span>
                                )}
                            </span>
                        </div>
                        {isSelf ? (
                            <button
                                type="button"
                                onClick={() => remove(m, true)}
                                disabled={busyId === m.id}
                                className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary disabled:opacity-50"
                                aria-label="Salir del espacio"
                                title="Salir del espacio"
                            >
                                <LogOut className="h-4 w-4" />
                            </button>
                        ) : canRemoveOther ? (
                            <button
                                type="button"
                                onClick={() => remove(m, false)}
                                disabled={busyId === m.id}
                                className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary disabled:opacity-50"
                                aria-label={`Quitar a ${m.name}`}
                                title={`Quitar a ${m.name}`}
                            >
                                <UserMinus className="h-4 w-4" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
            {error && <p className="text-xs text-destructive px-1">{error}</p>}
        </div>
    );
}
