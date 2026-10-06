import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindMany = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock("@/lib/db", () => ({
    prisma: {
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: {
            findMany: (...a: unknown[]) => mockMembershipFindMany(...a),
            findFirst: async () => ({ groupId: "g1" }),
        },
    },
}));

import { GET, POST } from "./route";

describe("POST /api/couple (deprecated alias)", () => {
    it("400 instead of a 500 on an unparseable body or a non-string name", async () => {
        mockGetSessionCtx.mockReset().mockResolvedValue({ userId: "u1" });
        const badJson = await POST(new Request("http://x", { method: "POST", body: "{" }));
        expect(badJson.status).toBe(400);
        expect(await badJson.json()).toEqual({ error: "Petición no válida" });
        const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: 5 }) }));
        expect(res.status).toBe(400);
        expect((await res.json()).issues[0].path).toBe("name");
    });
});

describe("GET /api/couple", () => {
    beforeEach(() => {
        mockGetSessionCtx.mockReset().mockResolvedValue({ userId: "u1" });
        // Simulate the DB honoring the select: only selected fields come back.
        mockCoupleFindUnique.mockReset().mockImplementation(async ({ select }) => {
            const row: Record<string, unknown> = {
                id: "g1", name: "Casa", code: "ABC123", type: "COUPLE", status: "ACTIVE",
                createdAt: new Date(), archivedAt: null, expiresAt: null, createdById: "u1",
            };
            return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row;
        });
        mockMembershipFindMany.mockReset().mockImplementation(async ({ select }) => {
            const user = { id: "u1", name: "Ana", avatar: "👩", isGuest: false, email: "a@b.c", password: "$2a$hash", pin: "1234" };
            const picked = select?.user?.select
                ? Object.fromEntries(Object.keys(select.user.select).map((k) => [k, user[k as keyof typeof user]]))
                : user;
            return [{ user: picked }];
        });
    });

    it("401 without a session, 403 for a guest", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await GET(new Request("http://x"))).status).toBe(401);
        mockGetSessionCtx.mockResolvedValue({ userId: "g", kind: "guest", groupId: "g1" });
        expect((await GET(new Request("http://x"))).status).toBe(403);
    });

    it("never serializes password hash, pin, email or the legacy Couple.code", async () => {
        const res = await GET(new Request("http://x"));
        const text = await res.text();
        for (const leak of ["$2a$hash", "1234", "a@b.c", "ABC123", "password", "pin", "email", "\"code\""]) {
            expect(text).not.toContain(leak);
        }
        const body = JSON.parse(text);
        expect(body.couple.members).toEqual([{ id: "u1", name: "Ana", avatar: "👩", isGuest: false }]);
        expect(body.couple.name).toBe("Casa");
    });
});
