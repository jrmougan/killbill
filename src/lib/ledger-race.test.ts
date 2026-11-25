import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';

vi.mock('@/lib/db', () => ({ prisma: {} }));

import { ensureAccount } from './ledger';
import { isRetryableTxError, withTxRetry } from './expense-tx';

const unique = () => Object.assign(new Error('Unique constraint failed on Account_groupId_userId_key'), { code: 'P2002' });
const conflict = () => Object.assign(
    new Error('Transaction failed due to a write conflict or a deadlock. Please retry your transaction'),
    { code: 'P2034' },
);

describe('ensureAccount — race-safe get-or-create (G-04)', () => {
    it('returns the existing account without writing (hot path)', async () => {
        const create = vi.fn();
        const tx = { account: { findUnique: vi.fn().mockResolvedValue({ id: 'acc-1' }), create } };
        await expect(ensureAccount(tx as unknown as Prisma.TransactionClient, 'g', 'u')).resolves.toBe('acc-1');
        expect(create).not.toHaveBeenCalled();
    });

    it('creates the account when missing', async () => {
        const tx = { account: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'new' }) } };
        await expect(ensureAccount(tx as unknown as Prisma.TransactionClient, 'g', 'u')).resolves.toBe('new');
    });

    it('a concurrent creator winning the insert is resolved by re-reading', async () => {
        // First read: missing. Insert: duplicate key (the other request committed
        // it in between). Second read: the other request's row.
        const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'theirs' });
        const tx = { account: { findUnique, create: vi.fn().mockRejectedValue(unique()) } };
        await expect(ensureAccount(tx as unknown as Prisma.TransactionClient, 'g', 'u')).resolves.toBe('theirs');
        expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it('rethrows a non-unique error', async () => {
        const tx = { account: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(new Error('boom')) } };
        await expect(ensureAccount(tx as unknown as Prisma.TransactionClient, 'g', 'u')).rejects.toThrow('boom');
    });

    it('simulated concurrent posts against one store all get the same account', async () => {
        const rows = new Map<string, { id: string }>();
        let n = 0;
        const tx = {
            account: {
                // Every caller reads "missing" before anyone inserts (worst-case interleaving).
                findUnique: vi.fn(async ({ where }: { where: { groupId_userId: { groupId: string; userId: string } } }) => {
                    await Promise.resolve();
                    return rows.get(`${where.groupId_userId.groupId}:${where.groupId_userId.userId}`) ?? null;
                }),
                create: vi.fn(async ({ data }: { data: { groupId: string; userId: string } }) => {
                    const key = `${data.groupId}:${data.userId}`;
                    if (rows.has(key)) throw unique();
                    const row = { id: `acc-${++n}` };
                    rows.set(key, row);
                    return row;
                }),
            },
        } as unknown as Prisma.TransactionClient;
        const ids = await Promise.all(Array.from({ length: 5 }, () => ensureAccount(tx, 'g', 'u')));
        expect(new Set(ids)).toEqual(new Set(['acc-1']));
        expect(rows.size).toBe(1);
    });
});

describe('withTxRetry — bounded retry on write conflicts', () => {
    it('classifies P2034 / deadlock messages as retryable, others not', () => {
        expect(isRetryableTxError(conflict())).toBe(true);
        expect(isRetryableTxError(new Error('Deadlock found when trying to get lock'))).toBe(true);
        expect(isRetryableTxError(unique())).toBe(false);
        expect(isRetryableTxError(new Error('Invalid category'))).toBe(false);
        expect(isRetryableTxError(null)).toBe(false);
    });

    it('retries a conflicting transaction until it succeeds', async () => {
        const fn = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict()).mockResolvedValue('ok');
        await expect(withTxRetry(fn, { backoffMs: 0 })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('gives up after the attempt budget and surfaces the error', async () => {
        const fn = vi.fn().mockRejectedValue(conflict());
        await expect(withTxRetry(fn, { attempts: 3, backoffMs: 0 })).rejects.toMatchObject({ code: 'P2034' });
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry a non-retryable error', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('validation'));
        await expect(withTxRetry(fn, { backoffMs: 0 })).rejects.toThrow('validation');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
