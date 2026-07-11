import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users, ShoppingCart, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MembershipStatus } from "@/generated/prisma/enums";
import { spaceTypeMeta, spaceStatusMeta } from "@/lib/space-ui";
import { SpaceStatusBanner } from "@/components/space/space-status-banner";
import { MemberList, type SpaceMember } from "@/components/space/member-list";
import { InviteManager } from "@/components/space/invite-manager";
import { SpaceActions } from "./actions-client";

export const dynamic = "force-dynamic";

export default async function SpaceManagePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Authorize against the RESOURCE's group: the caller must be an ACTIVE member.
    const [space, myMembership] = await Promise.all([
        prisma.couple.findUnique({ where: { id } }),
        prisma.membership.findUnique({ where: { groupId_userId: { groupId: id, userId } } }),
    ]);
    if (!space) redirect("/settings");
    if (!myMembership || myMembership.status !== MembershipStatus.ACTIVE) redirect("/settings");

    const roster = await prisma.membership.findMany({
        where: { groupId: id, status: MembershipStatus.ACTIVE },
        include: { user: true },
        orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    });

    const members: SpaceMember[] = roster.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        avatar: m.user.avatar ?? null,
        role: m.role,
        isGuest: m.user.isGuest,
    }));

    const typeMeta = spaceTypeMeta(space.type);
    const statusMeta = spaceStatusMeta(space.status);
    const canManage = myMembership.role === "OWNER" || myMembership.role === "ADMIN";

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-3 pt-2">
                <Link href="/settings">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-10 h-10 rounded-[12px] bg-secondary flex items-center justify-center text-[20px] shrink-0">
                        {typeMeta.emoji}
                    </span>
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold text-foreground truncate">{space.name ?? typeMeta.label}</h1>
                        <p className="text-[12px] text-muted-foreground">
                            {typeMeta.label} · {statusMeta.label}
                        </p>
                    </div>
                </div>
            </header>

            <SpaceStatusBanner
                spaceId={space.id}
                type={space.type}
                status={space.status}
                expiresAt={space.expiresAt}
                canManage={canManage}
            />

            <section className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                    <Users className="h-4 w-4 text-primary" />
                    <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">
                        Miembros ({members.length})
                    </h2>
                </div>
                <MemberList spaceId={space.id} members={members} currentUserId={userId} myRole={myMembership.role} />
            </section>

            <section className="space-y-3">
                <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground px-1">Invitaciones</h2>
                <InviteManager spaceId={space.id} type={space.type} status={space.status} initialCode={space.code} canManage={canManage} />
            </section>

            <section className="space-y-3">
                <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground px-1">Listas</h2>
                <Link
                    href="/lists"
                    className="flex items-center gap-3 w-full h-14 px-4 bg-card border border-[color:var(--line)] rounded-xl hover:bg-secondary transition-colors"
                >
                    <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                    <span className="font-medium text-sm text-foreground flex-1">Listas de la compra</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
            </section>

            {canManage && (
                <section className="space-y-3">
                    <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground px-1">Gestión</h2>
                    <SpaceActions spaceId={space.id} type={space.type} status={space.status} />
                </section>
            )}
        </div>
    );
}
