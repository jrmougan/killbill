import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockMembershipFindFirst = vi.fn();
const mockBudgetFindMany = vi.fn();
const mockBudgetUpsert = vi.fn();
const mockExpenseFindMany = vi.fn();
const mockCategoryFindFirst = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
vi.mock('@/lib/db', () => ({
    prisma: {
        // getPrimaryGroup (real module) resolves the caller's group here.
        membership: { findFirst: (...a: unknown[]) => mockMembershipFindFirst(...a) },
        budget: {
            findMany: (...a: unknown[]) => mockBudgetFindMany(...a),
            upsert: (...a: unknown[]) => mockBudgetUpsert(...a),
        },
        expense: { findMany: (...a: unknown[]) => mockExpenseFindMany(...a) },
        category: { findFirst: (...a: unknown[]) => mockCategoryFindFirst(...a) },
    },
}));

import { GET, POST } from './route';

describe('budget API — personal scope', () => {
    beforeEach(() => {
        [mockGetSession, mockMembershipFindFirst, mockBudgetFindMany, mockBudgetUpsert, mockExpenseFindMany, mockCategoryFindFirst].forEach((m) => m.mockReset());
    });

    it('GET scope=personal filters budgets + spend by ownerId and PERSONAL expenses', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue({ groupId: 'c1' });
        mockBudgetFindMany.mockResolvedValue([]);
        mockExpenseFindMany.mockResolvedValue([]);

        const res = await GET(new Request('http://localhost/api/budget?scope=personal'));
        expect(res.status).toBe(200);

        const budgetWhere = mockBudgetFindMany.mock.calls[0][0].where;
        expect(budgetWhere.ownerId).toBe('u1');
        expect(budgetWhere.coupleId).toBeUndefined();

        const expenseWhere = mockExpenseFindMany.mock.calls[0][0].where;
        expect(expenseWhere.ownerId).toBe('u1');
        expect(expenseWhere.visibility).toBe('PERSONAL');
    });

    it('GET scope=personal works for a user with no couple', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);
        mockBudgetFindMany.mockResolvedValue([]);
        mockExpenseFindMany.mockResolvedValue([]);

        const res = await GET(new Request('http://localhost/api/budget?scope=personal'));
        expect(res.status).toBe(200);
    });

    it('GET scope=shared returns empty for a user with no couple', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);

        const res = await GET(new Request('http://localhost/api/budget?scope=shared'));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.budgets).toEqual([]);
        expect(mockBudgetFindMany).not.toHaveBeenCalled();
    });

    it('POST scope=personal upserts on category_month_ownerId with ownerId set', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);
        mockBudgetUpsert.mockResolvedValue({ id: 'b1' });
        mockCategoryFindFirst.mockResolvedValue({ id: 'cat-health' });

        const res = await POST(new Request('http://localhost/api/budget', {
            method: 'POST',
            body: JSON.stringify({ scope: 'personal', category: 'health', amount: 100 }),
        }));
        expect(res.status).toBe(201);

        const arg = mockBudgetUpsert.mock.calls[0][0];
        expect(arg.where.category_month_ownerId.ownerId).toBe('u1');
        expect(arg.create.ownerId).toBe('u1');
        expect(arg.create.amount).toBe(10000); // 100€ → cents
        expect(arg.create.categoryId).toBe('cat-health'); // Phase 2b dual-write

        // Phase 2e dual-write: half-open [periodStart, periodEnd) derived from month.
        expect(arg.create.periodType).toBe('MONTH');
        expect(arg.create.periodStart).toEqual(arg.create.month);
        expect(arg.create.periodEnd.getTime()).toBeGreaterThan(arg.create.periodStart.getTime());
        expect(arg.create.periodEnd.getDate()).toBe(1); // first day of the next month
    });

    it('POST scope=shared without a couple is rejected (400)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockMembershipFindFirst.mockResolvedValue(null);

        const res = await POST(new Request('http://localhost/api/budget', {
            method: 'POST',
            body: JSON.stringify({ scope: 'shared', category: 'health', amount: 100 }),
        }));
        expect(res.status).toBe(400);
    });
});
