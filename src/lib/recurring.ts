import { prisma } from '@/lib/db';
import { getGroupMembers } from '@/lib/membership';
import { postExpenseLedger } from '@/lib/ledger';

/**
 * Returns a NEW Date advanced by one period from `base`.
 * - 'weekly'  -> +7 days
 * - 'monthly' -> +1 month
 * - 'yearly'  -> +1 year
 * Unknown intervals return an unchanged copy of `base`. Never mutates the input.
 */
export function addInterval(base: Date, interval: string): Date {
    const next = new Date(base);
    if (interval === 'weekly') {
        next.setDate(next.getDate() + 7);
    } else if (interval === 'monthly') {
        next.setMonth(next.getMonth() + 1);
    } else if (interval === 'yearly') {
        next.setFullYear(next.getFullYear() + 1);
    }
    return next;
}

// Safety cap on catch-up iterations per source expense to avoid runaway loops.
const MAX_CATCHUP_ITERATIONS = 60;

import type { Prisma } from '@/generated/prisma/client';

/**
 * Lazily materializes any due recurring expenses for a couple (shared expenses).
 * @returns total number of expense instances created across all source expenses.
 */
export async function materializeDueRecurringExpenses(coupleId: string): Promise<number> {
    return materializeDueRecurring({ coupleId, visibility: 'SHARED' });
}

/**
 * Lazily materializes any due recurring PERSONAL expenses for a single user.
 * Personal recurring sources have coupleId=null and are never picked up by the
 * couple-scoped runner, so the personal ledger view triggers this instead.
 */
export async function materializeDueRecurringExpensesForOwner(ownerId: string): Promise<number> {
    return materializeDueRecurring({ ownerId, visibility: 'PERSONAL' });
}

/**
 * Core catch-up loop shared by the couple and owner scopes.
 *
 * Phase 4 (recurring-sync) read-switch: the schedule now lives on
 * RecurringSeries (nextRunDate / interval / isActive) — due series are found
 * there, NOT via Expense.isRecurring/nextRecurringDate. The linked template
 * Expense (isRecurring=true, seriesId=series.id) still provides the money
 * scalars and the splits/tags to copy: template.amount together with the
 * template's own splits is zero-sum by construction, so a stale series.amount
 * can never produce a non-balancing ledger post.
 *
 * Concurrency guard moved to series.nextRunDate: each occurrence is claimed
 * with a conditional updateMany on the value we read, so only one runner wins.
 * The template's legacy Expense.nextRecurringDate advances in lockstep
 * (dual-write kept until the recurrence-field drop).
 *
 * A due series without a live template (should not happen — DELETE deactivates
 * the series) is skipped, never materialized blind.
 *
 * @returns total number of expense instances created across all due series.
 */
async function materializeDueRecurring(scope: Prisma.RecurringSeriesWhereInput): Promise<number> {
    const dueSeries = await prisma.recurringSeries.findMany({
        where: {
            ...scope,
            isActive: true,
            nextRunDate: { lte: new Date() },
        },
    });

    let created = 0;

    for (const series of dueSeries) {
        // Phase 5 (stop-dual-write): identify the template via the durable
        // series.templateId pointer, not Expense.isRecurring (no longer written).
        if (!series.templateId) continue; // no template pointer — skip safely
        const template = await prisma.expense.findUnique({
            where: { id: series.templateId },
            include: { splits: true, tags: true },
        });
        if (!template) continue; // template deleted (FK SetNull'd) — skip safely

        let current: Date | null = series.nextRunDate;
        let iterations = 0;

        // Catch up every missed period until the next occurrence is in the future.
        while (
            current !== null &&
            current.getTime() <= Date.now() &&
            iterations < MAX_CATCHUP_ITERATIONS
        ) {
            iterations++;

            const occurrence = current;
            const advancedDate = addInterval(occurrence, series.interval);

            const result = await prisma.$transaction(async (tx) => {
                // Claim this occurrence: conditional on nextRunDate still being the
                // value we read, so concurrent runners can't double-create.
                const advanced = await tx.recurringSeries.updateMany({
                    where: { id: series.id, nextRunDate: occurrence },
                    data: { nextRunDate: advancedDate },
                });

                // Another concurrent run already advanced this series — stop here.
                if (advanced.count === 0) return false;

                const instance = await tx.expense.create({
                    data: {
                        description: template.description,
                        amount: template.amount,
                        category: template.category,
                        categoryId: template.categoryId, // inherit relational category (Phase 2b)
                        paidById: template.paidById,
                        ownerId: template.ownerId,
                        visibility: template.visibility,
                        splitStrategy: template.splitStrategy, // inherit intent from the template
                        coupleId: template.coupleId,
                        seriesId: series.id,
                        notes: template.notes ?? null,
                        date: occurrence, // the scheduled occurrence date, not now
                        splits: template.splits.length > 0
                            ? {
                                  create: template.splits.map((s) => ({
                                      userId: s.userId,
                                      amount: s.amount,
                                  })),
                              }
                            : undefined,
                        tags: template.tags.length > 0
                            ? {
                                  create: template.tags.map((t) => ({
                                      tagId: t.tagId,
                                  })),
                              }
                            : undefined,
                    },
                    include: { splits: true },
                });

                // Phase 3 dual-write: a materialized SHARED instance is an ordinary
                // expense finance.ts counts, so post its ledger transaction in the
                // same tx. If the copied splits don't balance (only possible when
                // the template itself is inconsistent), postTransaction throws and
                // the WHOLE occurrence rolls back (claim included) — reconcile
                // stays green and callers already try/catch + log.
                if (instance.visibility === 'SHARED' && instance.coupleId) {
                    const members = (await getGroupMembers(instance.coupleId)).map((m) => ({ id: m.id }));
                    await postExpenseLedger(tx, {
                        expenseId: instance.id,
                        groupId: instance.coupleId,
                        amount: instance.amount,
                        paidById: instance.paidById,
                        occurredAt: instance.date,
                        splits: instance.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
                        members,
                    });
                }

                return true;
            });

            if (!result) break; // lost the race; another runner is handling this series

            created++;
            current = advancedDate;
        }
    }

    return created;
}
