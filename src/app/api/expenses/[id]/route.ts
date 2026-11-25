import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import type { SessionCtx } from "@/lib/authz";
import { calculateSplitAmounts, calculateSplitAmountsFromLines, hasExclusiveReceiptItems, rescaleSplits, type ReceiptItemForSplit } from "@/lib/splits";
import type { SplitStrategy, SpaceStatus } from "@/generated/prisma/enums";
import { RECEIPT_LINES_SELECT, linesForSplit } from "@/lib/receipt-read";
import { resolveCategoryId } from "@/lib/category-db";
import { buildReceiptLineItems } from "@/lib/receipt";
import { getGroupMembers } from "@/lib/membership";
import { postExpenseLedger } from "@/lib/ledger";
import { assertRosterUnchanged, assertWritableUnderLock, runLedgerTransaction, withSpaceLock } from "@/lib/expense-tx";
import { isRecurringInterval, nextRecurringRun } from "@/lib/expense-input";
import { assertSpaceWritable } from "@/lib/space-policy";
import { badRequest, forbidden, notFound, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";
import { BENEFICIARY_NOT_MEMBER, PatchExpenseBody, PAYER_NOT_MEMBER, SPLIT_NOT_MEMBER } from "@/lib/expense-schemas";
import type { Prisma } from "@/generated/prisma/client";

/**
 * A SETTLING/ARCHIVED space is read-only for expenses: the UI hides edit/delete
 * there, and the API must refuse them too (throws the SpacePolicyError → 409
 * SPACE_NOT_WRITABLE, mapped by route()).
 */
async function assertExpenseSpaceWritable(coupleId: string | null): Promise<void> {
    if (!coupleId) return;
    const space = await prisma.couple.findUnique({ where: { id: coupleId }, select: { status: true } });
    if (!space) return;
    assertSpaceWritable(space.status as SpaceStatus);
}

/**
 * A guest session is caged to the one space of its JWT (getSessionCtx already
 * revalidated its membership against the DB): it may never touch a personal
 * expense nor an expense of another space.
 */
function guestOutOfCage(ctx: SessionCtx, expense: { visibility: string; coupleId: string | null }): boolean {
    return ctx.kind === "guest" && (expense.visibility !== "SHARED" || !ctx.groupId || expense.coupleId !== ctx.groupId);
}

/**
 * Run a mutation of an existing expense. A SHARED expense is written under its
 * space's row lock (A3): the status (SETTLING/ARCHIVED are read-only for
 * expenses) and the roster the authz/split decisions were made on are re-read
 * inside the same transaction as the write. PERSONAL expenses touch no space.
 */
function writeExpense<T>(
    coupleId: string | null,
    memberIds: readonly string[],
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
    if (!coupleId) return runLedgerTransaction(fn);
    return withSpaceLock(coupleId, async (tx, status) => {
        assertWritableUnderLock(status);
        await assertRosterUnchanged(tx, coupleId, memberIds);
        return fn(tx);
    });
}

// getSessionCtx (in route()) revalidates a guest session against the DB (H3).
export const DELETE = route(
    { auth: "user-or-guest", params: idParams, errorMessage: "Error al eliminar", logLabel: "Error deleting expense:" },
    async ({ ctx, params: { id } }) => {
        const userId = ctx.userId;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { series: true }
        });

        if (!expense) throw notFound("Gasto no encontrado");

        // Personal expenses are authorized by ownership; shared ones strictly by
        // current couple membership via the Membership layer (Phase 5 WS1) — an
        // ex-member who still "owns" a shared expense must NOT be able to mutate the
        // couple's data after unlinking.
        const delMembers = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
        const isMember = delMembers.some(m => m.id === userId);
        const authorized = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
        if (!authorized || guestOutOfCage(ctx, expense)) throw forbidden("No autorizado");
        await assertExpenseSpaceWritable(expense.coupleId);

        // Delete expense (splits cascade; the ledger Transaction cascades via FK).
        // Phase 4 (recurring-sync): deleting a recurring TEMPLATE must stop its
        // series or the series-driven materializer keeps firing with no template.
        // Deactivate (don't delete) so already-materialized instances keep their
        // seriesId lineage (series deletion would SetNull them). Phase 5: the
        // template is identified by series.templateId === this expense (not the
        // retired isRecurring column); instances never deactivate the series.
        await writeExpense(expense.coupleId, delMembers.map((m) => m.id), async (tx) => {
            if (expense.seriesId && expense.series?.templateId === expense.id) {
                await tx.recurringSeries.update({
                    where: { id: expense.seriesId },
                    data: { isActive: false },
                });
            }
            // deleteMany: a concurrent delete already removed it → still success.
            await tx.expense.deleteMany({ where: { id } });
        });

        return NextResponse.json({ success: true });
    },
);

/**
 * Edit an expense. Every field is optional; omitted fields keep their value.
 *
 * Split inputs (shared expenses), in precedence order:
 *   - `customSplits: {userId, amount(cents)}[]` → CUSTOM (must sum to the amount)
 *   - `beneficiaryId` → EXCLUSIVE (the whole amount to one member)
 *   - `splitEqual: true` → EQUAL over all current members
 *   - `receiptItems` with assigned lines → ITEMIZED (lines rescaled to the amount)
 *   - none of the above → recomputed from the PERSISTED strategy
 * `date` ("YYYY-MM-DD") must be a real day in [2000-01-01, today + 1 year].
 * The body SHAPE is validated by PatchExpenseBody; membership-dependent rules
 * are checked below, after authorization.
 */
export const PATCH = route(
    { auth: "user-or-guest", params: idParams, body: PatchExpenseBody, errorMessage: "Error al actualizar el gasto", logLabel: "Error updating expense:" },
    async ({ ctx, params: { id }, body }) => {
        const userId = ctx.userId;
        const {
            description, amount, category, splitWithPartner, receiptItems, notes, isRecurring, recurringInterval,
            customSplits, paidById: paidByIdInput, receiptUrl, date: newDate, beneficiaryId, splitEqual,
        } = body;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { series: true, ...RECEIPT_LINES_SELECT }
        });

        if (!expense) throw notFound("Gasto no encontrado");

        // Members via the Membership layer (ACTIVE, ordered) — backs BOTH the authz
        // check and split remainder-cent allocation / ledger re-post, so everything
        // matches POST/reconcile exactly.
        const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
        // N-way from day one: splits are recomputed for the full member set.
        const isShared = expense.visibility === "SHARED" && expense.coupleId != null && members.length > 0;

        // Personal expenses are authorized by ownership; shared ones strictly by
        // current couple membership.
        const isMember = members.some(m => m.id === userId);
        const authorized = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
        if (!authorized || guestOutOfCage(ctx, expense)) throw forbidden("No autorizado");
        await assertExpenseSpaceWritable(expense.coupleId);

        const memberIds = new Set(members.map(m => m.id));

        // Payer change (N-way): accept a new payer when it's a current member.
        if (paidByIdInput !== undefined && !memberIds.has(paidByIdInput)) throw badRequest(PAYER_NOT_MEMBER);
        const effectivePaidById = paidByIdInput ?? expense.paidById;

        // Description, interval, date and amount shape/bounds: PatchExpenseBody.
        // null / "" amount keeps the persisted one.
        const amountCents = typeof amount === 'number' ? amount : expense.amount;

        // Validate that client-supplied splits sum exactly to the expense amount
        // (line shape — integer, non-negative cents — is checked by the schema).
        const hasCustomSplits = !!customSplits && customSplits.length > 0;
        if (hasCustomSplits) {
            if (customSplits.some((s) => !memberIds.has(s.userId))) throw badRequest(SPLIT_NOT_MEMBER);
            if (customSplits.reduce((sum, s) => sum + s.amount, 0) !== amountCents) {
                throw badRequest('El reparto no suma el importe total');
            }
        }
        if (beneficiaryId != null && !memberIds.has(beneficiaryId)) throw badRequest(BENEFICIARY_NOT_MEMBER);

        // Recurrence: pre-state comes from the linked series (this expense is the
        // TEMPLATE iff series.templateId === its id).
        const wasTemplate = !!(expense.seriesId && expense.series?.templateId === expense.id);
        const wasRecurring = wasTemplate && (expense.series?.isActive ?? false);
        const resolvedIsRecurring = typeof isRecurring === 'boolean' ? isRecurring : wasRecurring;
        const resolvedInterval = recurringInterval !== undefined
            ? (recurringInterval as string | null)
            : (expense.series?.interval ?? null);
        // G-12: the next run is anchored on the expense date (the edited one when
        // it changes), never on "now".
        let nextRecurringDate: Date | null | undefined = undefined;
        if (isRecurring !== undefined || recurringInterval !== undefined || (newDate && wasRecurring)) {
            nextRecurringDate = resolvedIsRecurring && isRecurringInterval(resolvedInterval)
                ? nextRecurringRun(newDate ?? expense.date, resolvedInterval)
                : null;
        }

        const updateData: Prisma.ExpenseUncheckedUpdateInput = {
            description: typeof description === 'string' ? description.trim() : expense.description,
            amount: amountCents,
        };
        if (newDate) updateData.date = newDate;
        if (notes !== undefined) updateData.notes = notes?.trim() ? notes : null;
        // Receipt image: a string sets/replaces it, null removes it. undefined leaves it.
        if (receiptUrl !== undefined) updateData.receiptUrl = receiptUrl || null;
        if (paidByIdInput !== undefined) updateData.paidById = effectivePaidById;
        // Category validated against the EFFECTIVE set of the expense's context.
        if (category != null) {
            const resolvedCategoryId = await resolveCategoryId(
                category,
                expense.coupleId ? { groupId: expense.coupleId } : { ownerId: expense.ownerId },
            );
            if (!resolvedCategoryId) throw badRequest('Categoría no válida');
            updateData.categoryId = resolvedCategoryId;
        }

        const receiptList = receiptItems ? (receiptItems as ReceiptItemForSplit[]) : undefined;

        // Recalculate splits when a split-affecting field changes. `splitWithPartner`
        // is a retired binary toggle (kept only so old clients don't 400).
        const shouldRecalcSplits = isShared && (
            splitWithPartner !== undefined || amount !== undefined || receiptList !== undefined
            || customSplits !== undefined || beneficiaryId !== undefined || splitEqual === true
        );

        // `newSplits === null` means "leave splits untouched". `newStrategy ===
        // undefined` means "don't change the persisted strategy".
        let newSplits: { userId: string; amount: number }[] | null = null;
        let newStrategy: SplitStrategy | undefined = undefined;

        if (shouldRecalcSplits) {
            // Existing rows are needed to preserve the EXCLUSIVE beneficiary and to
            // rescale a CUSTOM distribution when only the amount changed.
            const existingSplits = await prisma.split.findMany({
                where: { expenseId: id },
                select: { userId: true, amount: true },
            });

            if (hasCustomSplits) {
                newStrategy = 'CUSTOM';
                newSplits = customSplits!.map(s => ({ userId: s.userId, amount: s.amount }));
            } else if (typeof beneficiaryId === 'string') {
                newStrategy = 'EXCLUSIVE';
                newSplits = [{ userId: beneficiaryId, amount: amountCents }];
            } else if (splitEqual === true && !hasExclusiveReceiptItems(receiptList)) {
                newStrategy = 'EQUAL';
                newSplits = calculateSplitAmounts(amountCents, null, members);
            } else if (receiptList !== undefined) {
                // A fresh receipt was supplied: EQUAL or ITEMIZED over ALL current
                // members (lines rescaled proportionally to the amount — G-03).
                newStrategy = hasExclusiveReceiptItems(receiptList) ? 'ITEMIZED' : 'EQUAL';
                newSplits = calculateSplitAmounts(amountCents, receiptList, members);
            } else {
                // No new split inputs (e.g. amount-only edit): recompute from the
                // PERSISTED strategy so a group of N never collapses.
                const strategy: SplitStrategy = expense.splitStrategy ?? 'EQUAL';
                if (strategy === 'EXCLUSIVE') {
                    const beneficiary = existingSplits.length === 1
                        ? existingSplits[0].userId
                        : [...existingSplits].sort((a, b) => b.amount - a.amount)[0]?.userId;
                    if (beneficiary && memberIds.has(beneficiary)) {
                        newStrategy = 'EXCLUSIVE';
                        newSplits = [{ userId: beneficiary, amount: amountCents }];
                    } else {
                        newStrategy = 'EQUAL';
                        newSplits = calculateSplitAmounts(amountCents, null, members);
                    }
                } else if (strategy === 'ITEMIZED') {
                    newStrategy = 'ITEMIZED';
                    newSplits = calculateSplitAmountsFromLines(amountCents, linesForSplit(expense.lineItems), members);
                } else if (strategy === 'CUSTOM') {
                    // Can't invent per-user amounts: rescale the existing distribution
                    // proportionally so it still sums to the amount and stays N-way.
                    newStrategy = 'CUSTOM';
                    newSplits = existingSplits.length > 0
                        ? rescaleSplits(existingSplits, amountCents)
                        : calculateSplitAmounts(amountCents, null, members);
                } else {
                    newStrategy = 'EQUAL';
                    newSplits = calculateSplitAmounts(amountCents, null, members);
                }
            }
        }

        if (newStrategy !== undefined) updateData.splitStrategy = newStrategy;

        // Update the expense, its splits, receipt lines, ledger and series in one
        // transaction (READ COMMITTED + retried on write conflicts — G-04), under
        // the space lock for a shared expense (A3).
        const updatedExpense = await writeExpense(expense.coupleId, members.map((m) => m.id), async (tx) => {
            const updated = await tx.expense.update({
                where: { id },
                data: updateData,
            });

            if (newSplits !== null) {
                await tx.split.deleteMany({ where: { expenseId: id } });
                await tx.split.createMany({
                    data: newSplits.map(s => ({ expenseId: id, userId: s.userId, amount: s.amount }))
                });
            }

            // Rewrite the relational receipt line items when the receipt changes
            // (an empty array removes the breakdown).
            if (receiptList !== undefined) {
                await tx.receiptLineItem.deleteMany({ where: { expenseId: id } });
                const lines = buildReceiptLineItems(receiptList, memberIds);
                if (lines.length > 0) {
                    await tx.receiptLineItem.createMany({
                        data: lines.map(l => ({ ...l, expenseId: id })),
                    });
                }
            }

            // Keep the ledger in sync on edit (idempotent re-post on dedupeKey).
            // Guard: only re-post when the fresh splits sum to the amount.
            if (updated.visibility === 'SHARED' && updated.coupleId) {
                const freshSplits = await tx.split.findMany({
                    where: { expenseId: id },
                    select: { userId: true, amount: true },
                });
                const splitSum = freshSplits.reduce((a, s) => a + s.amount, 0);
                if (splitSum === updated.amount) {
                    await postExpenseLedger(tx, {
                        expenseId: id,
                        groupId: updated.coupleId,
                        amount: updated.amount,
                        paidById: updated.paidById,
                        occurredAt: updated.date,
                        splits: freshSplits,
                        members,
                    });
                }
            }

            // Keep the linked RecurringSeries in lockstep with the template Expense.
            if (updated.seriesId) {
                if (!resolvedIsRecurring) {
                    // Deactivate ONLY on a genuine template toggle-off. Editing a
                    // materialized INSTANCE never touches the series.
                    if (wasRecurring) {
                        await tx.recurringSeries.update({
                            where: { id: updated.seriesId },
                            data: { isActive: false },
                        });
                    }
                } else {
                    await tx.recurringSeries.update({
                        where: { id: updated.seriesId },
                        data: {
                            description: updated.description,
                            amount: updated.amount,
                            categoryId: updated.categoryId,
                            splitStrategy: updated.splitStrategy,
                            notes: updated.notes,
                            isActive: true,
                            ...(isRecurringInterval(resolvedInterval) ? { interval: resolvedInterval } : {}),
                            ...(nextRecurringDate ? { nextRunDate: nextRecurringDate } : {}),
                        },
                    });
                }
            } else if (resolvedIsRecurring && isRecurringInterval(resolvedInterval) && nextRecurringDate) {
                // Toggle ON for an expense that never had a series: create + link it.
                const series = await tx.recurringSeries.create({
                    data: {
                        description: updated.description,
                        amount: updated.amount,
                        categoryId: updated.categoryId,
                        visibility: updated.visibility,
                        splitStrategy: updated.splitStrategy,
                        notes: updated.notes,
                        interval: resolvedInterval,
                        nextRunDate: nextRecurringDate,
                        coupleId: updated.coupleId,
                        ownerId: updated.ownerId,
                        paidById: updated.paidById,
                        currency: updated.currency,
                        minorUnit: updated.minorUnit,
                        isActive: true,
                        templateId: id,
                    },
                });
                await tx.expense.update({ where: { id }, data: { seriesId: series.id } });
            }

            return updated;
        });

        return NextResponse.json({ success: true, expense: updatedExpense });
    },
);
