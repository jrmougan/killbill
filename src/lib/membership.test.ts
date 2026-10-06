import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/db", () => ({
    prisma: { membership: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

import { getGroupMembers, PUBLIC_MEMBER_SELECT } from "./membership";

describe("getGroupMembers (public member projection)", () => {
    beforeEach(() => {
        mockFindMany.mockReset();
        mockFindMany.mockResolvedValue([
            { user: { id: "u1", name: "Ana", avatar: "👩", isGuest: false } },
            { user: { id: "u2", name: "Bea", avatar: null, isGuest: true } },
        ]);
    });

    it("selects only public fields — never password, pin or email", async () => {
        await getGroupMembers("g1");
        const args = mockFindMany.mock.calls[0][0];
        expect(args.include).toBeUndefined();
        expect(args.select).toEqual({ user: { select: PUBLIC_MEMBER_SELECT } });
        const fields = Object.keys(PUBLIC_MEMBER_SELECT);
        expect(fields).toEqual(["id", "name", "avatar", "isGuest"]);
        for (const secret of ["password", "pin", "email", "tokenVersion", "isAdmin"]) {
            expect(fields).not.toContain(secret);
        }
    });

    it("keeps the load-bearing member order (joinedAt, userId) and ACTIVE filter", async () => {
        const members = await getGroupMembers("g1");
        const args = mockFindMany.mock.calls[0][0];
        expect(args.where).toEqual({ groupId: "g1", status: "ACTIVE" });
        expect(args.orderBy).toEqual([{ joinedAt: "asc" }, { userId: "asc" }]);
        expect(members.map((m) => m.id)).toEqual(["u1", "u2"]);
        expect(members[0]).toEqual({ id: "u1", name: "Ana", avatar: "👩", isGuest: false });
    });
});
