import { describe, it, expect } from 'vitest';
import { toCents, toEuros } from './currency';

describe('currency utilities', () => {
    describe('toCents', () => {
        it('should convert whole euros to cents', () => {
            expect(toCents(10)).toBe(1000);
        });

        it('should convert fractional euros to cents', () => {
            expect(toCents(10.5)).toBe(1050);
            expect(toCents(0.01)).toBe(1);
            expect(toCents(0.99)).toBe(99);
        });

        it('should round sub-cent fractions to the nearest cent', () => {
            expect(toCents(10.005)).toBe(1001); // rounds up (.5 -> up)
            expect(toCents(10.004)).toBe(1000); // rounds down
            expect(toCents(0.014)).toBe(1);
            expect(toCents(0.016)).toBe(2);
        });

        it('should handle zero', () => {
            expect(toCents(0)).toBe(0);
        });

        it('should handle negative euros', () => {
            expect(toCents(-10.5)).toBe(-1050);
            expect(toCents(-0.01)).toBe(-1);
        });
    });

    describe('toEuros', () => {
        it('should convert cents to euros', () => {
            expect(toEuros(1000)).toBe(10);
            expect(toEuros(1050)).toBe(10.5);
            expect(toEuros(1)).toBe(0.01);
        });

        it('should handle zero', () => {
            expect(toEuros(0)).toBe(0);
        });

        it('should handle negative cents', () => {
            expect(toEuros(-1050)).toBe(-10.5);
            expect(toEuros(-1)).toBe(-0.01);
        });
    });

    describe('round-trip', () => {
        it('should round-trip clean cent values through euros and back', () => {
            for (const cents of [0, 1, 99, 100, 1050, 123456, -1, -1050]) {
                expect(toCents(toEuros(cents))).toBe(cents);
            }
        });

        it('should round-trip representative euro inputs', () => {
            for (const euros of [0, 0.01, 10.5, 99.99, -5.25]) {
                expect(toEuros(toCents(euros))).toBeCloseTo(euros, 2);
            }
        });
    });
});
