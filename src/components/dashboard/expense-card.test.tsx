import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpenseCard } from './expense-card';

// The same instant belongs to February in Madrid and January in UTC.
const expense = {
    id: 'midnight', description: 'Compra nocturna', amount: 20,
    paidBy: 'payer', date: '2026-01-31T23:30:00.000Z', category: 'food', splits: [],
};
const payer = { id: 'payer', name: 'Ana' };

afterEach(() => vi.unstubAllEnvs());

describe('expense card date across server time zones', () => {
    it('renders the Madrid calendar day identically in UTC and Madrid', () => {
        vi.stubEnv('TZ', 'UTC');
        const utc = renderToStaticMarkup(<ExpenseCard expense={expense} paidByUser={payer} />);
        vi.stubEnv('TZ', 'Europe/Madrid');
        const madrid = renderToStaticMarkup(<ExpenseCard expense={expense} paidByUser={payer} />);
        expect(utc).toContain('1 feb');
        expect(madrid).toBe(utc);
    });
});
