import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockExpenseFindUnique = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => mockGetSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock("@/lib/db", () => ({
    prisma: {
        expense: {
            findUnique: (...a: unknown[]) => mockExpenseFindUnique(...a),
        },
    },
}));

import { GET } from "./route";

const params = Promise.resolve({ id: "e1" });
function req() {
    return new Request("http://localhost/api/expenses/e1/receipt-lines", {
        method: "GET",
    });
}

const lineItems = [
    { description: "Leche", quantity: 2, unitPrice: 177, lineTotal: 354, position: 0, assignedToId: null },
    { description: "Pan", quantity: 1, unitPrice: 95, lineTotal: 95, position: 1, assignedToId: "u2" },
];

describe("GET /api/expenses/[id]/receipt-lines", () => {
    beforeEach(() => {
        mockGetSessionCtx.mockReset();
        mockRequireSpaceAccess.mockReset();
        mockExpenseFindUnique.mockReset();
    });

    it("returns 401 without a session and does not query the DB", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await GET(req(), { params });
        expect(res.status).toBe(401);
        expect(mockExpenseFindUnique).not.toHaveBeenCalled();
    });

    it("returns 404 when the expense does not exist", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockExpenseFindUnique.mockResolvedValue(null);
        const res = await GET(req(), { params });
        expect(res.status).toBe(404);
    });

    it("returns ordered cents-native items for the personal owner", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockExpenseFindUnique.mockResolvedValue({
            id: "e1",
            visibility: "PERSONAL",
            ownerId: "u1",
            coupleId: null,
            lineItems,
        });
        const res = await GET(req(), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.expenseId).toBe("e1");
        expect(body.items).toHaveLength(2);
        expect(body.items[0]).toEqual({
            description: "Leche",
            quantity: 2,
            unitPriceCents: 177,
            lineTotalCents: 354,
            position: 0,
            assignedToId: null,
        });
        expect(body.items[1]).toEqual({
            description: "Pan",
            quantity: 1,
            unitPriceCents: 95,
            lineTotalCents: 95,
            position: 1,
            assignedToId: "u2",
        });
    });

    it("returns 403 when another user tries to read a personal expense", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u2" });
        mockExpenseFindUnique.mockResolvedValue({
            id: "e1",
            visibility: "PERSONAL",
            ownerId: "u1",
            coupleId: null,
            lineItems,
        });
        const res = await GET(req(), { params });
        expect(res.status).toBe(403);
    });

    it("authorizes a shared expense against the expense coupleId with allowGuest and allowArchived", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u2" });
        mockExpenseFindUnique.mockResolvedValue({
            id: "e1",
            visibility: "SHARED",
            ownerId: "u1",
            coupleId: "c1",
            lineItems,
        });
        mockRequireSpaceAccess.mockResolvedValue({ ok: true, userId: "u2", space: { id: "c1" }, membership: {}, role: "MEMBER", isGuest: false });
        const res = await GET(req(), { params });
        expect(res.status).toBe(200);
        expect(mockRequireSpaceAccess).toHaveBeenCalledWith(
            { userId: "u2" },
            "c1",
            { allowGuest: true, allowArchived: true },
        );
    });

    it("propagates requireSpaceAccess denial for a non-member", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u3" });
        mockExpenseFindUnique.mockResolvedValue({
            id: "e1",
            visibility: "SHARED",
            ownerId: "u1",
            coupleId: "c1",
            lineItems,
        });
        mockRequireSpaceAccess.mockResolvedValue({
            ok: false,
            status: 403,
            error: "No perteneces a este espacio",
        });
        const res = await GET(req(), { params });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("No perteneces a este espacio");
    });

    it("returns 200 with empty items when no receipt lines exist", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockExpenseFindUnique.mockResolvedValue({
            id: "e1",
            visibility: "PERSONAL",
            ownerId: "u1",
            coupleId: null,
            lineItems: [],
        });
        const res = await GET(req(), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.items).toEqual([]);
    });

    it("returns a generic 500 on Prisma failure", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
        mockExpenseFindUnique.mockRejectedValue(new Error("connection lost"));
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const res = await GET(req(), { params });
        consoleError.mockRestore();
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe("Error al obtener el desglose del recibo");
    });
});
