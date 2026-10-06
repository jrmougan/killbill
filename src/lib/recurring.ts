import { prisma } from '@/lib/db';
import { postExpenseLedger } from '@/lib/ledger';
import { lockSpaceRow, runLedgerTransaction } from '@/lib/expense-tx';
import { addInterval } from '@/lib/recurring-interval';

// Pure helper lives in recurring-interval.ts (client-safe); re-exported here.
export { addInterval };

// Safety cap on catch-up iterations per source expense to avoid runaway loops.
const MAX_CATCHUP_ITERATIONS = 60;

import type { Prisma } from '@/generated/prisma/client';

/**
 * Materializes every due series of the whole app (both scopes). Entry point of
 * the scheduled job (POST /api/cron/recurring); the dashboard keeps its lazy
 * per-space trigger, and both are safe to run concurrently (see below).
 */
export async function materializeAllDueRecurring(): Promise<number> {
    return materializeDueRecurring({});
}

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
 * Phase 4 (recurring-sync) read-switch: the schedule lives on RecurringSeries
 * (nextRunDate / interval / isActive). The linked TEMPLATE expense (via the
 * durable series.templateId pointer) provides the money scalars and the
 * splits/tags to copy: template.amount together with the template's own splits
 * is zero-sum by construction, so a stale series.amount can never produce a
 * non-balancing ledger post. Due series and their templates are loaded in ONE
 * query (no per-series lookup — M4).
 *
 * Safety / idempotency (M4):
 * - Each occurrence is its own ledger transaction (runLedgerTransaction: READ
 *   COMMITTED, retried on deadlock / write conflict) and is CLAIMED with a
 *   conditional updateMany on the nextRunDate we read, so concurrent runners
 *   (two dashboard renders, the cron) never double-create: the loser sees
 *   count 0 and stops.
 * - A SHARED occurrence takes the space row lock first (same lock order as
 *   every other space write) and re-reads the space status and ACTIVE roster
 *   inside the transaction. A space that is no longer ACTIVE (SETTLING /
 *   ARCHIVED) gets NO new expense — its accounts are being closed or are
 *   read-only — and its series is left untouched until it is reopened.
 * - A due series without a live template (should not happen — DELETE
 *   deactivates the series) is skipped, never materialized blind.
 *
 * @returns total number of expense instances created across all due series.
 */
async function materializeDueRecurring(scope: Prisma.RecurringSeriesWhereInput): Promise<number> {
    const dueSeries = await prisma.recurringSeries.findMany({
        where: {
            ...scope,
            isActive: true,
            nextRunDate: { lte: new Date() },
            templateId: { not: null },
            // Cheap pre-filter; the authoritative status check is under the lock.
            OR: [{ coupleId: null }, { couple: { status: 'ACTIVE' } }],
        },
        include: { template: { include: { splits: true, tags: true } } },
    });

    let created = 0;

    for (const series of dueSeries) {
        const template = series.template;
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

            const result = await runLedgerTransaction(async (tx) => {
                const shared = template.visibility === 'SHARED' && template.coupleId !== null;
                if (shared) {
                    // Space lock FIRST (lock order), then the status under it.
                    const status = await lockSpaceRow(tx, template.coupleId!);
                    if (status !== 'ACTIVE') return false;
                }

                // Claim this occurrence: conditional on nextRunDate still being the
                // value we read, so concurrent runners can't double-create.
                const advanced = await tx.recurringSeries.updateMany({
                    where: { id: series.id, isActive: true, nextRunDate: occurrence },
                    data: { nextRunDate: advancedDate },
                });

                // Another concurrent run already advanced this series — stop here.
                if (advanced.count === 0) return false;

                const instance = await tx.expense.create({
                    data: {
                        description: template.description,
                        amount: template.amount,
                        // Phase 5 (WS5): enum category no longer written; inherit only
                        // the relational categoryId (Phase 2b).
                        categoryId: template.categoryId,
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

                // A materialized SHARED instance is an ordinary expense, so post its
                // ledger transaction in the same tx (roster read INSIDE the tx, under
                // the lock). If the copied splits don't balance (only possible when
                // the template itself is inconsistent), postTransaction throws and
                // the WHOLE occurrence rolls back (claim included) — callers
                // try/catch + log.
                if (instance.visibility === 'SHARED' && instance.coupleId) {
                    const members = await tx.membership.findMany({
                        where: { groupId: instance.coupleId, status: 'ACTIVE' },
                        orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
                        select: { userId: true },
                    });
                    await postExpenseLedger(tx, {
                        expenseId: instance.id,
                        groupId: instance.coupleId,
                        amount: instance.amount,
                        paidById: instance.paidById,
                        occurredAt: instance.date,
                        splits: instance.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
                        members: members.map((m) => ({ id: m.userId })),
                    });
                }

                return true;
            });

            if (!result) break; // lost the race / space closed; nothing more for this series

            created++;
            current = advancedDate;
        }
    }

    return created;
}
