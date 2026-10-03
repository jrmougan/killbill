import { describe, expect, it } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { postExpenseLedger, postSettlementLedger } from './ledger';

// A stateful persistence double implements unique-key upsert and entry deletion.
// Assertions inspect persisted money, rather than reproducing ledger arithmetic
// or coupling the test to a particular sequence of mock calls.
function ledgerStore() {
    type Transaction = { id: string; dedupeKey: string; amount: number };
    type Account = { id: string; groupId: string; userId: string };
    type Entry = { transactionId: string; accountId: string; amount: number };
    const transactions = new Map<string, Transaction>();
    const accounts = new Map<string, Account>();
    let entries: Entry[] = [];
    const tx = {
        ledgerTransaction: {
            async upsert(args: { where: { dedupeKey: string }; create: Omit<Transaction, 'id'>; update: { amount: number } }) {
                const previous = transactions.get(args.where.dedupeKey);
                const transaction = previous
                    ? { ...previous, ...args.update }
                    : { id: `txn-${transactions.size}`, ...args.create };
                transactions.set(args.where.dedupeKey, transaction);
                return transaction;
            },
        },
        account: {
            async upsert(args: { create: Omit<Account, 'id'> }) {
                const key = `${args.create.groupId}:${args.create.userId}`;
                const account = accounts.get(key) ?? { id: `account-${accounts.size}`, ...args.create };
                accounts.set(key, account);
                return account;
            },
        },
        ledgerEntry: {
            async deleteMany(args: { where: { transactionId: string } }) {
                entries = entries.filter(entry => entry.transactionId !== args.where.transactionId);
            },
            async create(args: { data: Entry }) {
                entries.push({ ...args.data });
            },
        },
    };
    return {
        tx: tx as unknown as Prisma.TransactionClient,
        transactions,
        balances() {
            return Object.fromEntries([...accounts.values()].map(account => [account.userId,
                entries.filter(entry => entry.accountId === account.id).reduce((total, entry) => total + entry.amount, 0),
            ]));
        },
        entries: () => entries,
    };
}

const expense = {
    expenseId: 'meal', groupId: 'group', amount: 10003, paidById: 'a',
    occurredAt: new Date('2026-10-01T12:00:00Z'),
    splits: [{ userId: 'a', amount: 3335 }, { userId: 'b', amount: 3334 }, { userId: 'c', amount: 3334 }],
    members: ['a', 'b', 'c'].map(id => ({ id })),
};

describe('persisted ledger money after repeated operations', () => {
    it('reposting and editing an expense replaces its money instead of accumulating it', async () => {
        const store = ledgerStore();
        for (let attempt = 0; attempt < 3; attempt++) await postExpenseLedger(store.tx, expense);
        expect(store.transactions.size).toBe(1);
        expect(store.entries()).toHaveLength(3);
        expect(store.balances()).toEqual({ a: 6668, b: -3334, c: -3334 });

        const edited = { ...expense, amount: 9000, paidById: 'b', splits: [
            { userId: 'a', amount: 1000 }, { userId: 'b', amount: 3000 }, { userId: 'c', amount: 5000 },
        ] };
        await postExpenseLedger(store.tx, edited);
        await postExpenseLedger(store.tx, edited);
        expect(store.transactions.size).toBe(1);
        expect(store.transactions.get('expense:meal')?.amount).toBe(9000);
        expect(store.entries()).toHaveLength(3);
        expect(store.balances()).toEqual({ a: -1000, b: 6000, c: -5000 });
        expect(store.entries().reduce((total, entry) => total + entry.amount, 0)).toBe(0);
    });

    it('reconfirming partial payments posts each settlement only once and preserves the expense', async () => {
        const store = ledgerStore();
        await postExpenseLedger(store.tx, expense);
        const settlement = {
            id: 'partial', coupleId: 'group', amount: 1000,
            fromUserId: 'b', toUserId: 'a', date: expense.occurredAt,
        };
        for (let attempt = 0; attempt < 3; attempt++) await postSettlementLedger(store.tx, settlement);
        expect(store.transactions.size).toBe(2);
        expect(store.entries()).toHaveLength(5);
        expect(store.balances()).toEqual({ a: 5668, b: -2334, c: -3334 });

        for (const payment of [
            { ...settlement, id: 'remaining-b', amount: 2334 },
            { ...settlement, id: 'remaining-c', fromUserId: 'c', amount: 3334 },
        ]) {
            await postSettlementLedger(store.tx, payment);
            await postSettlementLedger(store.tx, payment);
        }
        // Rebuilding the original expense must not erase or double its payments.
        await postExpenseLedger(store.tx, expense);
        expect(store.transactions.size).toBe(4);
        expect(store.balances()).toEqual({ a: 0, b: 0, c: 0 });
        for (const transaction of store.transactions.values()) {
            expect(store.entries().filter(entry => entry.transactionId === transaction.id)
                .reduce((total, entry) => total + entry.amount, 0)).toBe(0);
        }
    });

    it('rejects an unbalanced expense before persisting money and skips no-op settlements', async () => {
        const store = ledgerStore();
        await expect(postExpenseLedger(store.tx, { ...expense, splits: [{ userId: 'b', amount: 10002 }] }))
            .rejects.toThrow('non-zero-sum');
        const settlement = {
            id: 'noop', coupleId: 'group', amount: 0,
            fromUserId: 'a', toUserId: 'b', date: expense.occurredAt,
        };
        await postSettlementLedger(store.tx, settlement);
        await postSettlementLedger(store.tx, { ...settlement, amount: 1000, toUserId: 'a' });
        expect(store.transactions.size).toBe(0);
        expect(store.entries()).toEqual([]);
        expect(store.balances()).toEqual({});
    });
});
