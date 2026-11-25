import { describe, expect, it } from 'vitest';
import {
    checkExpenseDay, isRealCalendarDay, maxExpenseDateISO, nextRecurringRun, parseExpenseDate,
} from './expense-input';

const NOW = new Date('2026-10-06T10:00:00.000Z');

describe('isRealCalendarDay', () => {
    it.each(['2026-02-28', '2024-02-29', '2026-12-31', '2000-01-01'])('accepts %s', (iso) => {
        expect(isRealCalendarDay(iso)).toBe(true);
    });
    it.each(['2026-02-31', '2025-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-1-1', '15/09/2026', ''])('rejects %s', (iso) => {
        expect(isRealCalendarDay(iso)).toBe(false);
    });
});

describe('checkExpenseDay (T-03 range)', () => {
    it('accepts today, the past back to 2000 and up to one year ahead', () => {
        expect(checkExpenseDay('2026-10-06', NOW).ok).toBe(true);
        expect(checkExpenseDay('2000-01-01', NOW).ok).toBe(true);
        expect(checkExpenseDay('2027-10-06', NOW).ok).toBe(true);
        expect(maxExpenseDateISO(NOW)).toBe('2027-10-06');
    });
    it('rejects years before 2000 and beyond today + 1 year, in Spanish', () => {
        const old = checkExpenseDay('1999-12-31', NOW);
        expect(old).toEqual({ ok: false, error: 'La fecha no puede ser anterior al año 2000' });
        const future = checkExpenseDay('2027-10-07', NOW);
        expect(future.ok).toBe(false);
        expect(checkExpenseDay('9999-12-31', NOW).ok).toBe(false);
        expect(checkExpenseDay('0001-01-01', NOW).ok).toBe(false);
    });
});

describe('parseExpenseDate', () => {
    it('absent / null / empty keep the default', () => {
        expect(parseExpenseDate(undefined, NOW)).toEqual({ ok: true, date: undefined });
        expect(parseExpenseDate(null, NOW)).toEqual({ ok: true, date: undefined });
        expect(parseExpenseDate('', NOW)).toEqual({ ok: true, date: undefined });
    });
    it('stores a valid day at 12:00 UTC', () => {
        expect(parseExpenseDate('2026-09-15', NOW)).toEqual({ ok: true, date: new Date('2026-09-15T12:00:00.000Z') });
    });
    it('rejects 31/02 instead of silently rolling over to 3/03 (G-06)', () => {
        const r = parseExpenseDate('2026-02-31', NOW);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/Fecha inválida/);
    });
    it('rejects non-strings', () => {
        expect(parseExpenseDate(20260915, NOW).ok).toBe(false);
    });
});

describe('nextRecurringRun (G-12)', () => {
    it('anchors on the expense date: 15/09 monthly entered on 06/10 → 15/10', () => {
        const next = nextRecurringRun(new Date('2026-09-15T12:00:00.000Z'), 'monthly', NOW);
        expect(next.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    });
    it('a today-dated template runs one period later', () => {
        expect(nextRecurringRun(new Date('2026-10-06T12:00:00.000Z'), 'weekly', NOW).toISOString()).toBe('2026-10-13T12:00:00.000Z');
    });
    it('an old template skips past periods instead of back-filling them', () => {
        const next = nextRecurringRun(new Date('2026-07-15T12:00:00.000Z'), 'monthly', NOW);
        expect(next.toISOString()).toBe('2026-10-15T12:00:00.000Z');
    });
    it('a future-dated template runs one period after its date', () => {
        expect(nextRecurringRun(new Date('2026-11-01T12:00:00.000Z'), 'yearly', NOW).toISOString()).toBe('2027-11-01T12:00:00.000Z');
    });
});
