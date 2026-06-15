import { prisma } from '@/lib/db';

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

/**
 * Lazily materializes any due recurring expenses for a couple.
 *
 * For each recurring source expense whose `nextRecurringDate` is in the past,
 * every missed period is caught up: an instance is created for each scheduled
 * occurrence until `nextRecurringDate` moves into the future.
 *
 * Each iteration is concurrency-safe via a conditional-advance guard: the source
 * date is advanced with an `updateMany` conditioned on the value we read, so only
 * one runner wins. If another runner already advanced it, we stop looping that
 * expense.
 *
 * @returns total number of expense instances created across all source expenses.
 */
export async function materializeDueRecurringExpenses(coupleId: string): Promise<number> {
    const dueExpenses = await prisma.expense.findMany({
        where: {
            coupleId,
            isRecurring: true,
            nextRecurringDate: { lte: new Date() },
        },
        include: {
            splits: true,
            tags: true,
        },
    });

    let created = 0;

    for (const expense of dueExpenses) {
        const interval = expense.recurringInterval;
        if (!interval) continue;

        let current = expense.nextRecurringDate as Date | null;
        let iterations = 0;

        // Catch up every missed period until the next occurrence is in the future.
        while (
            current !== null &&
            current.getTime() <= Date.now() &&
            iterations < MAX_CATCHUP_ITERATIONS
        ) {
            iterations++;

            const occurrence = current;
            const advancedDate = addInterval(occurrence, interval);

            // Create the new instance and advance the source date atomically, guarding
            // against concurrent invocations double-creating: the update is conditional
            // on nextRecurringDate still being the value we read, so only one runner wins.
            const result = await prisma.$transaction(async (tx) => {
                const advanced = await tx.expense.updateMany({
                    where: { id: expense.id, nextRecurringDate: occurrence },
                    data: { nextRecurringDate: advancedDate },
                });

                // Another concurrent run already advanced this expense — stop here.
                if (advanced.count === 0) return false;

                await tx.expense.create({
                    data: {
                        description: expense.description,
                        amount: expense.amount,
                        category: expense.category,
                        paidById: expense.paidById,
                        coupleId: expense.coupleId,
                        notes: expense.notes ?? null,
                        date: occurrence, // the scheduled occurrence date, not now
                        isRecurring: false, // only the source stays recurring
                        splits: expense.splits.length > 0
                            ? {
                                  create: expense.splits.map((s) => ({
                                      userId: s.userId,
                                      amount: s.amount,
                                  })),
                              }
                            : undefined,
                        tags: expense.tags.length > 0
                            ? {
                                  create: expense.tags.map((t) => ({
                                      tagId: t.tagId,
                                  })),
                              }
                            : undefined,
                    },
                });

                return true;
            });

            if (!result) break; // lost the race; another runner is handling this expense

            created++;
            current = advancedDate;
        }
    }

    return created;
}
