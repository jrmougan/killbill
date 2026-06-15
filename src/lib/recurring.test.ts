import { describe, it, expect } from 'vitest';
import { addInterval } from './recurring';

describe('addInterval', () => {
    describe('weekly', () => {
        it('advances by 7 days', () => {
            const base = new Date(2025, 0, 1); // Jan 1, 2025 (local)
            const next = addInterval(base, 'weekly');
            expect(next.getFullYear()).toBe(2025);
            expect(next.getMonth()).toBe(0);
            expect(next.getDate()).toBe(8);
        });

        it('rolls over month/year boundaries', () => {
            const base = new Date(2025, 11, 29); // Dec 29, 2025
            const next = addInterval(base, 'weekly');
            expect(next.getFullYear()).toBe(2026);
            expect(next.getMonth()).toBe(0);
            expect(next.getDate()).toBe(5); // Jan 5, 2026
        });
    });

    describe('monthly', () => {
        it('advances by one month', () => {
            const base = new Date(2025, 2, 15); // Mar 15, 2025
            const next = addInterval(base, 'monthly');
            expect(next.getFullYear()).toBe(2025);
            expect(next.getMonth()).toBe(3); // April
            expect(next.getDate()).toBe(15);
        });

        it('advances across the year boundary', () => {
            const base = new Date(2025, 11, 10); // Dec 10, 2025
            const next = addInterval(base, 'monthly');
            expect(next.getFullYear()).toBe(2026);
            expect(next.getMonth()).toBe(0); // January
            expect(next.getDate()).toBe(10);
        });

        it('rolls over a month-end overflow per JS setMonth semantics', () => {
            // Jan 31 + 1 month: setMonth(1) targets Feb, but day 31 overflows.
            // Feb 2025 has 28 days, so it rolls forward to Mar 3, 2025.
            const base = new Date(2025, 0, 31); // Jan 31, 2025
            const next = addInterval(base, 'monthly');
            expect(next.getFullYear()).toBe(2025);
            expect(next.getMonth()).toBe(2); // March (rolled over)
            expect(next.getDate()).toBe(3);
        });
    });

    describe('yearly', () => {
        it('advances by one year', () => {
            const base = new Date(2025, 5, 20); // Jun 20, 2025
            const next = addInterval(base, 'yearly');
            expect(next.getFullYear()).toBe(2026);
            expect(next.getMonth()).toBe(5);
            expect(next.getDate()).toBe(20);
        });

        it('rolls a leap-day base forward per JS setFullYear semantics', () => {
            // Feb 29, 2024 + 1 year: 2025 is not a leap year, so Feb 29 overflows
            // to Mar 1, 2025.
            const base = new Date(2024, 1, 29); // Feb 29, 2024
            const next = addInterval(base, 'yearly');
            expect(next.getFullYear()).toBe(2025);
            expect(next.getMonth()).toBe(2); // March (rolled over)
            expect(next.getDate()).toBe(1);
        });
    });

    describe('unknown interval', () => {
        it('returns an unchanged copy of the base date', () => {
            const base = new Date(2025, 3, 7, 13, 30, 0); // Apr 7, 2025 13:30 local
            const next = addInterval(base, 'daily');
            expect(next.getTime()).toBe(base.getTime());
        });

        it('still returns a new Date instance, not the same reference', () => {
            const base = new Date(2025, 3, 7);
            const next = addInterval(base, 'bogus');
            expect(next).not.toBe(base);
        });
    });

    describe('immutability', () => {
        it('does not mutate the input Date', () => {
            const base = new Date(2025, 0, 1); // Jan 1, 2025
            const before = base.getTime();
            addInterval(base, 'monthly');
            expect(base.getTime()).toBe(before);
            expect(base.getMonth()).toBe(0);
            expect(base.getDate()).toBe(1);
        });

        it('returns a distinct object reference', () => {
            const base = new Date(2025, 0, 1);
            const next = addInterval(base, 'weekly');
            expect(next).not.toBe(base);
        });
    });
});
