import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupMembers, PUBLIC_MEMBER_SELECT } from "@/lib/membership";
import { calculateSplitAmounts } from "@/lib/splits";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/currency";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { spaceTypeMeta } from "@/lib/space-ui";
import { EqCard, EqLabel, EqRow } from "@/components/ui/eq";
import { SettleHeader } from "@/components/settle/settle-header";
import { SettlementActions } from "@/components/settle/settlement-actions";
import { SettlementStatusChip } from "@/components/settle/status-chip";
import { methodName } from "@/components/settle/settle-model";

export const dynamic = 'force-dynamic';

interface SettlementDetailPageProps {
    params: Promise<{ id: string }>;
}

const dateFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" });

export default async function SettlementDetailPage({ params }: SettlementDetailPageProps) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: {
            // Public projection only (never password/pin/email).
            fromUser: { select: PUBLIC_MEMBER_SELECT },
            toUser: { select: PUBLIC_MEMBER_SELECT },
            couple: { select: { name: true, type: true, status: true } },
            expenses: {
                include: {
                    splits: true,
                    ...CATEGORY_REF_SELECT
                }
            }
        }
    });

    if (!settlement) notFound();

    // Authorize against the settlement's OWN group (allowArchived: settlements
    // stay viewable on an archived space; allowGuest: guests reach /settle). A
    // non-member is treated as not-found.
    const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });
    if (!auth.ok) notFound();

    const me = ctx.userId;
    const isPending = settlement.status === "PENDING";
    const iReceive = settlement.toUserId === me;
    const iPay = settlement.fromUserId === me;
    // Only the receiver confirms/rejects and only the payer edits (guests
    // included); nothing moves in an ARCHIVED (read-only) space.
    const archived = settlement.couple.status === "ARCHIVED";
    const canResolve = isPending && iReceive && !archived;
    const canEdit = isPending && iPay && !archived;

    const fromName = iPay ? "Tú" : settlement.fromUser.name;
    const toName = iReceive ? "Tú" : settlement.toUser.name;
    const headline = iPay
        ? `Pagaste a ${settlement.toUser.name}`
        : iReceive
            ? `${settlement.fromUser.name} te pagó`
            : `${settlement.fromUser.name} pagó a ${settlement.toUser.name}`;
    const spaceName = settlement.couple.name ?? spaceTypeMeta(settlement.couple.type).label;

    let explanation: string | null = null;
    if (isPending && iReceive) explanation = `${settlement.fromUser.name} dice que te ha pagado. Confírmalo cuando lo hayas recibido: hasta entonces no cuenta en el saldo.`;
    else if (isPending && iPay) explanation = `Pendiente de que ${settlement.toUser.name} confirme. Contará en el saldo cuando lo haga.`;
    else if (isPending) explanation = `Pendiente de que ${settlement.toUser.name} confirme.`;
    else if (settlement.status === "REJECTED") explanation = "Este pago se rechazó y no cuenta en el saldo.";
    if (isPending && archived) explanation = `${explanation ?? ""} El espacio está archivado: ya no se puede confirmar ni editar.`.trim();

    // Legacy settlements may link covered expenses (pre running-balance model).
    const members = settlement.expenses.length > 0 ? await getGroupMembers(settlement.coupleId) : [];
    const catMap = settlement.expenses.length > 0
        ? categoryMetaMap(await getEffectiveCategories({ groupId: settlement.coupleId }))
        : {};
    const emojiFor = (key: string) => (catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META).emoji;

    return (
        <main className="eq-in min-h-dvh max-w-md mx-auto flex flex-col bg-background pt-[max(env(safe-area-inset-top),12px)]">
            <SettleHeader fallback={`/settle/history?space=${encodeURIComponent(settlement.coupleId)}`} title="Pago">
                {canEdit && (
                    <Link href={`/settle/${id}/edit`} className="text-sm font-semibold text-primary px-1">
                        Editar
                    </Link>
                )}
            </SettleHeader>

            <div className="flex-1 flex flex-col gap-6 px-5 pt-6 pb-8">
                <section className="flex flex-col items-center gap-2 text-center" data-testid="settlement-summary">
                    <span className="text-[15px] text-muted-foreground">{headline}</span>
                    <span className="text-[44px] font-bold tracking-[-0.03em] tabular-nums leading-none" data-testid="settlement-amount">
                        {formatCurrency(settlement.amount)}
                    </span>
                    <SettlementStatusChip status={settlement.status} className="mt-1" />
                    {explanation && (
                        <p className="text-sm text-muted-foreground leading-[1.45] text-pretty max-w-[300px] mt-1">{explanation}</p>
                    )}
                </section>

                <EqCard className="px-4">
                    <DetailRow label="De" value={fromName} />
                    <DetailRow label="Para" value={toName} />
                    <DetailRow label="Método" value={methodName(settlement.method)} />
                    <DetailRow label="Fecha" value={dateFmt.format(settlement.date)} mono />
                    <DetailRow label="Espacio" value={spaceName} last />
                </EqCard>

                {settlement.expenses.length > 0 && (
                    <section className="flex flex-col">
                        <EqLabel className="mb-1">Gastos cubiertos · {settlement.expenses.length}</EqLabel>
                        {settlement.expenses.map((expense) => {
                            let shareCents = 0;
                            if (expense.splits.length > 0) {
                                shareCents = expense.splits.find(s => s.userId === settlement.fromUserId)?.amount || 0;
                            } else {
                                // Legacy rows without Split: canonical N-way equal division.
                                const computed = calculateSplitAmounts(expense.amount, null, members);
                                shareCents = computed.find(s => s.userId === settlement.fromUserId)?.amount || 0;
                            }
                            return (
                                <EqRow
                                    key={expense.id}
                                    icon={emojiFor(categoryKeyOf(expense))}
                                    title={expense.description}
                                    sub={`${shortDate.format(expense.date)} · de ${formatCurrency(expense.amount)}`}
                                    amount={formatCurrency(shareCents)}
                                />
                            );
                        })}
                    </section>
                )}
            </div>

            {canResolve && (
                <div className="px-5 pb-[max(env(safe-area-inset-bottom),30px)]">
                    <SettlementActions id={settlement.id} fromName={settlement.fromUser.name} amountCents={settlement.amount} />
                </div>
            )}
        </main>
    );
}

function DetailRow({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
    return (
        <div className={`flex justify-between gap-3 py-3.5 text-[15px] ${last ? "" : "border-b border-[color:var(--line-2)]"}`}>
            <span className="text-muted-foreground">{label}</span>
            <span className={mono ? "font-mono text-[13px] self-center" : "font-semibold text-right truncate"}>{value}</span>
        </div>
    );
}
