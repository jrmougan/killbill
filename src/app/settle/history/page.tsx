import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import { getSessionCtx } from "@/lib/authz";
import { resolveSettleSpace } from "@/lib/settlement-space";
import { spaceTypeMeta } from "@/lib/space-ui";
import { formatCurrency } from "@/lib/currency";
import { EqHeader, EqLabel, EqRow } from "@/components/ui/eq";
import { SettlementStatusChip } from "@/components/settle/status-chip";
import { methodName } from "@/components/settle/settle-model";

export const dynamic = 'force-dynamic';

const dayFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", month: "long", year: "numeric" });

/**
 * Every settlement of a space (all statuses: pending, confirmed, rejected) —
 * `?space=<groupId>` when given (authorized against that space), else the
 * active space. Legacy zero-amount "checkpoint" rows are hidden.
 */
export default async function SettlementHistoryPage({ searchParams }: { searchParams: Promise<{ space?: string | string[] }> }) {
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");
    const userId = ctx.userId;

    // Personal mode has no settlements.
    const resolved = await resolveSettleSpace(ctx, (await searchParams).space);
    if (!resolved) redirect("/dashboard");
    const { groupId, auth } = resolved;
    const spaceName = auth.space.name ?? spaceTypeMeta(auth.space.type).label;

    const settlements = await prisma.settlement.findMany({
        where: { coupleId: groupId, amount: { gt: 0 } },
        include: { fromUser: { select: { name: true } }, toUser: { select: { name: true } } },
        orderBy: { date: 'desc' },
    });

    // Group by month (Europe/Madrid), newest first.
    const groups: { key: string; label: string; items: typeof settlements }[] = [];
    for (const s of settlements) {
        const label = monthFmt.format(s.date);
        let g = groups.find((x) => x.key === label);
        if (!g) groups.push((g = { key: label, label: label.charAt(0).toUpperCase() + label.slice(1), items: [] }));
        g.items.push(s);
    }

    return (
        <main className="eq-in min-h-dvh w-full max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)] pb-10">
            <EqHeader back={`/settle?space=${encodeURIComponent(groupId)}`} title="Pagos" meta={spaceName} />

            {settlements.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" data-testid="settle-history-empty">
                    <div aria-hidden className="h-16 w-16 rounded-full bg-[var(--track)] flex items-center justify-center text-muted-foreground">
                        <Clock className="h-7 w-7" />
                    </div>
                    <p className="text-[17px] font-semibold">Aún no hay pagos</p>
                    <p className="text-sm text-muted-foreground">Cuando alguien salde una deuda en {spaceName}, aparecerá aquí.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-6 px-5 pt-6">
                    {groups.map((g) => (
                        <section key={g.key} className="flex flex-col">
                            <EqLabel className="mb-1">{g.label}</EqLabel>
                            {g.items.map((s) => {
                                const toMe = s.toUserId === userId;
                                const fromMe = s.fromUserId === userId;
                                const title = fromMe
                                    ? `Pagaste a ${s.toUser.name}`
                                    : toMe
                                        ? `${s.fromUser.name} te pagó`
                                        : `${s.fromUser.name} → ${s.toUser.name}`;
                                const awaitingMe = toMe && s.status === "PENDING";
                                return (
                                    <div key={s.id} data-testid="settle-history-row" data-status={s.status}>
                                        <EqRow
                                            href={`/settle/${s.id}`}
                                            iconTint={toMe}
                                            icon={toMe ? <ArrowDownLeft className="h-[18px] w-[18px]" /> : <ArrowUpRight className="h-[18px] w-[18px]" />}
                                            title={title}
                                            sub={
                                                <span className="flex items-center gap-2">
                                                    <SettlementStatusChip status={s.status} className="px-2 py-0 text-[11px]" />
                                                    <span className="truncate">
                                                        {awaitingMe ? "Te toca confirmarlo" : `${methodName(s.method)} · ${dayFmt.format(s.date)}`}
                                                    </span>
                                                </span>
                                            }
                                            amount={formatCurrency(s.amount)}
                                            amountClassName={s.status === "REJECTED" ? "line-through text-muted-foreground" : undefined}
                                        />
                                    </div>
                                );
                            })}
                        </section>
                    ))}
                </div>
            )}
        </main>
    );
}
