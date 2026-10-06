import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockCoupleUpdate = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockSettlementCount = vi.fn();
const mockGetGroupBalances = vi.fn();
/** Status the space has once the row lock is taken (null = same as outside). */
const mockLockedStatus = vi.fn((): string | null => null);

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/ledger-read", () => ({ getGroupBalances: (...a: unknown[]) => mockGetGroupBalances(...a) }));
vi.mock("@/lib/db", () => {
    const couple = {
        findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a),
        findUniqueOrThrow: (...a: unknown[]) => mockCoupleFindUnique(...a),
        update: (...a: unknown[]) => mockCoupleUpdate(...a),
    };
    const settlement = { count: (...a: unknown[]) => mockSettlementCount(...a) };
    // withSpaceLock: `SELECT status … FOR UPDATE` returns the status UNDER the lock.
    const $queryRaw = async () => {
        const row = (await mockCoupleFindUnique()) as { status: string } | null;
        return row ? [{ status: mockLockedStatus() ?? row.status }] : [];
    };
    return {
        prisma: {
            couple,
            membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
            settlement,
            $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ couple, settlement, $queryRaw }),
        },
    };
});

import { PATCH } from "./route";

const params = Promise.resolve({ id: "g1" });

function patch(body: unknown) {
    return PATCH(new Request("http://localhost/api/spaces/g1", { method: "PATCH", body: JSON.stringify(body) }), { params });
}

function space(status: string, type = "COUPLE") {
    mockCoupleFindUnique.mockResolvedValue({ id: "g1", type, status });
}

describe("PATCH /api/spaces/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: "a" });
        mockMembershipFindUnique.mockResolvedValue({ groupId: "g1", userId: "a", role: "OWNER", status: "ACTIVE" });
        mockCoupleUpdate.mockImplementation(async ({ data }: { data: object }) => ({ id: "g1", ...data }));
        mockGetGroupBalances.mockResolvedValue({ a: 0, b: 0 });
        mockSettlementCount.mockResolvedValue(0);
        mockLockedStatus.mockReturnValue(null);
        space("ACTIVE");
    });

    describe("status re-checked under the space lock (A3)", () => {
        it("a rename seen ACTIVE outside but ARCHIVED under the lock is refused", async () => {
            mockLockedStatus.mockReturnValue("ARCHIVED");
            const res = await patch({ name: "Nuevo" });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe("SPACE_NOT_WRITABLE");
            expect(mockCoupleUpdate).not.toHaveBeenCalled();
        });

        it("the transition is validated against the LOCKED status (two concurrent closes)", async () => {
            // Request saw ACTIVE; another close already moved it to SETTLING.
            mockLockedStatus.mockReturnValue("SETTLING");
            const res = await patch({ status: "SETTLING" });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe("INVALID_TRANSITION");
            expect(mockCoupleUpdate).not.toHaveBeenCalled();
        });

        it("the archive guard reads balances and pending payments through the locked transaction", async () => {
            const res = await patch({ status: "ARCHIVED" });
            expect(res.status).toBe(200);
            expect(mockGetGroupBalances).toHaveBeenCalledWith("g1", expect.objectContaining({ $queryRaw: expect.any(Function) }));
        });
    });

    describe("archive guard", () => {
        it("409 OPEN_BALANCES with the settle link when someone still owes", async () => {
            mockGetGroupBalances.mockResolvedValue({ a: 5000, b: -5000 });
            const res = await patch({ status: "ARCHIVED" });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.code).toBe("OPEN_BALANCES");
            expect(body.settleUrl).toBe("/settle?space=g1");
            expect(body.error).toMatch(/deudas/);
            expect(mockCoupleUpdate).not.toHaveBeenCalled();
        });

        it("409 PENDING_SETTLEMENTS while a payment awaits confirmation (from SETTLING too)", async () => {
            space("SETTLING");
            mockSettlementCount.mockResolvedValue(1);
            const res = await patch({ status: "ARCHIVED" });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe("PENDING_SETTLEMENTS");
        });

        it("archives when everyone is at peace (±1 cent tolerated)", async () => {
            mockGetGroupBalances.mockResolvedValue({ a: 1, b: -1 });
            const res = await patch({ status: "ARCHIVED" });
            expect(res.status).toBe(200);
            expect(mockCoupleUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "ARCHIVED" }) }),
            );
        });

        it("SETTLING → ACTIVE does not check balances", async () => {
            space("SETTLING");
            mockGetGroupBalances.mockResolvedValue({ a: 5000, b: -5000 });
            expect((await patch({ status: "ACTIVE" })).status).toBe(200);
        });
    });

    describe("archived is read-only", () => {
        it("no COUPLE → GROUP upgrade", async () => {
            space("ARCHIVED");
            const res = await patch({ type: "GROUP" });
            expect(res.status).toBe(409);
            expect((await res.json()).code).toBe("SPACE_NOT_WRITABLE");
        });

        it("no rename", async () => {
            space("ARCHIVED");
            expect((await patch({ name: "Nuevo" })).status).toBe(409);
        });
    });

    describe("rename", () => {
        it("trims and saves a valid name", async () => {
            const res = await patch({ name: "  Piso   Lavapiés  " });
            expect(res.status).toBe(200);
            expect(mockCoupleUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "Piso Lavapiés" } }));
        });

        it.each([[""], ["   "], ["x".repeat(61)], [42]])("400 INVALID_NAME for %j", async (name) => {
            const res = await patch({ name });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe("INVALID_NAME");
        });

        it("a MEMBER cannot rename", async () => {
            mockMembershipFindUnique.mockResolvedValue({ groupId: "g1", userId: "a", role: "MEMBER", status: "ACTIVE" });
            expect((await patch({ name: "Nuevo" })).status).toBe(403);
        });

        it("an ADMIN can rename", async () => {
            mockMembershipFindUnique.mockResolvedValue({ groupId: "g1", userId: "a", role: "ADMIN", status: "ACTIVE" });
            expect((await patch({ name: "Nuevo" })).status).toBe(200);
        });
    });
});
