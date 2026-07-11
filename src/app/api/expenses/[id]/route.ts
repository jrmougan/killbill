import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { toCents } from "@/lib/currency";
import { calculateSplitAmounts, calculateSplitAmountsFromLines, hasExclusiveReceiptItems, rescaleSplits, type ReceiptItemForSplit } from "@/lib/splits";
import type { SplitStrategy } from "@/generated/prisma/enums";
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
        const { description, amount, category, splitWithPartner, receiptItems, notes, isRecurring, recurringInterval, customSplits, paidById: paidByIdInput } = body;

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
        // A shared expense has splits over its group's ACTIVE members. N-way from
        // day one: NO "partner" / 2-member heuristic — splits are recomputed for the
        // full member set from the PERSISTED splitStrategy (see below).
        const isShared = expense.visibility === "SHARED" && expense.coupleId != null && members.length > 0;

        // Personal expenses are authorized by ownership; shared ones strictly by
        // current couple membership (an ex-member who still "owns" a shared expense
        // must NOT be able to mutate the couple's data after unlinking).
        const isMember = members.some(m => m.id === userId);
        const authorized = expense.visibility === "PERSONAL" ? expense.ownerId === userId : isMember;
        if (!authorized) {
            return NextResponse.json({ error: "No autorizado" }, { status: 403 });
        }

        const memberIds = new Set(members.map(m => m.id));

        // Payer change (F5, N-way): accept a new payer when it's a current member.
        // The ledger re-post below reads updated.paidById, so changing it re-attributes
        // who fronted the money without touching the split shares.
        if (paidByIdInput !== undefined && (typeof paidByIdInput !== 'string' || !memberIds.has(paidByIdInput))) {
            return NextResponse.json({ error: 'Payer is not a member of your group' }, { status: 400 });
        }
        const effectivePaidById = typeof paidByIdInput === 'string' && memberIds.has(paidByIdInput)
            ? paidByIdInput
            : expense.paidById;

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
        if (paidByIdInput !== undefined) updateData.paidById = effectivePaidById;
        // Phase 5 (stop-dual-write): Expense.isRecurring/recurringInterval/
        // nextRecurringDate are no longer written; the schedule is mirrored to the
        // RecurringSeries in the series-sync block below (using the resolved locals).
        // Keep the relational Category in sync when the enum category changes (Phase 2b).
        if (category !== undefined && category !== null) {
            updateData.categoryId = await resolveCategoryId(
                category,
                expense.coupleId ? { groupId: expense.coupleId } : { ownerId: expense.ownerId },
            );
        }

        // Recalculate splits when a split-affecting field changes. `splitWithPartner`
        // is a retired binary toggle (kept only so old clients don't 400); it no
        // longer drives the strategy — the PERSISTED splitStrategy does.
        const hasCustomSplits = customSplits && Array.isArray(customSplits) && customSplits.length > 0;
        const shouldRecalcSplits = isShared
            && (splitWithPartner !== undefined || amount !== undefined || receiptItems !== undefined || customSplits !== undefined);

        // Rehydrate the N-way split from the persisted strategy (never from member
        // count). `newSplits === null` means "leave splits untouched". `newStrategy
        // === undefined` means "don't change the persisted strategy".
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
                newSplits = (customSplits as { userId: string; amount: number }[])
                    .map(s => ({ userId: s.userId, amount: s.amount }));
            } else if (receiptItems !== undefined) {
                // A fresh receipt was supplied: EQUAL or ITEMIZED, split N-way over
                // ALL current members (euro-float request path).
                newStrategy = hasExclusiveReceiptItems(receiptItems) ? 'ITEMIZED' : 'EQUAL';
                newSplits = calculateSplitAmounts(amountCents, receiptItems as ReceiptItemForSplit[] | null, members);
            } else {
                // No new split inputs (e.g. amount-only edit): recompute from the
                // PERSISTED strategy so a group of N never collapses.
                const strategy: SplitStrategy = expense.splitStrategy ?? 'EQUAL';
                if (strategy === 'EXCLUSIVE') {
                    // Preserve the single beneficiary; move the (possibly new) full
                    // amount to them. Fall back to EQUAL if the beneficiary is no
                    // longer a member.
                    const beneficiaryId = existingSplits.length === 1
                        ? existingSplits[0].userId
                        : [...existingSplits].sort((a, b) => b.amount - a.amount)[0]?.userId;
                    if (beneficiaryId && memberIds.has(beneficiaryId)) {
                        newStrategy = 'EXCLUSIVE';
                        newSplits = [{ userId: beneficiaryId, amount: amountCents }];
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

        // Update the expense and rewrite its splits atomically so a failure mid-way
        // can never leave the expense updated with stale/orphaned splits.
        const updatedExpense = await prisma.$transaction(async (tx) => {
            const updated = await tx.expense.update({
                where: { id },
                data: updateData,
            });

            // Rewrite the N-way splits computed above (from the persisted strategy),
            // atomically. `newSplits === null` leaves them untouched.
            if (newSplits !== null) {
                await tx.split.deleteMany({ where: { expenseId: id } });
                await tx.split.createMany({
                    data: newSplits.map(s => ({ expenseId: id, userId: s.userId, amount: s.amount }))
                });
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
