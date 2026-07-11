import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { calculateSplitAmountsFromLines, hasExclusiveReceiptLines } from "@/lib/splits";
import { RECEIPT_LINES_SELECT, linesForSplit } from "@/lib/receipt-read";
import { addInterval } from "@/lib/recurring";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { postExpenseLedger } from "@/lib/ledger";

/**
 * Promote a personal expense to a shared (couple) expense.
 *
 * Only the owner can share, and only if they belong to a couple. The expense
 * gains a coupleId, flips visibility to SHARED, and receives the split records
 * (equal / receipt-aware) so it starts counting towards the couple's balances.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const ctx = await getSessionCtx();
        if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = ctx.userId;

        // Fase 1: the target space may be given explicitly (targetGroupId) so a
        // personal expense can be shared into a chosen group, not just the active
        // one. Default to the active group. Parse defensively (empty body must not 500).
        let targetGroupId: string | null = null;
        try {
            const b = await request.json();
            if (b && typeof b.targetGroupId === 'string') targetGroupId = b.targetGroupId;
        } catch { /* no body — fall back to the active group */ }
        const groupId = targetGroupId ?? await getActiveGroup(userId);
        if (!groupId) {
            return NextResponse.json({ error: 'Necesitas un grupo para compartir un gasto' }, { status: 400 });
        }

        // Authorize against the TARGET group (of the resource we write into): ACTIVE
        // membership + writable status (no sharing into a SETTLING/ARCHIVED space).
        const auth = await requireSpaceAccess(ctx, groupId);
        if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

        const expense = await prisma.expense.findUnique({ where: { id }, include: { ...RECEIPT_LINES_SELECT, series: true } });
        if (!expense) {
            return NextResponse.json({ error: 'Gasto no encontrado' }, { status: 404 });
        }

        // Only the owner of a personal expense can share it.
        if (expense.ownerId !== userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }
        if (expense.visibility === 'SHARED') {
            return NextResponse.json({ error: 'El gasto ya es compartido' }, { status: 409 });
        }

        const coupleMembers = (await getGroupMembers(groupId)).map((m) => ({ id: m.id }));

        const splits = calculateSplitAmountsFromLines(
            expense.amount,
            linesForSplit(expense.lineItems),
            coupleMembers,
        );

        // Phase 5 (stop-dual-write): recurrence lives on the series. This expense is
        // the TEMPLATE iff series.templateId === its id. If it was a personal
        // recurring template, reset the series nextRunDate to the next FUTURE
        // occurrence so sharing doesn't trigger a catch-up burst of backdated shared
        // expenses on the next couple dashboard load.
        const isTemplate = !!(expense.seriesId && expense.series?.templateId === expense.id);
        let nextRunReset: Date | undefined;
        if (isTemplate && expense.series?.interval) {
            nextRunReset = addInterval(new Date(), expense.series.interval);
        }

        // Flip to shared, attach to the couple, and create the splits atomically.
        await prisma.$transaction(async (tx) => {
            await tx.split.deleteMany({ where: { expenseId: id } });
            const updated = await tx.expense.update({
                where: { id },
                data: {
                    visibility: 'SHARED',
                    coupleId: groupId,
                    splitStrategy: hasExclusiveReceiptLines(expense.lineItems) ? 'ITEMIZED' : 'EQUAL',
                    splits: {
                        create: splits.map(s => ({ userId: s.userId, amount: s.amount })),
                    },
                },
            });

            // Phase 4: promotion to SHARED enters the couple balance — post its
            // ledger transaction so a shared expense is never left with zero entries.
            await postExpenseLedger(tx, {
                expenseId: id,
                groupId,
                amount: updated.amount,
                paidById: updated.paidById,
                occurredAt: updated.date,
                splits: splits.map(s => ({ userId: s.userId, amount: s.amount })),
                members: coupleMembers,
            });

            // Phase 4/5: the linked series must follow the promotion in the SAME tx,
            // or the series-driven materializer would keep creating PERSONAL instances
            // outside the couple. Guard on isTemplate so ONLY sharing the TEMPLATE
            // flips the series scope — sharing a materialized instance leaves the
            // series untouched. nextRunDate resets to the next FUTURE occurrence
            // (anti-catch-up-burst). A deactivated series stays inactive.
            if (isTemplate) {
                await tx.recurringSeries.update({
                    where: { id: expense.seriesId! },
                    data: {
                        visibility: 'SHARED',
                        coupleId: groupId,
                        splitStrategy: updated.splitStrategy,
                        ...(nextRunReset ? { nextRunDate: nextRunReset } : {}),
                    },
                });
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error sharing expense:", error);
        return NextResponse.json({ error: "Error al compartir el gasto" }, { status: 500 });
    }
}
