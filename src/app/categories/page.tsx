import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup, getMembership } from "@/lib/membership";
import { redirect } from "next/navigation";
import { getEffectiveCategories } from "@/lib/category-db";
import { allowsCustomCategories } from "@/lib/space-policy";
import { MembershipRole, SpaceStatus } from "@/generated/prisma/enums";
import type { CategoryListItem } from "@/lib/category-context";
import { CategoriesClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * Category management view (Fase 5) — sibling of /tags and /budget.
 *
 * Server-renders both scopes' effective sets (system ∪ custom, ordered by
 * sortOrder,key) so the first paint isn't a flash. Whether the caller may manage
 * the SHARED (space) categories is resolved here against the DB Membership role
 * and the space status — CRUD is OWNER/ADMIN only (decision #6) and blocked in
 * SETTLING/ARCHIVED. Personal categories are always self-managed (session-auth).
 */
export default async function CategoriesPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const groupId = await getActiveGroup(userId);
    const hasGroup = Boolean(groupId);

    const withEditable = (list: Awaited<ReturnType<typeof getEffectiveCategories>>): CategoryListItem[] =>
        list.map((c) => ({ ...c, editable: !c.isSystem }));

    let spaceStatus: string | null = null;
    let role: string | null = null;
    let canManageShared = false;
    let sharedInitial: CategoryListItem[] = [];

    if (groupId) {
        const [space, membership, merged] = await Promise.all([
            prisma.couple.findUnique({ where: { id: groupId }, select: { status: true, type: true } }),
            getMembership(groupId, userId),
            getEffectiveCategories({ groupId }),
        ]);
        spaceStatus = space?.status ?? null;
        role = membership?.role ?? null;
        const isManagerRole = role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
        const writable = space?.status === SpaceStatus.ACTIVE;
        const typeAllows = space ? allowsCustomCategories(space.type) : false;
        canManageShared = isManagerRole && writable && typeAllows;
        sharedInitial = withEditable(merged);
    }

    // Personal set is always available (INDIVIDUAL mode home + a user's own
    // categories inside a group), seeded so the Personal tab paints instantly.
    const personalInitial = withEditable(await getEffectiveCategories({ ownerId: userId }));

    return (
        <CategoriesClient
            hasGroup={hasGroup}
            groupId={groupId}
            spaceStatus={spaceStatus}
            role={role}
            canManageShared={canManageShared}
            sharedInitial={sharedInitial}
            personalInitial={personalInitial}
        />
    );
}
