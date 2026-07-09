import { describe, it, expect } from 'vitest';
import { parseDateISO, parseSignedCents, normalizeRow, type ColumnMapping } from './bank-csv';

describe('parseDateISO', () => {
    it('parses DMY with / or - or .', () => {
        expect(parseDateISO('09/07/2026', 'DMY')).toBe('2026-07-09');
        expect(parseDateISO('9-7-2026', 'DMY')).toBe('2026-07-09');
        expect(parseDateISO('09.07.2026', 'DMY')).toBe('2026-07-09');
    });
    it('parses YMD and MDY', () => {
        expect(parseDateISO('2026-07-09', 'YMD')).toBe('2026-07-09');
        expect(parseDateISO('07/09/2026', 'MDY')).toBe('2026-07-09');
    });
    it('expands 2-digit years', () => {
        expect(parseDateISO('09/07/26', 'DMY')).toBe('2026-07-09');
    });
    it('rejects invalid', () => {
        expect(parseDateISO('nope', 'DMY')).toBeNull();
        expect(parseDateISO('32/13/2026', 'DMY')).toBeNull();
        expect(parseDateISO('09/07', 'DMY')).toBeNull();
    });
});

describe('parseSignedCents', () => {
    it('parses comma-decimal with thousands dot', () => {
        expect(parseSignedCents('-1.234,56', ',')).toBe(-123456);
        expect(parseSignedCents('12,00', ',')).toBe(1200);
    });
    it('parses dot-decimal with thousands comma', () => {
        expect(parseSignedCents('-1,234.56', '.')).toBe(-123456);
        expect(parseSignedCents('12.00', '.')).toBe(1200);
    });
    it('handles a trailing/embedded minus and parentheses', () => {
        expect(parseSignedCents('50,00-', ',')).toBe(-5000);
        expect(parseSignedCents('(50,00)', ',')).toBe(-5000);
    });
    it('strips currency symbols/spaces', () => {
        expect(parseSignedCents('  -12,50 €', ',')).toBe(-1250);
    });
    it('rejects non-numbers', () => {
        expect(parseSignedCents('abc', ',')).toBeNull();
        expect(parseSignedCents('', ',')).toBeNull();
    });
});

describe('normalizeRow', () => {
    const mapping: ColumnMapping = {
        dateCol: 'Fecha', amountCol: 'Importe', descriptionCol: 'Concepto',
        dateFormat: 'DMY', decimalSep: ',', expenseSign: 'negative',
    };

    it('normalizes an outflow as an expense (positive magnitude)', () => {
        const r = normalizeRow({ Fecha: '09/07/2026', Importe: '-24,92', Concepto: 'Kiwoko' }, mapping);
        expect(r).toEqual({ dateISO: '2026-07-09', amountCents: 2492, description: 'Kiwoko', isExpense: true });
    });
    it('flags an inflow as not-an-expense (skipped by the UI)', () => {
        const r = normalizeRow({ Fecha: '09/07/2026', Importe: '1.000,00', Concepto: 'Nómina' }, mapping);
        expect(r.isExpense).toBe(false);
        expect(r.amountCents).toBe(100000);
    });
    it('respects expenseSign=positive', () => {
        const r = normalizeRow({ Fecha: '09/07/2026', Importe: '24,92', Concepto: 'x' }, { ...mapping, expenseSign: 'positive' });
        expect(r.isExpense).toBe(true);
    });
    it('reports parse errors instead of importing', () => {
        expect(normalizeRow({ Fecha: 'bad', Importe: '-1,00', Concepto: 'x' }, mapping).error).toMatch(/Fecha/);
        expect(normalizeRow({ Fecha: '09/07/2026', Importe: 'bad', Concepto: 'x' }, mapping).error).toMatch(/Importe/);
        expect(normalizeRow({ Fecha: '09/07/2026', Importe: '-1,00', Concepto: '' }, mapping).error).toMatch(/Concepto/);
    });
});
