import { Heart, User, Pencil } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { DeleteExpenseButton } from "@/components/expense/delete-button";
import { getSessionCtx } from "@/lib/authz";
import { formatCurrency, formatEuros } from "@/lib/currency";
import { isAvatarUrl } from "@/lib/avatar";
import { receiptItemsView, RECEIPT_LINES_SELECT } from "@/lib/receipt-read";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { getEffectiveCategories } from "@/lib/category-db";
import { categoryKeyOf, categoryMetaMap, CATEGORY_REF_SELECT } from "@/lib/category-read";
import { NEUTRAL_CATEGORY_META } from "@/components/category/category-badge";
import { PromoteButton } from "@/components/expense/promote-button";
import { EqCard, EqHeader, EqLabel } from "@/components/ui/eq";

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    // getSessionCtx: a guest is revalidated against its Membership (expelled/archived → login).
    const session = await getSessionCtx();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const expense = await prisma.expense.findUnique({
        where: { id: id },
        include: {
            paidBy: true,
            createdBy: true,
            splits: {
                include: {
                    user: true
                }
            },
            tags: {
                include: {
                    tag: true
                }
            },
            ...RECEIPT_LINES_SELECT,
            ...CATEGORY_REF_SELECT,
        }
    });

    if (!expense) redirect("/dashboard");

    // Phase 5 (WS1): couple membership comes from the Membership layer, not the
    // expense.couple.members reverse relation of User.coupleId.
    const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];

    // Space lifecycle: SETTLING/ARCHIVED spaces are read-only (no edit/delete).
    const space = expense.coupleId
        ? await prisma.couple.findUnique({ where: { id: expense.coupleId }, select: { status: true } })
        : null;
    const isReadOnly = space?.status === "SETTLING" || space?.status === "ARCHIVED";
    // Map assignee userId -> display name for the itemized receipt footer.
    const memberName = (uid: string) => members.find(m => m.id === uid)?.name ?? "Otro";

    // Phase 4 read-switch: the ReceiptLineItem table (cents) is the read source
    // for the receipt breakdown; receiptItemsView maps rows -> the euro DTO the
    // markup already renders (toEuros(toCents(x))==x keeps every sum identical).
    const receiptItems = receiptItemsView(expense.lineItems);
    const linesCents = expense.lineItems.reduce((acc, l) => acc + l.lineTotal, 0);

    // Privacy: a personal expense is only visible to its owner; a shared one to
    // members of its couple.
    const isCoupleMember = members.some(m => m.id === userId);
    const canView = expense.visibility === "PERSONAL"
        ? expense.ownerId === userId
        : isCoupleMember;
    if (!canView) redirect("/dashboard");

    const isPersonal = expense.visibility === "PERSONAL";
    const isMe = userId === expense.paidById;

    // A personal expense can be promoted to shared if the owner belongs to a group.
    const myGroupId = isPersonal && expense.ownerId === userId ? await getActiveGroup(userId) : null;
    const canPromote = Boolean(myGroupId);

    // Category tile, resolved in the expense's own context (personal → owner
    // scope, shared → group scope).
    const catMap = categoryMetaMap(await getEffectiveCategories(
        isPersonal ? { ownerId: expense.ownerId } : expense.coupleId ? { groupId: expense.coupleId } : {},
    ));
    const categoryMeta = catMap[categoryKeyOf(expense)] ?? catMap.other ?? NEUTRAL_CATEGORY_META;
    const dateLabel = new Date(expense.date).toLocaleDateString("es-ES", {
        timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const backHref = isPersonal ? "/expenses/list?scope=personal" : "/expenses/list";
    const avatar = (u: { avatar: string | null; name: string }) =>
        isAvatarUrl(u.avatar)
            // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded avatar URL of unknown dimensions; next/image would change layout/runtime
            ? <img src={u.avatar} alt={u.name} className="h-full w-full object-cover" />
            : (u.avatar || "👤");

    return (
        <div className="eq-in flex flex-col min-h-screen w-full pt-3 pb-10 overflow-x-hidden">
            <EqHeader title={expense.description} back={backHref}>
                {!isReadOnly && (
                    <div className="flex flex-none items-center gap-1">
                        <Link
                            href={`/expense/${expense.id}/edit`}
                            aria-label="Editar"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-[var(--track)] hover:text-foreground"
                        >
                            <Pencil className="h-4 w-4" />
                        </Link>
                        {canPromote && <PromoteButton expenseId={expense.id} />}
                        <DeleteExpenseButton expenseId={expense.id} redirectTo={backHref} />
                    </div>
                )}
            </EqHeader>

            <div className="flex flex-col gap-5 px-5 pt-5">
                <EqCard className="flex flex-col items-center gap-3 px-5 py-6 text-center">
                    <span className="flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-1 text-xs font-semibold text-primary">
                        <span aria-hidden>{categoryMeta.emoji}</span> {categoryMeta.label}
                    </span>
                    <h2 className="text-[44px] font-bold leading-none tracking-[-0.03em] text-foreground">
                        {formatCurrency(expense.amount)}
                    </h2>
                    <p className="text-[13px] text-muted-foreground first-letter:uppercase">{dateLabel}</p>
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-[var(--track)] flex items-center justify-center overflow-hidden text-sm">
                            {avatar(expense.paidBy)}
                        </div>
                        <p className="text-sm font-medium text-[color:var(--body-ink)]">Pagado por <span className="text-primary">{isMe ? "Ti" : expense.paidBy.name}</span></p>
                    </div>
                    {expense.createdBy && expense.createdById !== expense.paidById && (
                        <p className="text-xs text-muted-foreground">
                            Añadido por {expense.createdById === userId ? "ti" : expense.createdBy.name}
                        </p>
                    )}
                </EqCard>

                {isReadOnly && (
                    <div className="rounded-[14px] bg-[var(--track)] px-3 py-2.5 text-center text-[13px] text-muted-foreground">
                        Este espacio está {space?.status === "ARCHIVED" ? "archivado" : "liquidando"} — solo lectura.
                    </div>
                )}

                {isPersonal ? (
                    <EqCard className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                        <User className="h-4 w-4 text-primary" />
                        Gasto personal — privado, solo tú lo ves
                    </EqCard>
                ) : (
                    <section className="space-y-2">
                        <EqLabel className="px-1">Reparto del gasto</EqLabel>
                        <EqCard className="px-4">
                            {expense.splits.length === 0 ? (
                                <p className="py-6 text-center text-sm text-muted-foreground">No hay detalles de reparto para este gasto.</p>
                            ) : (
                                <div className="divide-y divide-[color:var(--line-2)]">
                                    {expense.splits.map((split) => (
                                        <div key={split.id} className="flex items-center justify-between py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="h-8 w-8 rounded-full bg-[var(--track)] flex items-center justify-center overflow-hidden text-base">
                                                    {avatar(split.user)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">{split.userId === userId ? "Ti" : split.user.name}</p>
                                                    {split.userId === expense.paidById && (
                                                        <p className="text-[11px] font-semibold text-primary">Pagó</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[15px] font-semibold tabular-nums text-foreground">{formatCurrency(split.amount)}</p>
                                                <p className="text-[11px] text-muted-foreground">{split.userId === expense.paidById ? "Su parte" : "Cargo"}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </EqCard>
                    </section>
                )}

                {expense.notes && (
                    <section className="space-y-2">
                        <EqLabel className="px-1">Notas</EqLabel>
                        <EqCard className="p-4 text-sm whitespace-pre-wrap text-[color:var(--body-ink)]">{expense.notes}</EqCard>
                    </section>
                )}

                {expense.tags.length > 0 && (
                    <section className="space-y-2">
                        <EqLabel className="px-1">Etiquetas</EqLabel>
                        <div className="flex flex-wrap gap-2">
                            {expense.tags.map(({ tag }) => (
                                <span
                                    key={tag.id}
                                    className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold"
                                    style={{ backgroundColor: `${tag.color}20`, borderColor: `${tag.color}66`, color: tag.color }}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    </section>
                )}

                {receiptItems.length > 0 && (
                    <section className="space-y-2">
                        <EqLabel className="px-1">Desglose de compra</EqLabel>
                        <EqCard className="overflow-hidden">
                            <div className="divide-y divide-[color:var(--line-2)]">
                                {receiptItems.map((item, idx) => (
                                    <div key={idx} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-4 py-2.5 text-sm">
                                        <div className={`flex h-6 w-6 items-center justify-center rounded-full ${item.assignedTo ? "bg-[var(--accent-tint)] text-primary" : "bg-[var(--track)] text-muted-foreground"}`}>
                                            {item.assignedTo ? <User className="h-3.5 w-3.5" /> : <Heart className="h-3.5 w-3.5" />}
                                        </div>
                                        <div className="min-w-0 break-words font-medium leading-tight text-foreground">{item.description}</div>
                                        <div className="min-w-[45px] text-right text-[11px] leading-tight text-muted-foreground">
                                            {item.quantity > 1 && (
                                                <div className="flex flex-col tabular-nums">
                                                    <span>{item.quantity} ×</span>
                                                    <span>{formatEuros(item.price)}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-[3.5rem] text-right font-semibold tabular-nums text-foreground">{formatEuros(item.total)}</div>
                                    </div>
                                ))}
                            </div>
                            {/* Summary footer: shared part + one row per real assignee
                                (N-way / multi-assignee tickets). */}
                            {receiptItems.some(i => i.assignedTo) && (() => {
                                const sharedTotal = receiptItems.filter(i => !i.assignedTo).reduce((acc, i) => acc + i.total, 0);
                                const byAssignee = new Map<string, number>();
                                for (const i of receiptItems) {
                                    if (!i.assignedTo) continue;
                                    byAssignee.set(i.assignedTo, (byAssignee.get(i.assignedTo) ?? 0) + i.total);
                                }
                                return (
                                    <div className="space-y-1.5 border-t border-[color:var(--line)] bg-background px-4 py-3">
                                        {sharedTotal > 0 && (
                                            <div className="flex justify-between text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> Común</span>
                                                <span className="tabular-nums">{formatEuros(sharedTotal)}</span>
                                            </div>
                                        )}
                                        {[...byAssignee.entries()].map(([uid, total]) => (
                                            <div key={uid} className="flex justify-between text-xs text-primary">
                                                <span className="flex items-center gap-1">
                                                    <User className="h-3 w-3" /> Solo {uid === userId ? "tú" : memberName(uid)}
                                                </span>
                                                <span className="tabular-nums">{formatEuros(total)}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                            <div className="flex items-center justify-between border-t border-[color:var(--line)] bg-background px-4 py-3">
                                <span className="text-sm font-semibold text-muted-foreground">Total detallado</span>
                                <span className="font-semibold tabular-nums text-foreground">
                                    {formatCurrency(linesCents)}
                                </span>
                            </div>
                            {linesCents !== expense.amount && (
                                // G-03: never show a breakdown total that silently contradicts the amount.
                                <p data-testid="lines-mismatch-note" className="border-t border-[color:var(--line)] bg-background px-4 py-2.5 text-xs text-muted-foreground">
                                    El desglose no coincide con el importe del gasto ({formatCurrency(expense.amount)}).
                                    {expense.splitStrategy === "ITEMIZED" && " El reparto se ha ajustado en proporción a los productos."}
                                </p>
                            )}
                        </EqCard>
                    </section>
                )}

                {expense.receiptUrl && (
                    <section className="space-y-2">
                        <EqLabel className="px-1">Ticket de compra</EqLabel>
                        <EqCard className="overflow-hidden">
                            {/* oxlint-disable-next-line nextjs/no-img-element -- user-uploaded receipt image of unknown dimensions; next/image would change layout/runtime */}
                            <img src={expense.receiptUrl} alt="Ticket" className="mx-auto h-auto max-h-[400px] w-full object-contain" />
                        </EqCard>
                    </section>
                )}
            </div>
        </div>
    );
}
