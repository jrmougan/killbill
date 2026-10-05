import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockCoupleUpdate = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockSettlementCount = vi.fn();
const mockGetGroupBalances = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/ledger-read", () => ({ getGroupBalances: (...a: unknown[]) => mockGetGroupBalances(...a) }));
vi.mock("@/lib/db", () => ({
    prisma: {
        couple: {
            findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a),
            update: (...a: unknown[]) => mockCoupleUpdate(...a),
        },
        membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
        settlement: { count: (...a: unknown[]) => mockSettlementCount(...a) },
    },
}));

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
        space("ACTIVE");
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
