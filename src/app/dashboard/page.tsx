import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup, getGroupMembers } from "@/lib/membership";
import { materializeDueRecurringExpenses, materializeDueRecurringExpensesForOwner } from "@/lib/recurring";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { getIconComponent } from "@/lib/category-icons";
import { formatCurrency } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { spaceTypeMeta } from "@/lib/space-ui";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { getSettlementStatusLabel } from "@/lib/settlement-labels";
import { getPersonalMonthTotal, getSpaceSummaries, type SpaceSummary } from "@/lib/space-summaries";
import {
    absEuros,
    balanceTone,
    balanceWords,
    cardSub,
    categorySlices,
    dayLabel,
    expenseSub,
    firstName,
    madridMonthName,
    madridMonthStart,
    signedEuros,
} from "@/lib/home-format";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { EqLabel, EqRow } from "@/components/ui/eq";
import { SpaceCarousel, type SpaceCardData } from "@/components/dashboard/space-carousel";
import { MonthSummary } from "@/components/dashboard/month-summary";
import { SavedToast } from "@/components/dashboard/saved-toast";
import { PendingSettlements } from "@/components/dashboard/pending-settlements";
import { SpaceStatusBanner } from "@/components/space/space-status-banner";
import { SpaceInviteCard } from "@/components/space/space-invite-card";
import { SpaceActionTiles } from "@/components/space/space-action-tiles";
import { inviteConfigFor } from "@/components/space/invite-eligibility";
import { PERSONAL_KEY } from "@/components/space/space-keys";
import { GuestBanner } from "@/components/guest/guest-banner";
import { SpaceStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

/** Display name of a space (falls back to its type label). */
function spaceName(s: Pick<SpaceSummary, "name" | "type">): string {
    return s.name ?? spaceTypeMeta(s.type).label;
}

/**
 * Inicio (prototype `is.home`). One context at a time: the ACTIVE shared space
 * (the `active_group` cookie, validated against Membership) or the personal
 * INDIVIDUAL context (`?scope=personal`). `?scope=comun` and no param both mean
 * "the active shared space" (the old combined "todo" lens is gone). `?saved=<cents>`
 * shows a one-shot "Gasto guardado" toast and is then stripped from the URL.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    // A GUEST session is caged to its EPHEMERAL space with no personal economy.
    const isGuest = session.kind === "guest";

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        return <div className="p-10 text-center">Usuario no encontrado. <Link href="/login" className="underline">Login de nuevo</Link></div>;
    }

    const now = new Date();
    const monthStart = madridMonthStart(now);
    const activeGroupId = await getActiveGroup(userId);
    const { scope } = await searchParams;
    const personalActive = !isGuest && (!activeGroupId || scope === "personal");

    // Lazily materialize due recurring expenses so balances/totals include them.
    // A failure here must never block the render.
    try {
        if (activeGroupId) await materializeDueRecurringExpenses(activeGroupId);
        if (!isGuest) await materializeDueRecurringExpensesForOwner(userId);
    } catch (err) {
        console.error("Failed to materialize recurring expenses", err);
    }

    const [summaries, personalMonthCents] = await Promise.all([
        getSpaceSummaries(userId, monthStart),
        isGuest ? Promise.resolve(0) : getPersonalMonthTotal(userId, monthStart),
    ]);
    const active = personalActive ? null : summaries.find((s) => s.id === activeGroupId) ?? null;
    const activeKey = active ? active.id : PERSONAL_KEY;

    // --- Carousel cards: live spaces (+ the active one even if archived) + Personal.
    const cards: SpaceCardData[] = summaries
        .filter((s) => s.status !== SpaceStatus.ARCHIVED || s.id === active?.id)
        .map((s) => {
            const solo = s.others.length === 0;
            const isActive = s.id === active?.id;
            return {
                key: s.id,
                title: `${spaceTypeMeta(s.type).emoji} ${spaceName(s)}`,
                sub: cardSub(s.others),
                label: solo ? "Este mes" : balanceWords(s.balanceCents, s.others),
                amount: absEuros(solo ? s.monthTotalCents : s.balanceCents),
                tone: solo ? "neutral" : balanceTone(s.balanceCents),
                signed: solo ? null : signedEuros(s.balanceCents),
                showSettle: isActive && !solo && s.balanceCents !== 0 && s.status !== SpaceStatus.ARCHIVED,
            };
        });
    if (!isGuest) {
        cards.push({
            key: PERSONAL_KEY,
            title: "👤 Personal",
            sub: "Solo tú",
            label: "Personal este mes",
            amount: formatCurrency(personalMonthCents),
            tone: "neutral",
            signed: null,
            showSettle: false,
        });
    }

    // --- Active context data (month split + recent movements).
    const categoryList = await getEffectiveCategories(active ? { groupId: active.id } : { ownerId: userId });
    const catMap = categoryMetaMap(categoryList);
    const metaFor = (key: string) => catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META;

    const expenseWhere = active
        ? { coupleId: active.id, visibility: "SHARED" as const }
        : { ownerId: userId, visibility: "PERSONAL" as const };

    const [monthExpenses, recentExpenses, recentSettlements, pendingToMe, members] = await Promise.all([
        prisma.expense.findMany({
            where: { ...expenseWhere, date: { gte: monthStart } },
            select: { amount: true, ...CATEGORY_REF_SELECT },
        }),
        prisma.expense.findMany({
            where: expenseWhere,
            orderBy: [{ date: "desc" }, { id: "desc" }],
            take: 4,
            include: { splits: { select: { userId: true, amount: true } }, ...CATEGORY_REF_SELECT },
        }),
        active
            ? prisma.settlement.findMany({
                where: { coupleId: active.id, status: { in: ["PENDING", "CONFIRMED"] } },
                orderBy: [{ date: "desc" }, { id: "desc" }],
                take: 4,
            })
            : Promise.resolve([]),
        active
            ? prisma.settlement.findMany({
                where: { coupleId: active.id, toUserId: userId, status: "PENDING" },
                orderBy: { date: "desc" },
            })
            : Promise.resolve([]),
        active ? getGroupMembers(active.id) : Promise.resolve([]),
    ]);

    const names: Record<string, string> = Object.fromEntries(members.map((m) => [m.id, m.name]));
    names[userId] = user.name;
    const avatars: Record<string, string | null> = Object.fromEntries(members.map((m) => [m.id, m.avatar ?? null]));

    const totals: Record<string, number> = {};
    for (const e of monthExpenses) {
        const k = categoryKeyOf(e);
        totals[k] = (totals[k] ?? 0) + e.amount;
    }
    const slices = categorySlices(totals, metaFor);
    const monthTotal = monthExpenses.reduce((a, e) => a + e.amount, 0);
    const contextName = active ? spaceName(active) : "Personal";

    type Row = { id: string; date: Date; node: React.ReactNode };
    const rows: Row[] = [
        ...recentExpenses.map((e) => {
            const meta = metaFor(categoryKeyOf(e));
            const Icon = getIconComponent(meta.iconName);
            const how = active
                ? expenseSub({ payerId: e.paidById, meId: userId, splits: e.splits, names, memberCount: active.memberCount })
                : meta.label;
            return {
                id: e.id,
                date: e.date,
                node: (
                    <EqRow
                        key={e.id}
                        href={`/expense/${e.id}`}
                        icon={<Icon className="h-[18px] w-[18px]" style={{ color: meta.hex }} aria-hidden="true" />}
                        title={e.description}
                        sub={`${how} · ${dayLabel(e.date, now)}`}
                        amount={formatCurrency(e.amount)}
                    />
                ),
            };
        }),
        ...recentSettlements.map((s) => ({
            id: s.id,
            date: s.date,
            node: (
                <EqRow
                    key={s.id}
                    href={`/settle/${s.id}`}
                    iconTint
                    icon={<Check className="h-[18px] w-[18px]" aria-hidden="true" />}
                    title="Liquidación"
                    sub={`${names[s.fromUserId] ?? "Alguien"} → ${names[s.toUserId] ?? "Alguien"} · ${getSettlementStatusLabel(s.status)} · ${dayLabel(s.date, now)}`}
                    amount={formatCurrency(s.amount)}
                    amountClassName="text-[color:var(--positive)]"
                />
            ),
        })),
    ]
        .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id))
        .slice(0, 4);

    const pending = pendingToMe.map((s) => ({
        id: s.id,
        amount: s.amount,
        fromUser: { name: names[s.fromUserId] ?? "Alguien", avatar: avatars[s.fromUserId] ?? null },
        date: s.date.toISOString(),
        method: s.method,
    }));

    const invite = active && active.others.length === 0 ? inviteConfigFor(active, ephemeralSpacesEnabled()) : null;
    const canManage = active?.role === "OWNER" || active?.role === "ADMIN";
    // `avatar` holds either an uploaded image URL or an emoji; else the initial.
    const avatarRaw: string = user.avatar ?? "";
    const avatarText = avatarRaw.trim() || user.name.charAt(0).toUpperCase();

    return (
        <div className="min-h-screen pb-28 eq-in">
            <header className="flex items-center justify-between px-5 pt-4 pb-3">
                <h1 className="text-[22px] font-bold tracking-[-0.02em] truncate">Hola, {firstName(user.name)}</h1>
                <Link
                    href={isGuest ? "/guest/upgrade" : "/settings"}
                    aria-label={isGuest ? "Crear cuenta" : "Ajustes de tu cuenta"}
                    className="h-[38px] w-[38px] flex-none rounded-full bg-[var(--surface-raised-hex)] flex items-center justify-center text-sm font-bold overflow-hidden"
                >
                    {isAvatarUrl(user.avatar) ? (
                        // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
                        <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                        avatarText
                    )}
                </Link>
            </header>

            {isGuest && (
                <div className="px-5 pb-3">
                    <GuestBanner show />
                </div>
            )}

            <SpaceCarousel
                cards={cards}
                activeKey={activeKey}
                spacesHref={isGuest ? null : personalActive ? "/spaces?active=personal" : "/spaces"}
                locked={isGuest}
            />

            <div className="flex flex-col gap-5 px-5 pt-[18px]">
                {active && (
                    <SpaceStatusBanner
                        spaceId={active.id}
                        type={active.type}
                        status={active.status}
                        expiresAt={active.expiresAt}
                        canManage={canManage}
                    />
                )}

                {pending.length > 0 && <PendingSettlements settlements={pending} />}

                {active && invite && (
                    <SpaceInviteCard spaceId={active.id} spaceName={spaceName(active)} kind={invite.kind} maxUses={invite.maxUses} />
                )}

                <MonthSummary title={`${madridMonthName(now)} en ${contextName}`} total={formatCurrency(monthTotal)} slices={slices} />

                <section aria-labelledby="recent-title" className="flex flex-col">
                    <div className="flex items-center justify-between pb-1">
                        <EqLabel id="recent-title">Recientes</EqLabel>
                        <div className="flex gap-3 text-xs font-semibold text-primary">
                            {personalActive && <Link href="/expenses/import">Importar CSV</Link>}
                            <Link href="/expenses/list">Ver todo</Link>
                        </div>
                    </div>
                    {rows.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            {active ? "Aún no hay gastos en este espacio." : "Aún no hay gastos personales."}
                        </p>
                    ) : (
                        <div className="flex flex-col">{rows.map((r) => r.node)}</div>
                    )}
                </section>

                {/* A user with no shared space: optional, non-blocking way in. */}
                {!isGuest && summaries.length === 0 && (
                    <section aria-labelledby="share-title" className="flex flex-col gap-2.5">
                        <EqLabel id="share-title">¿Gastos compartidos?</EqLabel>
                        <SpaceActionTiles />
                    </section>
                )}
            </div>

            {/* `?saved=<cents>` from /expenses/new → one-shot confirmation toast. */}
            <Suspense fallback={null}>
                <SavedToast />
            </Suspense>
        </div>
    );
}
