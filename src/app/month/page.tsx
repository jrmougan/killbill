import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup } from "@/lib/membership";
import { getEffectiveCategories } from "@/lib/category-db";
import { monthRange } from "@/lib/month-range";
import { spaceTypeMeta, SPACE_TYPE_META } from "@/lib/space-ui";
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";
import { daysLeftInMonth, monthName, monthShort, normalizeMonthView, type MonthScope } from "@/components/month/format";
import { MonthClient } from "@/components/month/month-client";
import { loadAnalysis, loadBudgets } from "./data";

export const dynamic = "force-dynamic";

// "Mes" tab (EQUIL): Presupuestos | Análisis for the active space, or for the
// caller's personal economy (`?scope=personal`, or when they have no group).
export default async function MonthPage({
    searchParams,
}: {
    searchParams: Promise<{ view?: string | string[]; scope?: string | string[] }>;
}) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    const params = await searchParams;

    const groupId = await getActiveGroup(userId);
    const wantsPersonal = (Array.isArray(params.scope) ? params.scope[0] : params.scope) === "personal";
    const scope: MonthScope = groupId && !wantsPersonal ? "shared" : "personal";
    const view = normalizeMonthView(params.view);

    const [group, memberCount, categories] = await Promise.all([
        groupId
            ? prisma.couple.findUnique({ where: { id: groupId }, select: { name: true, type: true, status: true } })
            : null,
        groupId && scope === "shared" ? prisma.membership.count({ where: { groupId, status: "ACTIVE" } }) : 0,
        getEffectiveCategories(scope === "shared" ? { groupId: groupId! } : { ownerId: userId }),
    ]);

    const now = new Date();
    const where = { scope, userId, groupId };
    const [{ budgets, spentByCategory }, analysis] = await Promise.all([
        loadBudgets(where, now),
        loadAnalysis(where, now, categories, memberCount),
    ]);

    const personal = SPACE_TYPE_META[SpaceType.INDIVIDUAL];
    const groupMeta = group ? spaceTypeMeta(group.type) : null;
    const groupName = group ? group.name ?? groupMeta!.label : null;
    const space = scope === "shared"
        ? { emoji: groupMeta!.emoji, name: groupName! }
        : { emoji: personal.emoji, name: personal.label };
    // The other lens the header meta toggles to (only when the user has a group).
    const alt = groupName
        ? scope === "shared"
            ? { name: personal.label, scope: "personal" as const }
            : { name: groupName, scope: "shared" as const }
        : null;
    // Lifecycle of the space whose budgets are shown: SETTLING/ARCHIVED → read-only.
    const spaceStatus = scope === "shared" && group ? group.status : SpaceStatus.ACTIVE;

    return (
        <MonthClient
            initialView={view}
            scope={scope}
            groupId={scope === "shared" ? groupId : null}
            spaceStatus={spaceStatus}
            space={space}
            alt={alt}
            monthName={monthName(now)}
            prevMonthShort={monthShort(monthRange(now, -1).start)}
            daysLeft={daysLeftInMonth(now)}
            categories={categories.map(({ key, label, emoji, iconName, hex }) => ({ key, label, emoji, iconName, hex }))}
            budgets={budgets}
            spentByCategory={spentByCategory}
            analysis={analysis}
        />
    );
}
