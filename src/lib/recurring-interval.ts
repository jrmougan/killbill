/**
 * Returns a NEW Date advanced by one period from `base`.
 * - 'weekly'  -> +7 days
 * - 'monthly' -> +1 month
 * - 'yearly'  -> +1 year
 * Unknown intervals return an unchanged copy of `base`. Never mutates the input.
 * Pure (no DB) so client code and validators can share it.
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
