import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetSession = vi.fn();
const mockCoupleCreate = vi.fn();
const mockMembershipCreate = vi.fn();
const mockCookieSet = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mockCookieSet, get: () => undefined }) }));
vi.mock("@/lib/db", () => {
    const tx = {
        couple: { create: (...a: unknown[]) => mockCoupleCreate(...a) },
        membership: {
            create: (...a: unknown[]) => mockMembershipCreate(...a),
            // getSessionCtx revalidates guest sessions live.
            findUnique: async () => ({ role: "GUEST", status: "ACTIVE", group: { status: "ACTIVE" } }),
        },
    };
    return { prisma: { ...tx, $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
});

import { POST } from "./route";

function post(body: unknown) {
    return POST(new Request("http://localhost/api/spaces", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/spaces", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
        mockGetSession.mockResolvedValue({ userId: "u1" });
        mockCoupleCreate.mockImplementation(async ({ data }: { data: object }) => ({ id: "s1", ...data }));
    });
    afterEach(() => vi.useRealTimers());

    it("403 for a guest session (caged to its trip)", async () => {
        mockGetSession.mockResolvedValue({ userId: "g", kind: "guest", groupId: "trip" });
        const res = await post({ type: "GROUP", name: "Escapado" });
        expect(res.status).toBe(403);
        expect(mockCoupleCreate).not.toHaveBeenCalled();
    });

    it("stores a trip end date as the END of that day in Madrid, not UTC midnight", async () => {
        const res = await post({ type: "EPHEMERAL", name: "Lisboa", expiresAt: "2026-10-10" });
        expect(res.status).toBe(200);
        const data = mockCoupleCreate.mock.calls[0][0].data;
        // 23:59:59.999 CEST (UTC+2) on the 10th.
        expect(data.expiresAt.toISOString()).toBe("2026-10-10T21:59:59.999Z");
    });

    it("accepts today as the last day", async () => {
        expect((await post({ type: "EPHEMERAL", expiresAt: "2026-10-06" })).status).toBe(200);
    });

    it("400 for a past end date", async () => {
        const res = await post({ type: "EPHEMERAL", expiresAt: "2026-10-01" });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("INVALID_END_DATE");
        expect(mockCoupleCreate).not.toHaveBeenCalled();
    });

    it("400 for an impossible date", async () => {
        expect((await post({ type: "EPHEMERAL", expiresAt: "2026-02-31" })).status).toBe(400);
    });

    it("never mints a guessable short code", async () => {
        await post({ type: "COUPLE" });
        const { code, name } = mockCoupleCreate.mock.calls[0][0].data;
        expect(code).toMatch(/^[0-9A-F]{32}$/);
        expect(name).toBe("Mi pareja");
    });

    it("400 for a name over 60 characters", async () => {
        expect((await post({ type: "GROUP", name: "x".repeat(61) })).status).toBe(400);
    });
});

describe("POST /api/spaces — body validation (route() kit)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: "u1" });
    });

    function raw(body: string) {
        return POST(new Request("http://localhost/api/spaces", { method: "POST", body }));
    }

    it.each([["{oops"], [""], ["null"], ["[]"]])("400 'Cuerpo inválido' for the body %j", async (body) => {
        const res = await raw(body);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("Cuerpo inválido");
        expect(mockCoupleCreate).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ type: "INDIVIDUAL" }], [{ type: 3 }]])("400 with the historical message for %j", async (body) => {
        const res = await post(body);
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("type es obligatorio y debe ser COUPLE, GROUP o EPHEMERAL");
        expect(json.issues[0].path).toBe("type");
        expect(mockCoupleCreate).not.toHaveBeenCalled();
    });

    it("401 'Unauthorized' without a session", async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await post({ type: "GROUP" });
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe("Unauthorized");
    });
});
