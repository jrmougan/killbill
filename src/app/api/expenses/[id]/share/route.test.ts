import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockGetPrimaryGroup = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserFindMany = vi.fn();
const mockExpenseFindUnique = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockTxExpenseUpdate = vi.fn();
const mockTxSplitDeleteMany = vi.fn();
const mockTxSeriesUpdate = vi.fn();
const mockTransaction = vi.fn();
const mockTxExpenseFindUnique = vi.fn();
const mockLockedStatus = vi.fn();
const mockLockedRoster = vi.fn();
const mockWithSpaceLock = vi.fn();

vi.mock('@/lib/auth', () => ({ getSession: () => mockGetSession() }));
// Members come from the Membership layer; ledger posting is covered by
// reconcile-ledger.ts + ledger tests — both stubbed so this test stays focused
// on the personal->shared promotion + split generation.
vi.mock('@/lib/membership', () => ({
    getGroupMembers: async () => [{ id: 'u1' }, { id: 'u2' }],
    getActiveGroup: (...a: unknown[]) => mockGetPrimaryGroup(...a),
    // space-policy (pulled in via authz) reads this cap at module load.
    MAX_GROUP_MEMBERS: 20,
}));
vi.mock('@/lib/ledger', () => ({ postExpenseLedger: vi.fn() }));
// Emulates the space row lock: the callback gets the tx double and the status
// read under the lock (assertWritableUnderLock / assertRosterUnchanged are real).
vi.mock('@/lib/expense-tx', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/expense-tx')>();
    return {
        ...actual,
        withSpaceLock: (groupId: string, fn: (t: unknown, status: string) => unknown) => {
            mockWithSpaceLock(groupId);
            return mockTransaction((tx: unknown) => fn(tx, mockLockedStatus()));
        },
    };
});
vi.mock('@/lib/db', () => ({
    prisma: {
        user: {
            findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
            findMany: (...a: unknown[]) => mockUserFindMany(...a),
        },
        expense: { findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a) },
        // requireSpaceAccess (real authz module) authorizes against the target group.
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
    },
}));

import { POST } from './route';

const params = Promise.resolve({ id: 'e1' });
function req() {
    return new Request('http://localhost/api/expenses/e1/share', { method: 'POST' });
}
function personal(overrides = {}) {
    return { id: 'e1', visibility: 'PERSONAL', ownerId: 'u1', amount: 5000, receiptData: null, isRecurring: false, recurringInterval: null, ...overrides };
}

describe('POST /api/expenses/[id]/share', () => {
    beforeEach(() => {
        [mockGetSession, mockGetPrimaryGroup, mockUserFindUnique, mockUserFindMany, mockExpenseFindUnique, mockCoupleFindUnique, mockMembershipFindUnique, mockTxExpenseUpdate, mockTxSplitDeleteMany, mockTxSeriesUpdate, mockTransaction, mockTxExpenseFindUnique, mockLockedStatus, mockLockedRoster, mockWithSpaceLock].forEach((m) => m.mockReset());
        mockLockedStatus.mockReturnValue('ACTIVE');
        mockLockedRoster.mockReturnValue(['u1', 'u2']);
        mockTxExpenseFindUnique.mockResolvedValue({ visibility: 'PERSONAL' });
        // requireSpaceAccess: every space is ACTIVE and the caller is an ACTIVE member.
        mockCoupleFindUnique.mockImplementation(async ({ where: { id } }: { where: { id: string } }) => ({ id, status: 'ACTIVE' }));
        mockMembershipFindUnique.mockImplementation(async ({ where: { groupId_userId } }: { where: { groupId_userId: { groupId: string; userId: string } } }) => ({ groupId: groupId_userId.groupId, userId: groupId_userId.userId, role: 'MEMBER', status: 'ACTIVE' }));
        // Run the transaction callback against a tx double. recurringSeries.update is
        // exercised when the shared source is the recurring TEMPLATE (Phase 5).
        mockTransaction.mockImplementation(async (cb) => cb({
            split: { deleteMany: (...a: unknown[]) => mockTxSplitDeleteMany(...a) },
            expense: {
                update: (...a: unknown[]) => mockTxExpenseUpdate(...a),
                findUnique: (...a: unknown[]) => mockTxExpenseFindUnique(...a),
            },
            membership: { findMany: async () => (mockLockedRoster() as string[]).map((userId) => ({ userId })) },
            recurringSeries: { update: (...a: unknown[]) => mockTxSeriesUpdate(...a) },
        }));
        mockTxExpenseUpdate.mockResolvedValue({});
        mockTxSplitDeleteMany.mockResolvedValue({});
        mockTxSeriesUpdate.mockResolvedValue({});
    });

    it('401 without a session', async () => {
        mockGetSession.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(401);
    });

    it('400 when the caller has no couple', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(400);
    });

    it('shares into an explicit targetGroupId; 400 for a malformed body', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockExpenseFindUnique.mockResolvedValue(personal({ lineItems: [], series: null }));
        const body = (b: string) => new Request('http://localhost/api/expenses/e1/share', { method: 'POST', body: b });

        expect((await POST(body(JSON.stringify({ targetGroupId: 'g2' })), { params })).status).toBe(200);
        expect(mockWithSpaceLock).toHaveBeenCalledWith('g2');
        expect(mockGetPrimaryGroup).not.toHaveBeenCalled();

        const wrongType = await POST(body(JSON.stringify({ targetGroupId: 7 })), { params });
        expect(wrongType.status).toBe(400);
        expect((await wrongType.json()).error).toBe('Espacio no válido');
        const invalid = await POST(body('{nope'), { params });
        expect(await invalid.json()).toEqual({ error: 'Petición no válida' });
    });

    it('403 for a guest session (guests have no personal expenses to share)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'g1', kind: 'guest', groupId: 'trip' });
        mockMembershipFindUnique.mockResolvedValue({ role: 'GUEST', status: 'ACTIVE', group: { status: 'ACTIVE' } });
        const res = await POST(req(), { params });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Acción no permitida para invitados' });
    });

    it('404 when the expense does not exist', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(null);
        expect((await POST(req(), { params })).status).toBe(404);
    });

    it('403 when the caller is not the owner', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u2' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal({ ownerId: 'u1' }));
        expect((await POST(req(), { params })).status).toBe(403);
    });

    it('409 when the expense is already shared', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal({ visibility: 'SHARED' }));
        expect((await POST(req(), { params })).status).toBe(409);
    });

    it('promotes to SHARED with couple + generated splits', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        mockExpenseFindUnique.mockResolvedValue(personal());
        mockUserFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        const res = await POST(req(), { params });
        expect(res.status).toBe(200);
        expect(mockTxExpenseUpdate).toHaveBeenCalledOnce();
        const arg = mockTxExpenseUpdate.mock.calls[0][0];
        expect(arg.data.visibility).toBe('SHARED');
        expect(arg.data.coupleId).toBe('c1');
        // 5000 split 50/50 between two members
        const created = arg.data.splits.create;
        expect(created).toHaveLength(2);
        expect(created.reduce((s: number, x: { amount: number }) => s + x.amount, 0)).toBe(5000);
    });

    it('flips the series to SHARED with a future nextRunDate when the source is the recurring TEMPLATE', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        // Phase 5: recurrence lives on the series; the expense is the TEMPLATE iff
        // series.templateId === its id ('e1'). No Expense recurrence columns.
        mockExpenseFindUnique.mockResolvedValue(personal({
            seriesId: 's1',
            series: { id: 's1', templateId: 'e1', interval: 'monthly', isActive: true },
        }));
        mockUserFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        await POST(req(), { params });

        // The expense.update no longer writes the retired nextRecurringDate column.
        const expenseArg = mockTxExpenseUpdate.mock.calls[0][0];
        expect(expenseArg.data.nextRecurringDate).toBeUndefined();

        // The series flips scope and resets nextRunDate to the future.
        expect(mockTxSeriesUpdate).toHaveBeenCalledOnce();
        const seriesArg = mockTxSeriesUpdate.mock.calls[0][0];
        expect(seriesArg.where).toEqual({ id: 's1' });
        expect(seriesArg.data.visibility).toBe('SHARED');
        expect(seriesArg.data.coupleId).toBe('c1');
        expect(seriesArg.data.nextRunDate).toBeInstanceOf(Date);
        expect(seriesArg.data.nextRunDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('does NOT flip the series when sharing a materialized INSTANCE (not the template)', async () => {
        mockGetSession.mockResolvedValue({ userId: 'u1' });
        mockGetPrimaryGroup.mockResolvedValue('c1');
        // Instance: seriesId set but series.templateId points at a DIFFERENT expense.
        mockExpenseFindUnique.mockResolvedValue(personal({
            seriesId: 's1',
            series: { id: 's1', templateId: 'tpl-other', interval: 'monthly', isActive: true },
        }));
        mockUserFindMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

        expect((await POST(req(), { params })).status).toBe(200);
        expect(mockTxSeriesUpdate).not.toHaveBeenCalled();
    });

    describe('under the target space lock', () => {
        beforeEach(() => {
            mockGetSession.mockResolvedValue({ userId: 'u1' });
            mockGetPrimaryGroup.mockResolvedValue('c1');
            mockExpenseFindUnique.mockResolvedValue(personal());
        });

        it('takes the lock of the TARGET space', async () => {
            expect((await POST(req(), { params })).status).toBe(200);
            expect(mockWithSpaceLock).toHaveBeenCalledWith('c1');
        });

        it('409 SPACE_NOT_WRITABLE when the space went SETTLING before the lock', async () => {
            mockLockedStatus.mockReturnValue('SETTLING');
            const res = await POST(req(), { params });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe('SPACE_NOT_WRITABLE');
            expect(mockTxExpenseUpdate).not.toHaveBeenCalled();
        });

        it('409 MEMBERS_CHANGED when the roster changed after the splits were computed', async () => {
            mockLockedRoster.mockReturnValue(['u1', 'u2', 'u3']);
            const res = await POST(req(), { params });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe('MEMBERS_CHANGED');
            expect(mockTxExpenseUpdate).not.toHaveBeenCalled();
        });

        it('409 ALREADY_SHARED when a concurrent share won the lock (no double ledger post)', async () => {
            mockTxExpenseFindUnique.mockResolvedValue({ visibility: 'SHARED' });
            const res = await POST(req(), { params });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe('ALREADY_SHARED');
            expect(mockTxSplitDeleteMany).not.toHaveBeenCalled();
            expect(mockTxExpenseUpdate).not.toHaveBeenCalled();
        });
    });
});
