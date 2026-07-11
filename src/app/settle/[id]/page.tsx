import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupMembers } from "@/lib/membership";
import { calculateSplitAmounts } from "@/lib/splits";
import { redirect, notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ArrowLeft, Check, Calendar, CreditCard } from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/currency";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { getEffectiveCategories } from "@/lib/category-db";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { getSettlementStatusLabel, getSettlementMethodLabel } from "@/lib/settlement-labels";

interface SettlementDetailPageProps {
    params: { id: string };
}

export default async function SettlementDetailPage({ params }: SettlementDetailPageProps) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: {
            fromUser: true,
            toUser: true,
            expenses: {
                include: {
                    splits: true,
                    ...CATEGORY_REF_SELECT
                }
            }
        }
    });

    if (!settlement) notFound();

    // Fase 1 security: this page never validated group membership. Authorize
    // against the settlement's OWN group (allowArchived: settlements stay viewable
    // on an archived space). A non-member is treated as not-found.
    const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true });
    if (!auth.ok) notFound();

    // Group members back the N-way equal-share fallback for legacy expenses that
    // have no Split rows (never a hardcoded 50/50).
    const members = await getGroupMembers(settlement.coupleId);

    // DB-driven category metadata for the settlement's space (allowArchived is
    // already honoured above), so covered expenses show their real emoji.
    const catMap = categoryMetaMap(await getEffectiveCategories({ groupId: settlement.coupleId }));
    const emojiFor = (key: string) => (catMap[key] ?? catMap.other ?? NEUTRAL_CATEGORY_META).emoji;

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/expenses/list">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-foreground">Detalle de Liquidación</h1>
                </div>
                {settlement.fromUserId === ctx.userId && (
                    <Link href={`/settle/${id}/edit`}>
                        <Button variant="ghost" size="sm" className="rounded-full border border-[color:var(--accent-border)] text-primary hover:bg-[var(--accent-tint)]">
                            Editar
                        </Button>
                    </Link>
                )}
            </header>

            <GlassCard className="p-6 space-y-6 border-[color:var(--accent-border)] bg-[var(--accent-tint)] relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                    <Check className="h-24 w-24 text-primary" />
                </div>

                <div className="text-center space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-primary">Total Liquidado</p>
                    <h2 className="text-5xl font-mono font-semibold tracking-[-0.02em] text-foreground">
                        {formatCurrency(settlement.amount)}
                    </h2>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--positive-tint)] text-[color:var(--positive)] text-xs font-bold border border-[color:var(--line)]">
                        <Check className="h-3 w-3" /> {getSettlementStatusLabel(settlement.status)}
                    </span>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                    <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">De</p>
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-xs text-foreground">
                                {settlement.fromUser.avatar || "👤"}
                            </div>
                            <span className="text-sm font-bold truncate text-foreground">{settlement.fromUser.name}</span>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-tighter">Para</p>
                        <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center text-xs text-foreground">
                                {settlement.toUser.avatar || "👤"}
                            </div>
                            <span className="text-sm font-bold truncate text-foreground">{settlement.toUser.name}</span>
                        </div>
                    </div>
                </div>

                <div className="border-t border-[color:var(--line)] pt-4 grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs">{new Date(settlement.date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <CreditCard className="h-4 w-4" />
                        <span className="text-xs">{getSettlementMethodLabel(settlement.method)}</span>
                    </div>
                </div>
            </GlassCard>

            <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground ml-1">
                    Gastos Cubiertos ({settlement.expenses.length})
                </h3>

                <div className="space-y-3">
                    {settlement.expenses.length === 0 ? (
                        <p className="text-center py-10 text-sm text-muted-foreground border border-dashed border-[color:var(--line-strong)] rounded-2xl">
                            Esta liquidación se hizo de forma global sin vincular gastos específicos.
                        </p>
                    ) : (
                        settlement.expenses.map((expense) => {
                            let myShareCents = 0;
                            if (expense.splits.length > 0) {
                                myShareCents = expense.splits.find(s => s.userId === settlement.fromUserId)?.amount || 0;
                            } else {
                                // No Split rows (legacy): derive the payer's share via the
                                // canonical N-way equal division, not a hardcoded 50/50.
                                const computed = calculateSplitAmounts(expense.amount, null, members);
                                myShareCents = computed.find(s => s.userId === settlement.fromUserId)?.amount || 0;
                            }

                            return (
                                <GlassCard key={expense.id} className="p-4 flex items-center justify-between border-[color:var(--line-2)] bg-card">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center text-sm">
                                            {emojiFor(categoryKeyOf(expense))}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-foreground">{expense.description}</p>
                                            <p className="text-[10px] text-[color:var(--ink-3)]">
                                                {new Date(expense.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-mono font-semibold tracking-[-0.02em] text-foreground">{formatCurrency(myShareCents)}</p>
                                        <p className="text-[10px] text-muted-foreground italic font-mono">de {formatCurrency(expense.amount)}</p>
                                    </div>
                                </GlassCard>
                            );
                        })
                    )}
                </div>
            </section>
        </div>
    );
}
