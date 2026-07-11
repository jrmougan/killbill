import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashInviteToken } from "@/lib/invite-token";

const mockGetSession = vi.fn();
const mockGroupInviteFindUnique = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindFirst = vi.fn();
const mockMembershipCount = vi.fn();
const mockMembershipUpsert = vi.fn();
const mockGroupInviteUpdateMany = vi.fn();
const mockCookieSet = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mockCookieSet }) }));
vi.mock("@/lib/db", () => {
    const membership = {
        findFirst: (...a: unknown[]) => mockMembershipFindFirst(...a),
        count: (...a: unknown[]) => mockMembershipCount(...a),
        upsert: (...a: unknown[]) => mockMembershipUpsert(...a),
    };
    const groupInvite = {
        findUnique: (...a: unknown[]) => mockGroupInviteFindUnique(...a),
        updateMany: (...a: unknown[]) => mockGroupInviteUpdateMany(...a),
    };
    return {
        prisma: {
            groupInvite,
            couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
            membership,
            $transaction: (cb: (tx: unknown) => unknown) => cb({ membership, groupInvite }),
        },
    };
});

import { POST } from "./route";

const TOKEN = "a-plaintext-token";
const future = new Date(Date.now() + 60 * 60 * 1000);
const past = new Date(Date.now() - 60 * 60 * 1000);

function req(body: unknown) {
    return new Request("http://localhost/api/invites/claim", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

function memberInvite(overrides: Record<string, unknown> = {}) {
    return {
        id: "inv1",
        tokenHash: hashInviteToken(TOKEN),
        kind: "MEMBER",
        maxUses: 10,
        usedCount: 0,
        expiresAt: future,
        revokedAt: null,
        group: { id: "g1", type: "GROUP", status: "ACTIVE" },
        ...overrides,
    };
}

describe("POST /api/invites/claim", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: "u1" });
        mockMembershipFindFirst.mockResolvedValue(null); // not yet a member
        mockMembershipCount.mockResolvedValue(1); // room available
        mockMembershipUpsert.mockResolvedValue({});
        mockGroupInviteUpdateMany.mockResolvedValue({ count: 1 }); // consume succeeds
    });

    it("401 without a session", async () => {
        mockGetSession.mockResolvedValue(null);
        const res = await POST(req({ token: TOKEN }));
        expect(res.status).toBe(401);
    });

    it("400 when token missing", async () => {
        const res = await POST(req({}));
        expect(res.status).toBe(400);
    });

    it("joins a valid MEMBER invite and consumes one use", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite());
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.groupId).toBe("g1");
        expect(data.alreadyMember).toBe(false);
        expect(mockMembershipUpsert).toHaveBeenCalledOnce();
        expect(mockGroupInviteUpdateMany).toHaveBeenCalledOnce();
        expect(mockCookieSet).toHaveBeenCalled();
    });

    it("rejects a revoked invite without joining", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite({ revokedAt: past }));
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("REVOKED");
        expect(mockMembershipUpsert).not.toHaveBeenCalled();
    });

    it("rejects an expired invite without joining", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite({ expiresAt: past }));
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("EXPIRED");
        expect(mockMembershipUpsert).not.toHaveBeenCalled();
    });

    it("rejects an exhausted invite (usedCount >= maxUses)", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite({ maxUses: 5, usedCount: 5 }));
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("EXHAUSTED");
        expect(mockMembershipUpsert).not.toHaveBeenCalled();
    });

    it("rejects an EPHEMERAL space for MEMBER claims (guests are Fase 3)", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(
            memberInvite({ group: { id: "g1", type: "EPHEMERAL", status: "ACTIVE" } }),
        );
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("JOIN_NOT_ALLOWED");
    });

    it("rejects a non-ACTIVE (SETTLING) space", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(
            memberInvite({ group: { id: "g1", type: "GROUP", status: "SETTLING" } }),
        );
        const res = await POST(req({ token: TOKEN }));
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("JOIN_NOT_ALLOWED");
    });

    it("is idempotent when already an ACTIVE member (no consume)", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite());
        mockMembershipFindFirst.mockResolvedValue({ id: "m1" });
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.alreadyMember).toBe(true);
        expect(mockMembershipUpsert).not.toHaveBeenCalled();
        expect(mockGroupInviteUpdateMany).not.toHaveBeenCalled();
    });

    it("returns SPACE_FULL when the cap is reached", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(
            memberInvite({ group: { id: "g1", type: "COUPLE", status: "ACTIVE" } }),
        );
        mockMembershipCount.mockResolvedValue(2); // COUPLE cap = 2
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("SPACE_FULL");
        expect(mockMembershipUpsert).not.toHaveBeenCalled();
    });

    it("loses the consume race (updateMany count 0) and rolls back to EXHAUSTED", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(memberInvite());
        mockGroupInviteUpdateMany.mockResolvedValue({ count: 0 });
        const res = await POST(req({ token: TOKEN }));
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("EXHAUSTED");
    });

    it("falls back to a legacy classic Couple.code and joins without consuming", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(null);
        mockCoupleFindUnique.mockResolvedValue({ id: "g9", type: "COUPLE", status: "ACTIVE" });
        const res = await POST(req({ token: "ABC123" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.groupId).toBe("g9");
        expect(mockMembershipUpsert).toHaveBeenCalledOnce();
        expect(mockGroupInviteUpdateMany).not.toHaveBeenCalled();
    });

    it("404 when neither an invite nor a classic code resolves", async () => {
        mockGroupInviteFindUnique.mockResolvedValue(null);
        mockCoupleFindUnique.mockResolvedValue(null);
        const res = await POST(req({ token: "nope" }));
        expect(res.status).toBe(404);
    });
});
