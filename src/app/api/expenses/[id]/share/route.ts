import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateSplitAmountsFromLines, hasExclusiveReceiptLines } from "@/lib/splits";
import { RECEIPT_LINES_SELECT, linesForSplit } from "@/lib/receipt-read";
import { addInterval } from "@/lib/recurring";
import { getGroupMembers, getActiveGroup } from "@/lib/membership";
import { postExpenseLedger } from "@/lib/ledger";
import { assertRosterUnchanged, assertWritableUnderLock, withSpaceLock } from "@/lib/expense-tx";
import { SettlementError } from "@/lib/settlement-rules";
import { badRequest, conflict, forbidden, notFound, requireSpace, route } from "@/lib/http";
import { idParams, jsonObject } from "@/lib/http/schemas";

/** Optional body: `{ targetGroupId }`; an empty body shares into the active space. */
const ShareBody = jsonObject({
    targetGroupId: z.string({ error: "Espacio no válido" }).nullish(),
}).nullish();

/**
 * Promote a personal expense to a shared (couple) expense.
 *
 * Only the owner can share, and only if they belong to a couple. The expense
 * gains a coupleId, flips visibility to SHARED, and receives the split records
 * (equal / receipt-aware) so it starts counting towards the couple's balances.
 * Guests can't share (no personal expenses): 403 from route({ auth: 'user' }).
 */
export const POST = route(
    { auth: "user", params: idParams, body: ShareBody, errorMessage: "Error al compartir el gasto", logLabel: "Error sharing expense:" },
    async ({ ctx, params: { id }, body }) => {
        const userId = ctx.userId;

        // Fase 1: the target space may be given explicitly (targetGroupId) so a
        // personal expense can be shared into a chosen group, not just the active
        // one. Default to the active group (an empty body is fine).
        const groupId = body?.targetGroupId ?? await getActiveGroup(userId);
        if (!groupId) throw badRequest('Necesitas un grupo para compartir un gasto');

        // Authorize against the TARGET group (of the resource we write into): ACTIVE
        // membership + writable status (no sharing into a SETTLING/ARCHIVED space).
        await requireSpace(ctx, groupId);

        const expense = await prisma.expense.findUnique({ where: { id }, include: { ...RECEIPT_LINES_SELECT, series: true } });
        if (!expense) throw notFound('Gasto no encontrado');

        // Only the owner of a personal expense can share it.
        if (expense.ownerId !== userId) throw forbidden('No autorizado');
        if (expense.visibility === 'SHARED') throw conflict('El gasto ya es compartido');

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

        // Flip to shared, attach to the couple, and create the splits atomically —
        // under the target space's row lock (lock order G-04), re-checking there the
        // space status, the roster the splits were computed on, and that no
        // concurrent share already promoted this expense (it would post twice).
        await withSpaceLock(groupId, async (tx, status) => {
            assertWritableUnderLock(status);
            await assertRosterUnchanged(tx, groupId, coupleMembers.map((m) => m.id));
            const current = await tx.expense.findUnique({ where: { id }, select: { visibility: true } });
            if (!current) throw new SettlementError(404, 'NOT_FOUND', 'Gasto no encontrado');
            if (current.visibility === 'SHARED') throw new SettlementError(409, 'ALREADY_SHARED', 'El gasto ya es compartido');
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
    },
);
