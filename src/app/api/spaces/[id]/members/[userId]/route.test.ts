import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockMembershipFindMany = vi.fn();
const mockMembershipCount = vi.fn();
const mockMembershipUpdate = vi.fn();
const mockGetGroupBalances = vi.fn();
const mockLockQuery = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/ledger-read", () => ({ getGroupBalances: (...a: unknown[]) => mockGetGroupBalances(...a) }));
vi.mock("@/lib/db", () => {
    const membership = {
        findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a),
        findMany: (...a: unknown[]) => mockMembershipFindMany(...a),
        count: (...a: unknown[]) => mockMembershipCount(...a),
        update: (...a: unknown[]) => mockMembershipUpdate(...a),
    };
    const user = { updateMany: vi.fn() };
    return {
        prisma: {
            couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
            membership,
            user,
            // withSpaceLock: the tx double answers the `SELECT … FOR UPDATE`.
            $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
                mockTransaction();
                return fn({ membership, user, $queryRaw: (...a: unknown[]) => mockLockQuery(...a) });
            },
        },
    };
});

import { DELETE, PATCH } from "./route";

type Row = { userId: string; role: string; status?: string; isGuest?: boolean };

/** Space g1 with the given ACTIVE roster; the session user is `me`. */
function setup(me: string, roster: Row[], balances: Record<string, number> = {}) {
    mockGetSession.mockResolvedValue({ userId: me });
    mockCoupleFindUnique.mockResolvedValue({ id: "g1", type: "GROUP", status: "ACTIVE" });
    mockMembershipFindUnique.mockImplementation(async ({ where }: { where: { groupId_userId: { userId: string } } }) => {
        const r = roster.find((x) => x.userId === where.groupId_userId.userId);
        return r
            ? { groupId: "g1", userId: r.userId, role: r.role, status: r.status ?? "ACTIVE", user: { isGuest: !!r.isGuest } }
            : null;
    });
    mockMembershipFindMany.mockResolvedValue(roster.map((r) => ({ userId: r.userId, role: r.role })));
    mockMembershipCount.mockResolvedValue(roster.filter((r) => r.role === "OWNER").length);
    mockGetGroupBalances.mockResolvedValue(balances);
    mockLockQuery.mockResolvedValue([{ status: "ACTIVE" }]);
}

function del(userId: string, query = "") {
    return DELETE(new Request(`http://localhost/api/spaces/g1/members/${userId}${query}`, { method: "DELETE" }), {
        params: Promise.resolve({ id: "g1", userId }),
    });
}

function patch(userId: string, body: unknown) {
    return PATCH(
        new Request(`http://localhost/api/spaces/g1/members/${userId}`, { method: "PATCH", body: JSON.stringify(body) }),
        { params: Promise.resolve({ id: "g1", userId }) },
    );
}

describe("DELETE /api/spaces/[id]/members/[userId] — self-leave", () => {
    beforeEach(() => vi.clearAllMocks());

    it("409 LAST_OWNER when the only OWNER leaves and others remain", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await del("a");
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "LAST_OWNER" });
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("LAST_OWNER is not overridable with ?force=1", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await del("a", "?force=1");
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("LAST_OWNER");
    });

    it("an OWNER may leave when another OWNER remains", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "OWNER" }], { a: 0, b: 0 });
        const res = await del("a");
        expect(res.status).toBe(200);
        expect(mockMembershipUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: "LEFT" }) }),
        );
    });

    it("the last member (sole OWNER) may leave", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }], { a: 0 });
        expect((await del("a")).status).toBe(200);
    });

    it("409 HAS_BALANCE with balanceCents when the caller's balance is open", async () => {
        setup("b", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 5000, b: -5000 });
        const res = await del("b");
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "HAS_BALANCE", balanceCents: -5000, settleUrl: "/settle?space=g1" });
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("?force=1 leaves despite an open balance", async () => {
        setup("b", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 5000, b: -5000 });
        const res = await del("b", "?force=1");
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe("LEFT");
    });

    it("a ±1 cent residue is not an open balance", async () => {
        setup("b", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 1, b: -1 });
        expect((await del("b")).status).toBe(200);
    });

    it("an OWNER expels a member whose balance is closed (→ REMOVED)", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 1, b: -1 });
        const res = await del("b");
        expect(res.status).toBe(200);
        expect((await res.json()).status).toBe("REMOVED");
    });

    it("A2: 409 HAS_BALANCE when expelling a member with an open balance — even with ?force=1", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 5000, b: -5000 });
        for (const q of ["", "?force=1"]) {
            const res = await del("b", q);
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body).toMatchObject({ code: "HAS_BALANCE", balanceCents: -5000, settleUrl: "/settle?space=g1" });
            expect(body.error).toMatch(/saldo pendiente/);
        }
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("A2: a creditor (positive balance) cannot be expelled either", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: -2500, b: 2500 });
        expect((await del("b")).status).toBe(409);
    });

    it("A3: the balance and the update run inside the space-locked transaction", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 0, b: 0 });
        await del("b");
        expect(mockTransaction).toHaveBeenCalledOnce();
        expect(mockLockQuery).toHaveBeenCalledOnce();
        // Balances are read through the transaction client, not the global one.
        expect(mockGetGroupBalances).toHaveBeenCalledWith("g1", expect.objectContaining({ $queryRaw: expect.any(Function) }));
        expect(mockLockQuery.mock.invocationCallOrder[0]).toBeLessThan(mockGetGroupBalances.mock.invocationCallOrder[0]);
        expect(mockGetGroupBalances.mock.invocationCallOrder[0]).toBeLessThan(mockMembershipUpdate.mock.invocationCallOrder[0]);
    });

    it("A3: a caller demoted concurrently (re-read under the lock) can no longer expel", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 0, b: 0 });
        // requireSpaceAccess (outside) saw OWNER; under the lock "a" is a MEMBER.
        mockMembershipFindUnique
            .mockResolvedValueOnce({ groupId: "g1", userId: "a", role: "OWNER", status: "ACTIVE" })
            .mockResolvedValueOnce({ groupId: "g1", userId: "b", role: "MEMBER", status: "ACTIVE" })
            .mockResolvedValueOnce({ groupId: "g1", userId: "a", role: "MEMBER", status: "ACTIVE" });
        expect((await del("b")).status).toBe(403);
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("404 when the space disappeared before the lock", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { a: 0, b: 0 });
        mockLockQuery.mockResolvedValue([]);
        const res = await del("b");
        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe("SPACE_NOT_FOUND");
    });

    it("a MEMBER cannot expel someone else", async () => {
        setup("b", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }, { userId: "c", role: "MEMBER" }]);
        expect((await del("c")).status).toBe(403);
    });
});

describe("PATCH /api/spaces/[id]/members/[userId] — role", () => {
    beforeEach(() => vi.clearAllMocks());

    it("OWNER promotes a MEMBER to OWNER", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await patch("b", { role: "OWNER" });
        expect(res.status).toBe(200);
        expect(mockMembershipUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { role: "OWNER" } }));
    });

    it("an ADMIN cannot change roles", async () => {
        setup("a", [{ userId: "a", role: "ADMIN" }, { userId: "b", role: "MEMBER" }]);
        expect((await patch("b", { role: "ADMIN" })).status).toBe(403);
    });

    it("400 on an unknown role (GUEST is not assignable)", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        expect((await patch("b", { role: "GUEST" })).status).toBe(400);
        expect((await patch("b", { role: "KING" })).status).toBe(400);
    });

    it("409 LAST_OWNER when demoting the only OWNER", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await patch("a", { role: "MEMBER" });
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("LAST_OWNER");
    });

    it("403 for a guest target", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "g", role: "GUEST", isGuest: true }]);
        expect((await patch("g", { role: "MEMBER" })).status).toBe(403);
    });
});

describe("PATCH /api/spaces/[id]/members/[userId] — body validation (route() kit)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("400 'Cuerpo inválido' for unparseable JSON, without touching the target", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await PATCH(
            new Request("http://localhost/api/spaces/g1/members/b", { method: "PATCH", body: "{" }),
            { params: Promise.resolve({ id: "g1", userId: "b" }) },
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("Cuerpo inválido");
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("400 'Rol no válido' with issues for a non-string role", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }]);
        const res = await patch("b", { role: 1 });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe("Rol no válido");
        expect(json.issues[0].path).toBe("role");
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });

    it("a non-OWNER gets 403 before any body validation", async () => {
        setup("a", [{ userId: "a", role: "ADMIN" }, { userId: "b", role: "MEMBER" }]);
        expect((await patch("b", { role: 1 })).status).toBe(403);
    });

    it("HAS_BALANCE keeps the blocker body (status, balanceCents, settleUrl)", async () => {
        setup("a", [{ userId: "a", role: "OWNER" }, { userId: "b", role: "MEMBER" }], { b: -5000 });
        const res = await del("b");
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: expect.any(String),
            code: "HAS_BALANCE",
            status: 409,
            balanceCents: -5000,
            settleUrl: "/settle?space=g1",
        });
        expect(mockMembershipUpdate).not.toHaveBeenCalled();
    });
});
