import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prisma, models } = vi.hoisted(() => {
    const models = [
        'split', 'expense', 'settlement', 'budget', 'shoppingListItem',
        'shoppingList', 'groupInvite', 'membership', 'expenseTag', 'tag',
        'account', 'ledgerTransaction', 'ledgerEntry', 'recurringSeries',
        'receiptLineItem', 'category', 'inviteCode', 'user', 'couple',
    ];
    return {
        models,
        prisma: {
            ...Object.fromEntries(models.map(model => [model, {
                deleteMany: vi.fn(() => ({ model })),
            }])),
            $transaction: vi.fn(),
        } as Record<string, { deleteMany: ReturnType<typeof vi.fn> }> & {
            $transaction: ReturnType<typeof vi.fn>;
        },
    };
});

vi.mock('@/lib/db', () => ({ prisma }));

import { POST as seedPOST } from './seed/route';
import { POST as resetPOST } from './reset/route';

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('test-only routes are gated by TEST_ROUTES_ENABLED', () => {
    it('POST /api/test/seed returns 404 when the flag is unset', async () => {
        vi.stubEnv('TEST_ROUTES_ENABLED', undefined);
        const res = await seedPOST(new Request('http://localhost/api/test/seed', { method: 'POST' }));
        expect(res.status).toBe(404);
    });

    it.each([undefined, '', 'false', 'TRUE'])('POST /api/test/reset returns 404 for flag %s', async (flag) => {
        vi.stubEnv('TEST_ROUTES_ENABLED', flag);
        const res = await resetPOST();
        expect(res.status).toBe(404);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        for (const model of models) {
            expect(prisma[model].deleteMany).not.toHaveBeenCalled();
        }
    });
});

describe('test database reset', () => {
    beforeEach(() => {
        vi.stubEnv('TEST_ROUTES_ENABLED', 'true');
    });

    it('deletes every scenario table in one transaction, preserving system categories', async () => {
        const res = await resetPOST();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const operations = prisma.$transaction.mock.calls[0][0] as { model: string }[];
        const order = operations.map(operation => operation.model);
        expect([...order].sort()).toEqual([...models].sort());
        for (const model of models) {
            expect(prisma[model].deleteMany).toHaveBeenCalledTimes(1);
        }
        expect(prisma.category.deleteMany).toHaveBeenCalledWith({ where: { isSystem: false } });
        expect(prisma.user.deleteMany).toHaveBeenCalledWith();

        // Dependency constraints, without coupling the test to one exact order.
        const dependencies = [
            ['ledgerEntry', 'ledgerTransaction'], ['ledgerEntry', 'account'],
            ['ledgerTransaction', 'expense'], ['ledgerTransaction', 'settlement'],
            ['split', 'expense'], ['expenseTag', 'expense'], ['expenseTag', 'tag'],
            ['receiptLineItem', 'expense'], ['expense', 'settlement'],
            ['expense', 'category'], ['recurringSeries', 'category'], ['budget', 'category'],
            ['shoppingListItem', 'shoppingList'],
            ...['account', 'expense', 'settlement', 'groupInvite', 'inviteCode',
                'recurringSeries', 'membership', 'shoppingList', 'tag', 'budget', 'category']
                .flatMap(model => [[model, 'user'], [model, 'couple']]),
        ];
        for (const [child, parent] of dependencies) {
            expect(order.indexOf(child), `${child} before ${parent}`).toBeLessThan(order.indexOf(parent));
        }
    });

    it('reports transaction failures instead of claiming success', async () => {
        prisma.$transaction.mockRejectedValueOnce(new Error('delete failed'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const res = await resetPOST();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Error: delete failed' });
    });
});
