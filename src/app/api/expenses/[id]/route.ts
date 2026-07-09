import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { toCents } from "@/lib/currency";
import { calculateSplitAmounts, calculateSplitAmountsFromLines, hasExclusiveReceiptItems, hasExclusiveReceiptLines, type ReceiptItemForSplit } from "@/lib/splits";
import { RECEIPT_LINES_SELECT, linesForSplit } from "@/lib/receipt-read";
import { resolveCategoryId } from "@/lib/category-db";
import { buildReceiptLineItems } from "@/lib/receipt";
import { getGroupMembers } from "@/lib/membership";
import { postExpenseLedger } from "@/lib/ledger";
import { Prisma } from "@/generated/prisma/client";

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { series: true }
        });

        if (!expense) {
            return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
        }

        // Personal expenses are authorized by ownership; shared ones strictly by
        // current couple membership via the Membership layer (Phase 5 WS1) — an
        // ex-member who still "owns" a shared expense must NOT be able to mutate the
        // couple's data after unlinking.
        const delMembers = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
        const isMember = delMembers.some(m => m.id === userId);
        const authorized = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
        if (!authorized) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        // Delete expense (splits cascade; the ledger Transaction cascades via FK).
        // Phase 4 (recurring-sync): deleting a recurring TEMPLATE must stop its
        // series or the series-driven materializer keeps firing with no template.
        // Deactivate (don't delete) so already-materialized instances keep their
        // seriesId lineage (series deletion would SetNull them). Phase 5: the
        // template is identified by series.templateId === this expense (not the
        // retired isRecurring column); instances never deactivate the series.
        await prisma.$transaction(async (tx) => {
            if (expense.seriesId && expense.series?.templateId === expense.id) {
                await tx.recurringSeries.update({
                    where: { id: expense.seriesId },
                    data: { isActive: false },
                });
            }
            await tx.expense.delete({ where: { id } });
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting expense:", error);
        return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
    }
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getSession();
        if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const userId = session.userId as string;

        const body = await request.json();
        const { description, amount, category, splitWithPartner, receiptItems, notes, isRecurring, recurringInterval, customSplits } = body;

        // Get expense and verify ownership
        const expense = await prisma.expense.findUnique({
            where: { id },
            include: { series: true, ...RECEIPT_LINES_SELECT }
        });

        if (!expense) {
            return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
        }

        // Members via the Membership layer (ACTIVE, ordered) — backs BOTH the authz
        // check and split remainder-cent allocation / ledger re-post, so everything
        // matches POST/reconcile exactly (Phase 5 WS1: no couple.members reverse
        // relation).
        const members = expense.coupleId ? await getGroupMembers(expense.coupleId) : [];
        const partner = members.find(m => m.id !== expense.paidById);

        // Personal expenses are authorized by ownership; shared ones strictly by
        // current couple membership (an ex-member who still "owns" a shared expense
        // must NOT be able to mutate the couple's data after unlinking).
        const isMember = members.some(m => m.id === userId);
        const authorized = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
        if (!authorized) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        const memberIds = new Set(members.map(m => m.id));

        // Validate description (when provided) is a non-empty string; an empty one previously 500'd at the DB layer.
        if (description !== undefined && (typeof description !== 'string' || description.trim().length === 0)) {
            return NextResponse.json({ error: 'Invalid description' }, { status: 400 });
        }

        // Normalize/validate enum inputs so out-of-vocabulary values cannot trigger a DB enum 500.
        const VALID_CATEGORIES = ['shopping', 'food', 'rent', 'utilities', 'transport', 'entertainment', 'health', 'other'];
        const VALID_INTERVALS = ['weekly', 'monthly', 'yearly'];
        if (category !== undefined && category !== null && !VALID_CATEGORIES.includes(category)) {
            return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
        }
        if (recurringInterval !== undefined && recurringInterval !== null && !VALID_INTERVALS.includes(recurringInterval)) {
            return NextResponse.json({ error: 'Invalid recurring interval' }, { status: 400 });
        }

        // Update expense
        const amountCents = amount ? toCents(parseFloat(amount)) : expense.amount;
        if (amount !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
            return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
        }

        // Validate that client-supplied splits sum exactly to the expense amount.
        if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
            if (customSplits.some((s: { amount: number }) => (s?.amount ?? 0) < 0)) {
                return NextResponse.json({ error: 'Split amounts must not be negative' }, { status: 400 });
            }
            if (customSplits.some((s: { userId: string }) => !memberIds.has(s?.userId))) {
                return NextResponse.json({ error: 'Split user is not a member of your couple' }, { status: 400 });
            }
            const splitsTotal = customSplits.reduce(
                (sum: number, s: { amount: number }) => sum + (s?.amount ?? 0),
                0
            );
            if (splitsTotal !== amountCents) {
                return NextResponse.json({ error: 'Splits must sum to the total amount' }, { status: 400 });
            }
        }

        // Recalculate nextRecurringDate if recurring settings changed.
        // Phase 5 (stop-dual-write): pre-state comes from the linked series (this
        // expense is the TEMPLATE iff series.templateId === its id), not the retired
        // Expense.isRecurring/recurringInterval columns.
        const wasTemplate = !!(expense.seriesId && expense.series?.templateId === expense.id);
        const wasRecurring = wasTemplate && (expense.series?.isActive ?? false);
        const resolvedIsRecurring = isRecurring ?? wasRecurring;
        const resolvedInterval = recurringInterval !== undefined ? recurringInterval : (expense.series?.interval ?? null);
        let nextRecurringDate: Date | null | undefined = undefined;
        if (isRecurring !== undefined || recurringInterval !== undefined) {
            if (resolvedIsRecurring && resolvedInterval) {
                const base = new Date();
                if (resolvedInterval === 'weekly') {
                    nextRecurringDate = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
                } else if (resolvedInterval === 'monthly') {
                    nextRecurringDate = new Date(base);
                    nextRecurringDate.setMonth(nextRecurringDate.getMonth() + 1);
                } else if (resolvedInterval === 'yearly') {
                    nextRecurringDate = new Date(base);
                    nextRecurringDate.setFullYear(nextRecurringDate.getFullYear() + 1);
                }
            } else {
                nextRecurringDate = null;
            }
        }

        const updateData: Prisma.ExpenseUncheckedUpdateInput = {
            description: description ?? expense.description,
            amount: amountCents,
            // Phase 5 (WS5): enum category no longer written; categoryId is synced below.
        };
        if (notes !== undefined) updateData.notes = notes;
        // Phase 5 (stop-dual-write): Expense.isRecurring/recurringInterval/
        // nextRecurringDate are no longer written; the schedule is mirrored to the
        // RecurringSeries in the series-sync block below (using the resolved locals).
        // Keep the relational Category in sync when the enum category changes (Phase 2b).
        if (category !== undefined && category !== null) {
            updateData.categoryId = await resolveCategoryId(category, expense.coupleId);
        }

        // Recalculate splits if split mode changed, amount changed, receiptItems changed, or customSplits provided
        const shouldRecalcSplits = splitWithPartner !== undefined || amount !== undefined || receiptItems !== undefined || customSplits !== undefined;

        // Determine the existing split mode BEFORE deleting anything — otherwise the
        // count is always 0 and an amount-only edit silently collapses a 50/50 split.
        let isSplitWithPartner = false;
        if (shouldRecalcSplits && partner && !(customSplits && Array.isArray(customSplits) && customSplits.length > 0)) {
            const existingSplits = await prisma.split.findMany({ where: { expenseId: id } });
            isSplitWithPartner = splitWithPartner !== undefined
                ? splitWithPartner
                : existingSplits.length === 2;
        }

        // Keep the persisted split strategy in sync when splits are recalculated.
        if (shouldRecalcSplits && partner) {
            if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
                updateData.splitStrategy = 'CUSTOM';
            } else if (isSplitWithPartner) {
                // Body branch: request receipt (euro floats). Fallback branch
                // (receiptItems===undefined, e.g. amount-only edit): the PERSISTED
                // ReceiptLineItem rows are the read source (Phase 4 read-switch).
                const itemized = receiptItems !== undefined
                    ? hasExclusiveReceiptItems(receiptItems)
                    : hasExclusiveReceiptLines(expense.lineItems);
                updateData.splitStrategy = itemized ? 'ITEMIZED' : 'EQUAL';
            } else {
                updateData.splitStrategy = 'EXCLUSIVE';
            }
        }

        // Update the expense and rewrite its splits atomically so a failure mid-way
        // can never leave the expense updated with stale/orphaned splits.
        const updatedExpense = await prisma.$transaction(async (tx) => {
            const updated = await tx.expense.update({
                where: { id },
                data: updateData,
            });

            if (shouldRecalcSplits && partner) {
                await tx.split.deleteMany({ where: { expenseId: id } });

                if (customSplits && Array.isArray(customSplits) && customSplits.length > 0) {
                    await tx.split.createMany({
                        data: customSplits.map((s: { userId: string; amount: number }) => ({
                            expenseId: id,
                            userId: s.userId,
                            amount: s.amount,
                        }))
                    });
                } else if (isSplitWithPartner) {
                    // Body branch: split from the request receipt (euro floats,
                    // unchanged create-time path). Fallback branch: split from the
                    // PERSISTED ReceiptLineItem rows (cents-native, Phase 4 switch).
                    const splits = receiptItems !== undefined
                        ? calculateSplitAmounts(amountCents, receiptItems as ReceiptItemForSplit[] | null, members)
                        : calculateSplitAmountsFromLines(amountCents, linesForSplit(expense.lineItems), members);
                    await tx.split.createMany({
                        data: splits.map(s => ({ expenseId: id, userId: s.userId, amount: s.amount }))
                    });
                } else {
                    await tx.split.create({
                        data: { expenseId: id, userId: partner.id, amount: amountCents }
                    });
                }
            }

            // Rewrite the relational receipt line items when the receipt changes
            // (the source of truth; the legacy receiptData JSON column is no longer
            // written — Phase 5 stop-dual-write).
            if (receiptItems !== undefined) {
                await tx.receiptLineItem.deleteMany({ where: { expenseId: id } });
                const lines = buildReceiptLineItems(receiptItems, memberIds);
                if (lines.length > 0) {
                    await tx.receiptLineItem.createMany({
                        data: lines.map(l => ({ ...l, expenseId: id })),
                    });
                }
            }

            // Phase 4: keep the ledger in sync on edit. amount/splits may have just
            // changed; re-post so Σ LedgerEntry stays == calculateBalances (reconcile
            // invariant). postExpenseLedger upserts on dedupeKey 'expense:<id>' and
            // rebuilds entries, so this is idempotent/self-healing. PERSONAL posts
            // nothing. Guard: only re-post when the fresh splits sum to the amount —
            // in a degenerate solo couple splits aren't recalculated on an amount
            // edit, and posting a non-zero-sum txn would (correctly) throw.
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

            // Phase 4/5 (recurring-sync + stop-dual-write): keep the linked
            // RecurringSeries in lockstep with the template Expense, in the SAME
            // transaction, using the resolved recurrence LOCALS (the Expense
            // recurrence columns are no longer written). A template is the expense
            // with series.templateId === its id (captured in wasTemplate/wasRecurring).
            if (updated.seriesId) {
                if (!resolvedIsRecurring) {
                    // Deactivate ONLY on a genuine template toggle-off (pre-state was
                    // recurring). Editing a materialized INSTANCE (wasRecurring false)
                    // never touches the series. Deactivate, never delete —
                    // Expense.seriesId is onDelete:SetNull, so deleting the series
                    // would orphan instance lineage; isActive=false is reversible.
                    if (wasRecurring) {
                        await tx.recurringSeries.update({
                            where: { id: updated.seriesId },
                            data: { isActive: false },
                        });
                    }
                } else {
                    // Template still recurring: mirror its scalars to the series.
                    // NOTE (non-gating risk): a materialized instance PATCHed to
                    // isRecurring=true also lands here — a rare, user-driven edge a
                    // future pass should create a fresh series for (or reject).
                    await tx.recurringSeries.update({
                        where: { id: updated.seriesId },
                        data: {
                            description: updated.description,
                            amount: updated.amount,
                            categoryId: updated.categoryId, // Phase 5 (WS5): enum category no longer mirrored
                            splitStrategy: updated.splitStrategy,
                            notes: updated.notes,
                            isActive: true, // re-activate when recurring is toggled back ON
                            // interval/nextRunDate are NOT NULL on the series; only
                            // mirror when the resolved locals actually carry values
                            // (an amount-only edit leaves both untouched).
                            ...(resolvedInterval ? { interval: resolvedInterval } : {}),
                            ...(nextRecurringDate ? { nextRunDate: nextRecurringDate } : {}),
                        },
                    });
                }
            } else if (resolvedIsRecurring && resolvedInterval && nextRecurringDate) {
                // Toggle ON for an expense that never had a series: create + link it
                // (POST already creates series). templateId points at this expense.
                const series = await tx.recurringSeries.create({
                    data: {
                        description: updated.description,
                        amount: updated.amount,
                        categoryId: updated.categoryId, // Phase 5 (WS5): enum category no longer written
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
    } catch (error) {
        console.error("Error updating expense:", error);
        return NextResponse.json({ error: "Error al actualizar" }, { status: 500 });
    }
}
