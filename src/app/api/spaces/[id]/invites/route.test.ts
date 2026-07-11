import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashInviteToken } from "@/lib/invite-token";

const mockGetSession = vi.fn();
const mockCoupleFindUnique = vi.fn();
const mockMembershipFindUnique = vi.fn();
const mockGroupInviteCreate = vi.fn();
const mockGroupInviteFindMany = vi.fn();
const mockGroupInviteUpdateMany = vi.fn();

const mockEphemeralEnabled = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/flags", () => ({ ephemeralSpacesEnabled: () => mockEphemeralEnabled() }));
vi.mock("@/lib/db", () => ({
    prisma: {
        couple: { findUnique: (...a: unknown[]) => mockCoupleFindUnique(...a) },
        membership: { findUnique: (...a: unknown[]) => mockMembershipFindUnique(...a) },
        groupInvite: {
            create: (...a: unknown[]) => mockGroupInviteCreate(...a),
            findMany: (...a: unknown[]) => mockGroupInviteFindMany(...a),
            updateMany: (...a: unknown[]) => mockGroupInviteUpdateMany(...a),
        },
    },
}));

import { POST, GET, DELETE } from "./route";

const params = Promise.resolve({ id: "g1" });
const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

function post(body: unknown) {
    return new Request("http://localhost/api/spaces/g1/invites", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

describe("/api/spaces/[id]/invites (kind MEMBER)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: "owner" });
        // ACTIVE GROUP; caller is OWNER.
        mockCoupleFindUnique.mockResolvedValue({ id: "g1", type: "GROUP", status: "ACTIVE" });
        mockMembershipFindUnique.mockResolvedValue({ groupId: "g1", userId: "owner", role: "OWNER", status: "ACTIVE" });
        mockGroupInviteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: "inv1",
            usedCount: 0,
            createdAt: new Date(),
            ...data,
        }));
        mockEphemeralEnabled.mockReturnValue(false);
    });

    it("403 when the caller is only a MEMBER", async () => {
        mockMembershipFindUnique.mockResolvedValue({ groupId: "g1", userId: "u2", role: "MEMBER", status: "ACTIVE" });
        const res = await POST(post({ expiresAt: future }), { params });
        expect(res.status).toBe(403);
        expect(mockGroupInviteCreate).not.toHaveBeenCalled();
    });

    it("400 when expiresAt is missing (OBLIGATORIO)", async () => {
        const res = await POST(post({}), { params });
        expect(res.status).toBe(400);
    });

    it("400 when expiresAt is in the past", async () => {
        const res = await POST(post({ expiresAt: new Date(Date.now() - 1000).toISOString() }), { params });
        expect(res.status).toBe(400);
    });

    it("rejects EPHEMERAL spaces (guest links are Fase 3)", async () => {
        mockCoupleFindUnique.mockResolvedValue({ id: "g1", type: "EPHEMERAL", status: "ACTIVE" });
        const res = await POST(post({ expiresAt: future }), { params });
        const data = await res.json();
        expect(res.status).toBe(400);
        expect(data.code).toBe("JOIN_NOT_ALLOWED");
    });

    it("creates a MEMBER invite, returns the token ONCE, and stores only its hash", async () => {
        const res = await POST(post({ expiresAt: future, maxUses: 5 }), { params });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(typeof data.token).toBe("string");
        expect(data.token.length).toBeGreaterThan(0);

        // What was persisted must be the hash + prefix, never the plaintext.
        const created = mockGroupInviteCreate.mock.calls[0][0].data;
        expect(created.tokenHash).toBe(hashInviteToken(data.token));
        expect(created.tokenPrefix).toBe(data.token.slice(0, 8));
        expect(created.kind).toBe("MEMBER");
        expect(created.maxUses).toBe(5);
        // The response invite payload never leaks the hash.
        expect(data.invite.tokenHash).toBeUndefined();
    });

    it("defaults maxUses to 1 when omitted", async () => {
        await POST(post({ expiresAt: future }), { params });
        expect(mockGroupInviteCreate.mock.calls[0][0].data.maxUses).toBe(1);
    });

    it("GET lists invites by prefix without exposing tokens", async () => {
        mockGroupInviteFindMany.mockResolvedValue([
            { id: "inv1", tokenPrefix: "abcd1234", kind: "MEMBER", maxUses: 1, usedCount: 0, expiresAt: new Date(), revokedAt: null, createdAt: new Date() },
        ]);
        const res = await GET(new Request("http://localhost/api/spaces/g1/invites"), { params });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.invites).toHaveLength(1);
        expect(data.invites[0].tokenPrefix).toBe("abcd1234");
    });

    it("DELETE revokes an invite belonging to the space", async () => {
        mockGroupInviteUpdateMany.mockResolvedValue({ count: 1 });
        const res = await DELETE(new Request("http://localhost/api/spaces/g1/invites?inviteId=inv1", { method: "DELETE" }), { params });
        expect(res.status).toBe(200);
        const where = mockGroupInviteUpdateMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ id: "inv1", groupId: "g1", revokedAt: null });
    });

    it("DELETE 404 when the invite does not belong to the space or is already revoked", async () => {
        mockGroupInviteUpdateMany.mockResolvedValue({ count: 0 });
        const res = await DELETE(new Request("http://localhost/api/spaces/g1/invites?inviteId=nope", { method: "DELETE" }), { params });
        expect(res.status).toBe(404);
    });
});

describe("/api/spaces/[id]/invites (kind GUEST, Fase 3)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSession.mockResolvedValue({ userId: "owner" });
        mockCoupleFindUnique.mockResolvedValue({ id: "e1", type: "EPHEMERAL", status: "ACTIVE" });
        mockMembershipFindUnique.mockResolvedValue({ groupId: "e1", userId: "owner", role: "OWNER", status: "ACTIVE" });
        mockGroupInviteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: "ginv1",
            usedCount: 0,
            createdAt: new Date(),
            ...data,
        }));
        mockEphemeralEnabled.mockReturnValue(true);
    });

    it("403 FEATURE_DISABLED when the flag is off", async () => {
        mockEphemeralEnabled.mockReturnValue(false);
        const res = await POST(post({ kind: "GUEST" }), { params });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe("FEATURE_DISABLED");
        expect(mockGroupInviteCreate).not.toHaveBeenCalled();
    });

    it("rejects GUEST links on a non-EPHEMERAL space", async () => {
        mockCoupleFindUnique.mockResolvedValue({ id: "g1", type: "GROUP", status: "ACTIVE" });
        const res = await POST(post({ kind: "GUEST" }), { params });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe("GUESTS_NOT_ALLOWED");
    });

    it("mints a GUEST link with defaults maxUses=10 and a 30d expiry when omitted", async () => {
        const res = await POST(post({ kind: "GUEST" }), { params });
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(typeof data.token).toBe("string");
        const created = mockGroupInviteCreate.mock.calls[0][0].data;
        expect(created.kind).toBe("GUEST");
        expect(created.maxUses).toBe(10);
        expect(created.expiresAt).toBeInstanceOf(Date);
        expect((created.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
    });
});
