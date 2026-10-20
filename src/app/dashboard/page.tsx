import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, ChevronRight, Clock, X } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSessionCtx } from "@/lib/authz";
import { getActiveGroup, getGroupMembers } from "@/lib/membership";
import { materializeDueRecurringExpenses, materializeDueRecurringExpensesForOwner } from "@/lib/recurring";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { formatCurrency } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { spaceTypeMeta } from "@/lib/space-ui";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { getSettlementStatusLabel } from "@/lib/settlement-labels";
import { monthRange } from "@/lib/month-range";
import { closeItemCount } from "@/lib/close-plan";
import { debtOf } from "@/components/settle/settle-model";
import { hasOpenBalance, settleUrlFor } from "@/lib/space-policy";
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
    signedEuros,
} from "@/lib/home-format";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { EqEmpty, EqLabel, EqRow } from "@/components/ui/eq";
import { MemberBalanceList } from "@/components/ui/member-balance-list";
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
import { SpaceStatus, SpaceType } from "@/generated/prisma/enums";

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
 *
 * Month figures use the half-open Madrid month (`monthRange`): an expense dated
 * in a future month never counts as "este mes".
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
    // getSessionCtx: a guest is revalidated against its Membership (expelled/archived → login).
    const session = await getSessionCtx();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    // A GUEST session is caged to its EPHEMERAL space with no personal economy.
    const isGuest = session.kind === "guest";

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, avatar: true } });
    if (!user) {
        return <div className="p-10 text-center">Usuario no encontrado. <Link href="/login" className="underline">Inicia sesión de nuevo</Link></div>;
    }

    const now = new Date();
    const month = monthRange(now);
    const activeGroupId = await getActiveGroup(userId);
    const { scope } = await searchParams;
    const personalActive = !isGuest && (!activeGroupId || scope === "personal");

    // Lazily materialize due recurring expenses so balances/totals include them.
    // A failure here must never block the render. Idempotent and race-safe (each
    // occurrence is claimed under the space lock), so it coexists with the
    // scheduled POST /api/cron/recurring; each scope fails independently.
    const materialize = async (run: () => Promise<number>) => {
        try {
            await run();
        } catch (err) {
            console.error("Failed to materialize recurring expenses", err);
        }
    };
    if (activeGroupId) await materialize(() => materializeDueRecurringExpenses(activeGroupId));
    if (!isGuest) await materialize(() => materializeDueRecurringExpensesForOwner(userId));

    const [summaries, personalMonthCents] = await Promise.all([
        getSpaceSummaries(userId, month),
        isGuest ? Promise.resolve(0) : getPersonalMonthTotal(userId, month),
    ]);
    const active = personalActive ? null : summaries.find((s) => s.id === activeGroupId) ?? null;
    const activeKey = active ? active.id : PERSONAL_KEY;

    // --- Active context data (month split + recent movements).
    const categoryList = await getEffectiveCategories(active ? { groupId: active.id } : { ownerId: userId });
    const catMap = categoryMetaMap(categoryList);
    const metaFor = (key: string) => catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META;

    const expenseWhere = active
        ? { coupleId: active.id, visibility: "SHARED" as const }
        : { ownerId: userId, visibility: "PERSONAL" as const };

    // My own payments rejected this week: "news" is when the rejection happened (updatedAt), not the payment date.
    const rejectedSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const archived = active?.status === SpaceStatus.ARCHIVED;

    const [monthExpenses, recentExpenses, recentSettlements, pendingToMe, pendingFromMe, members, anyPersonalExpense, myRejected, archivedPendingCount, settlingPending] = await Promise.all([
        prisma.expense.findMany({
            where: { ...expenseWhere, date: { gte: month.start, lt: month.end } },
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
                // Plus my own payments rejected this week, so the payer learns it didn't count.
                where: {
                    coupleId: active.id,
                    OR: [
                        { status: { in: ["PENDING", "CONFIRMED"] } },
                        { status: "REJECTED", fromUserId: userId, updatedAt: { gte: rejectedSince } },
                    ],
                },
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
        active
            ? prisma.settlement.findMany({
                where: { coupleId: active.id, fromUserId: userId, status: "PENDING" },
                select: { amount: true, toUserId: true },
            })
            : Promise.resolve([]),
        active ? getGroupMembers(active.id) : Promise.resolve([]),
        // Only needed to decide whether a brand-new user should see the welcome.
        !isGuest && summaries.length === 0
            ? prisma.expense.findFirst({ where: { ownerId: userId, visibility: "PERSONAL" }, select: { id: true } })
            : Promise.resolve(null),
        active && !archived
            ? prisma.settlement.findFirst({
                where: { coupleId: active.id, fromUserId: userId, status: "REJECTED", updatedAt: { gte: rejectedSince } },
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                select: { id: true, amount: true, toUserId: true },
            })
            : Promise.resolve(null),
        // An archived space can't resolve payments any more: just say how many were left open.
        active && archived
            ? prisma.settlement.count({ where: { coupleId: active.id, status: "PENDING" } })
            : Promise.resolve(0),
        // SETTLING banner: "faltan N" counts every PENDING too, like /close.
        active?.status === SpaceStatus.SETTLING
            ? prisma.settlement.findMany({
                where: { coupleId: active.id, status: "PENDING", amount: { gt: 0 } },
                select: { fromUserId: true, toUserId: true, amount: true },
            })
            : Promise.resolve([]),
    ]);

    const names: Record<string, string> = Object.fromEntries(members.map((m) => [m.id, m.name]));
    names[userId] = user.name;
    const avatars: Record<string, string | null> = Object.fromEntries(members.map((m) => [m.id, m.avatar ?? null]));

    // --- Carousel cards: live spaces (+ the active one even if archived) + Personal.
    const pendingOutCents = pendingFromMe.reduce((a, s) => a + s.amount, 0);
    const cards: SpaceCardData[] = summaries
        .filter((s) => s.status !== SpaceStatus.ARCHIVED || s.id === active?.id)
        .map((s) => {
            const solo = s.others.length === 0;
            const isActive = s.id === active?.id;
            const canSettle = isActive && !solo && hasOpenBalance(s.balanceCents) && s.status !== SpaceStatus.ARCHIVED;
            return {
                key: s.id,
                emoji: spaceTypeMeta(s.type).emoji,
                name: spaceName(s),
                sub: cardSub(s.others),
                label: solo ? "Este mes" : balanceWords(s.balanceCents, s.others),
                amount: absEuros(solo ? s.monthTotalCents : s.balanceCents),
                tone: solo ? "neutral" : balanceTone(s.balanceCents),
                signed: solo ? null : signedEuros(s.balanceCents),
                settleHref: canSettle ? settleUrlFor(s.id) : null,
                settleSub: canSettle ? `${s.balanceCents > 0 ? "Cobras" : "Pagas"} ${absEuros(s.balanceCents)}` : null,
                // Debtor side of a two-step payment: say it is on its way (IE-27).
                pendingNote:
                    isActive && pendingOutCents > 0 && s.status !== SpaceStatus.ARCHIVED
                        ? `Pago de ${formatCurrency(pendingOutCents)} pendiente de confirmar`
                        : null,
                rejectedNote:
                    isActive && myRejected
                        ? {
                            text: `${names[myRejected.toUserId] ?? "Alguien"} no recibió tu pago de ${formatCurrency(myRejected.amount)}`,
                            href: `/settle/${myRejected.id}`,
                        }
                        : null,
            };
        });
    if (!isGuest) {
        cards.push({
            key: PERSONAL_KEY,
            emoji: "👤",
            name: "Personal",
            sub: "Solo tú",
            label: "Personal este mes",
            amount: formatCurrency(personalMonthCents),
            tone: "neutral",
            signed: null,
            settleHref: null,
        });
    }

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
                        icon={<span aria-hidden>{meta.emoji}</span>}
                        title={e.description}
                        sub={`${how} · ${dayLabel(e.date, now)}`}
                        amount={formatCurrency(e.amount)}
                    />
                ),
            };
        }),
        ...recentSettlements.map((s) => {
            const from = names[s.fromUserId] ?? "Alguien";
            const to = names[s.toUserId] ?? "Alguien";
            const confirmed = s.status === "CONFIRMED";
            const rejected = s.status === "REJECTED";
            // A rejection is news when it happens, not when the payment was dated.
            const when = rejected ? s.updatedAt : s.date;
            // Status first so a narrow row truncates the names, never the state.
            const sub = rejected
                ? `${to} no lo recibió · ${dayLabel(when, now)}`
                : `${getSettlementStatusLabel(s.status)} · ${from} → ${to} · ${dayLabel(s.date, now)}`;
            return {
                id: s.id,
                date: when,
                node: (
                    <EqRow
                        key={s.id}
                        href={`/settle/${s.id}`}
                        iconTint={confirmed}
                        icon={confirmed
                            ? <Check className="h-[18px] w-[18px]" aria-hidden="true" />
                            : rejected
                                ? <X className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />
                                : <Clock className="h-[18px] w-[18px] text-muted-foreground" aria-hidden="true" />}
                        title="Pago de deuda"
                        sub={sub}
                        amount={formatCurrency(s.amount)}
                        amountClassName={confirmed ? "text-[color:var(--positive)]" : rejected ? "text-muted-foreground line-through" : "text-muted-foreground"}
                    />
                ),
            };
        }),
    ]
        .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id))
        .slice(0, 4);

    // What each payer really owes (their net balance, not the greedy pairing); with my net
    // balance it words the sheet's consequence and toast ("Deuda saldada" only when it reaches 0).
    const activeBalances: Record<string, number> = Object.fromEntries((active?.members ?? []).map((m) => [m.id, m.balanceCents]));
    const pending = pendingToMe.map((s) => ({
        id: s.id,
        owedCents: debtOf(activeBalances, s.fromUserId),
        amount: s.amount,
        fromUser: { name: names[s.fromUserId] ?? "Alguien", avatar: avatars[s.fromUserId] ?? null },
        date: s.date.toISOString(),
        method: s.method,
    }));

    const invite = active && active.others.length === 0 ? inviteConfigFor(active, ephemeralSpacesEnabled()) : null;
    const canManage = active?.role === "OWNER" || active?.role === "ADMIN";
    // GROUP/EPHEMERAL: one relationship can't summarise the space → per-member balances.
    const showGroupBalances =
        !!active && (active.type === SpaceType.GROUP || active.type === SpaceType.EPHEMERAL) && active.members.length > 1;
    // Brand-new account (no space, no personal expense yet) → point to the welcome chooser.
    const showWelcome = !isGuest && summaries.length === 0 && !anyPersonalExpense;
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
                    className="h-11 w-11 flex-none rounded-full bg-[var(--surface-raised-hex)] flex items-center justify-center text-sm font-bold overflow-hidden"
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

            <div className="flex flex-col gap-5 px-5 pt-1.5">
                {showWelcome && (
                    <Link
                        href="/welcome"
                        data-testid="welcome-card"
                        className="eq-in rounded-[18px] bg-[var(--accent-tint)] border border-[color:var(--accent-border)] px-4 py-3.5 flex items-center gap-3"
                    >
                        <span className="text-2xl" aria-hidden="true">👋</span>
                        <span className="flex-1 min-w-0">
                            <span className="block text-[15px] font-semibold">¿Con quién compartes gastos?</span>
                            <span className="block text-[12.5px] text-muted-foreground">Elige pareja, piso, viaje o solo tú. Tardas un momento.</span>
                        </span>
                        <ChevronRight className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                    </Link>
                )}

                {active && (
                    <SpaceStatusBanner
                        spaceId={active.id}
                        type={active.type}
                        status={active.status}
                        expiresAt={active.expiresAt}
                        canManage={canManage}
                        settleHref={settleUrlFor(active.id)}
                        openDebts={closeItemCount(activeBalances, settlingPending)}
                        myBalanceOpen={hasOpenBalance(active.balanceCents)}
                        isGuest={isGuest}
                    />
                )}

                {archived && archivedPendingCount > 0 && (
                    <div
                        role="note"
                        data-testid="archived-pending"
                        className="rounded-[18px] bg-[var(--track)] px-4 py-3.5 flex items-start gap-3"
                    >
                        <Clock className="mt-0.5 h-[18px] w-[18px] flex-none text-muted-foreground" aria-hidden="true" />
                        <p className="text-[13.5px] leading-snug text-muted-foreground">
                            <span className="block text-[15px] font-semibold text-foreground">
                                {archivedPendingCount === 1 ? "Hay 1 pago sin confirmar." : `Hay ${archivedPendingCount} pagos sin confirmar.`}
                            </span>
                            El espacio está archivado y ya no se pueden resolver.
                        </p>
                    </div>
                )}

                {active && active.status !== "ARCHIVED" && (
                    <PendingSettlements key={active.id} settlements={pending} settling={active.status === "SETTLING"} myName={user.name} balanceCents={active.balanceCents} />
                )}

                {active && invite && (
                    <SpaceInviteCard spaceId={active.id} spaceName={spaceName(active)} kind={invite.kind} maxUses={invite.maxUses} />
                )}

                {showGroupBalances && active && (
                    <MemberBalanceList members={active.members} currentUserId={userId} />
                )}

                <MonthSummary title={`${madridMonthName(now)} en ${contextName}`} total={formatCurrency(monthTotal)} slices={slices} />

                <section aria-labelledby="recent-title" className="flex flex-col">
                    <div className="flex items-center justify-between">
                        <EqLabel id="recent-title">Recientes</EqLabel>
                        <div className="flex text-xs font-semibold text-primary">
                            {personalActive && (
                                <Link href="/expenses/import" className="min-h-11 px-2 flex items-center">Importar CSV</Link>
                            )}
                            <Link
                                href={personalActive ? "/expenses/list?scope=personal" : "/expenses/list"}
                                className="min-h-11 -mr-2 px-2 flex items-center"
                            >
                                Ver todo
                            </Link>
                        </div>
                    </div>
                    {rows.length === 0 ? (
                        active && active.status !== SpaceStatus.ACTIVE ? (
                            <EqEmpty
                                testId="recent-empty"
                                title="Aún no hay gastos en este espacio."
                                hint="Este espacio ya no admite gastos nuevos."
                            />
                        ) : active ? (
                            <EqEmpty
                                testId="recent-empty"
                                title="Aún no hay gastos en este espacio."
                                hint={
                                    active.others.length > 0
                                        ? "Apunta lo que pague cada uno y verás aquí quién debe a quién."
                                        : "Apunta lo que pagues; cuando entre alguien más, verás quién debe a quién."
                                }
                                action="Añadir el primer gasto"
                                href={`/expenses/new?space=${active.id}`}
                            />
                        ) : (
                            <EqEmpty
                                testId="recent-empty"
                                title="Aún no hay gastos personales."
                                hint="Apunta lo que gastas solo tú para ver en qué se va el mes."
                                action="Añadir el primer gasto"
                                href="/expenses/new?space=personal"
                            />
                        )
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
