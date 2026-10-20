import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { capFor, hasOpenBalance, settleUrlFor } from "@/lib/space-policy";
import { MembershipStatus, SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { archiveBlockReason, spaceTypeMeta, spaceStatusMeta } from "@/lib/space-ui";
import { SpaceStatusBanner } from "@/components/space/space-status-banner";
import { MemberList, type SpaceMember } from "@/components/space/member-list";
import { InviteManager } from "@/components/space/invite-manager";
import { inviteConfigFor } from "@/components/space/invite-eligibility";
import { RenameSpace } from "@/components/space/rename-space";
import { LeaveSpace } from "@/components/space/leave-space";
import { ArchiveSpaceAction, SpaceActions } from "./actions-client";

export const dynamic = "force-dynamic";

/** Why a manager can't create an invite link right now. */
function noInviteReason(type: SpaceType, status: SpaceStatus, memberCount: number, ephemeralOn: boolean): string {
    if (status === SpaceStatus.ARCHIVED) return "El espacio está archivado: no admite personas nuevas.";
    if (status === SpaceStatus.SETTLING) return "Estáis cerrando cuentas: no se admiten personas nuevas.";
    if (type === SpaceType.EPHEMERAL && !ephemeralOn) return "Los enlaces para invitados no están disponibles.";
    if (memberCount >= capFor(type)) {
        return type === SpaceType.COUPLE
            ? "La pareja está completa. Conviértela en grupo para invitar a más personas."
            : "El espacio está completo.";
    }
    return "Ahora mismo no se pueden crear enlaces.";
}

/** Members can't mint links: tell them who can (instead of hiding invitations silently). */
function memberInviteHint(members: SpaceMember[]): string {
    const owner = members.find((m) => m.role === "OWNER");
    const who = owner ? owner.name.trim().split(/\s+/)[0] : null;
    return who
        ? `Solo quien administra el espacio puede invitar. Pídele un enlace a ${who}.`
        : "Solo quien administra el espacio puede invitar.";
}

/**
 * Space management (EQUIL): members with roles and balances, invite links,
 * lifecycle, rename and leave. Authorized against THIS space's Membership (not
 * the active-space cookie). Guests are caged to Inicio/Gastos/Saldar, so they are
 * sent back to their dashboard instead of seeing dead links here.
 */
export default async function SpaceManagePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    if (session.kind === "guest") redirect("/dashboard");
    const userId = session.userId as string;

    const [space, myMembership] = await Promise.all([
        prisma.couple.findUnique({
            where: { id },
            select: { id: true, name: true, type: true, status: true, expiresAt: true },
        }),
        prisma.membership.findUnique({ where: { groupId_userId: { groupId: id, userId } } }),
    ]);
    if (!space) redirect("/spaces");
    if (!myMembership || myMembership.status !== MembershipStatus.ACTIVE) redirect("/spaces");
    if (myMembership.role === "GUEST") redirect("/dashboard");

    const [roster, balances, pendingPayments, myPending] = await Promise.all([
        prisma.membership.findMany({
            where: { groupId: id, status: MembershipStatus.ACTIVE },
            include: { user: { select: { id: true, name: true, avatar: true, isGuest: true } } },
            orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
        }),
        getGroupBalances(id),
        prisma.settlement.count({ where: { coupleId: id, status: "PENDING" } }),
        prisma.settlement.findFirst({
            where: { coupleId: id, status: "PENDING", fromUserId: userId },
            orderBy: { createdAt: "desc" },
            select: { id: true, amount: true, method: true, toUser: { select: { name: true } } },
        }),
    ]);

    // What I settle with each member in the simplified plan (the same matching
    // /settle and /close use): they owe me (+) or I owe them (−).
    const iOwe = resolveMyDebts(balances, userId);
    const pairWith = (uid: string) => (resolveMyDebts(balances, uid)[userId] ?? 0) - (iOwe[uid] ?? 0);
    const members: SpaceMember[] = roster.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar ?? null,
        role: m.role,
        isGuest: m.user.isGuest,
        balanceCents: balances[m.user.id] ?? 0,
        pairCents: m.user.id === userId ? 0 : pairWith(m.user.id),
    }));

    const typeMeta = spaceTypeMeta(space.type);
    const statusMeta = spaceStatusMeta(space.status);
    const canManage = myMembership.role === "OWNER" || myMembership.role === "ADMIN";
    const archived = space.status === SpaceStatus.ARCHIVED;
    const displayName = space.name ?? typeMeta.label;
    const ephemeralOn = ephemeralSpacesEnabled();
    const invite = inviteConfigFor(
        { type: space.type, status: space.status, role: myMembership.role, memberCount: members.length },
        ephemeralOn,
    );
    const settleHref = settleUrlFor(space.id);
    // Same rule as the archive guard of the API (it still answers 409 if this goes stale).
    const openDebts = Object.values(balances).filter((c) => c < 0 && hasOpenBalance(c)).length;
    const showArchive = canManage && space.status === SpaceStatus.SETTLING;
    // "Salir": the first sheet already knows my debt, who sees it and whether I'm the last owner.
    const nameOf = new Map(roster.map((m) => [m.user.id, m.user.name]));
    const creditors = Object.entries(iOwe)
        .filter(([uid, c]) => hasOpenBalance(c) && nameOf.has(uid))
        .map(([uid]) => nameOf.get(uid) as string);
    const ownerCount = roster.filter((m) => m.role === "OWNER").length;

    return (
        <div className="min-h-screen pb-28 eq-in">
            <header className="px-5 pt-3 flex items-center">
                <Link href="/spaces" aria-label="Volver a Espacios" className="-ml-2.5 h-11 w-11 flex items-center justify-center">
                    <ArrowLeft className="h-6 w-6" aria-hidden="true" />
                </Link>
            </header>

            <div className="px-5 pt-2 flex items-center gap-3">
                <span
                    aria-hidden="true"
                    className="h-14 w-14 flex-none rounded-[18px] bg-[var(--accent-tint)] flex items-center justify-center text-[26px]"
                >
                    {typeMeta.emoji}
                </span>
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-bold tracking-[-0.02em] break-words">{displayName}</h1>
                    <p data-testid="space-header-status" data-status={space.status} className="text-[13px] text-muted-foreground">
                        {typeMeta.label} · {statusMeta.label}
                    </p>
                </div>
                {canManage && !archived && <RenameSpace spaceId={space.id} name={displayName} />}
            </div>

            <div className="px-5 pt-5 flex flex-col gap-6">
                <SpaceStatusBanner
                    spaceId={space.id}
                    type={space.type}
                    status={space.status}
                    expiresAt={space.expiresAt}
                    canManage={canManage}
                    settleHref={settleHref}
                    openDebts={openDebts}
                    myBalanceOpen={hasOpenBalance(balances[userId] ?? 0)}
                />

                <section aria-labelledby="members-title" className="flex flex-col gap-2">
                    <h2 id="members-title" className="text-xs font-semibold text-muted-foreground">Miembros ({members.length})</h2>
                    <MemberList
                        spaceId={space.id}
                        spaceName={displayName}
                        members={members}
                        currentUserId={userId}
                        myRole={myMembership.role}
                        readOnly={archived}
                    />
                </section>

                {canManage ? (
                    <section aria-labelledby="invites-title" className="flex flex-col gap-2">
                        <h2 id="invites-title" className="text-xs font-semibold text-muted-foreground">Invitaciones</h2>
                        <InviteManager
                            spaceId={space.id}
                            kind={invite?.kind ?? null}
                            maxUsesCap={invite?.maxUses ?? 1}
                            reason={noInviteReason(space.type, space.status, members.length, ephemeralOn)}
                        />
                    </section>
                ) : (
                    !archived && (
                        <section aria-labelledby="invites-title" className="flex flex-col gap-2">
                            <h2 id="invites-title" className="text-xs font-semibold text-muted-foreground">Invitaciones</h2>
                            <p className="text-[13px] text-muted-foreground">{memberInviteHint(members)}</p>
                        </section>
                    )
                )}

                {canManage && !archived && (
                    <section aria-labelledby="manage-title" className="flex flex-col gap-2">
                        <h2 id="manage-title" className="text-xs font-semibold text-muted-foreground">Gestión</h2>
                        <SpaceActions
                            spaceId={space.id}
                            spaceName={displayName}
                            type={space.type}
                            status={space.status}
                            settleHref={settleHref}
                        />
                    </section>
                )}

                <section aria-labelledby="danger-title" className="mt-4 flex flex-col gap-2">
                    <h2 id="danger-title" className="text-xs font-semibold text-muted-foreground">Zona de peligro</h2>
                    {showArchive && (
                        <ArchiveSpaceAction
                            spaceId={space.id}
                            spaceName={displayName}
                            blockReason={archiveBlockReason(pendingPayments, openDebts)}
                        />
                    )}
                    <LeaveSpace
                        spaceId={space.id}
                        userId={userId}
                        spaceName={displayName}
                        balanceCents={balances[userId] ?? 0}
                        creditors={creditors}
                        pendingPayment={
                            myPending
                                ? { id: myPending.id, toName: myPending.toUser.name, amountCents: myPending.amount, method: myPending.method }
                                : null
                        }
                        lastOwner={myMembership.role === "OWNER" && ownerCount <= 1 && roster.length > 1}
                        lastPerson={roster.length === 1}
                        settleHref={settleHref}
                    />
                </section>
            </div>
        </div>
    );
}
