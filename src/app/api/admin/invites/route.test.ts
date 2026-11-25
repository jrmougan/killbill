import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockUserFindUnique = vi.fn();
const mockInviteFindMany = vi.fn();
const mockInviteCreate = vi.fn();
const mockInviteDeleteMany = vi.fn();
const mockInviteFindUnique = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/db", () => ({
    prisma: {
        user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
        inviteCode: {
            findMany: (...a: unknown[]) => mockInviteFindMany(...a),
            create: (...a: unknown[]) => mockInviteCreate(...a),
            deleteMany: (...a: unknown[]) => mockInviteDeleteMany(...a),
            findUnique: (...a: unknown[]) => mockInviteFindUnique(...a),
        },
    },
}));

import { DELETE, GET, POST } from "./route";

const del = (body: string) =>
    DELETE(new Request("http://localhost/api/admin/invites", { method: "DELETE", body }));

describe("/api/admin/invites", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: "admin1", isAdmin: true, kind: undefined });
        mockUserFindUnique.mockResolvedValue({ isAdmin: true });
        mockInviteFindMany.mockResolvedValue([]);
        mockInviteCreate.mockImplementation(async ({ data }) => ({ id: "i1", ...data }));
        mockInviteDeleteMany.mockResolvedValue({ count: 1 });
        mockInviteFindUnique.mockResolvedValue(null);
    });

    it("401 without a session, and for MCP / guest tokens", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await GET(new Request("http://localhost/api/admin/invites"));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "No autorizado" });

        mockGetSessionCtx.mockResolvedValue({ userId: "admin1", kind: "mcp" });
        expect((await POST(new Request("http://localhost/api/admin/invites", { method: "POST" }))).status).toBe(401);
        expect(mockInviteCreate).not.toHaveBeenCalled();
    });

    it("403 'Acceso denegado' when the DB says the user is not an admin (JWT claim ignored)", async () => {
        mockUserFindUnique.mockResolvedValue({ isAdmin: false });
        const res = await GET(new Request("http://localhost/api/admin/invites"));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Acceso denegado" });
        expect(mockInviteFindMany).not.toHaveBeenCalled();
    });

    it("POST creates an 8-hex code owned by the admin", async () => {
        const res = await POST(new Request("http://localhost/api/admin/invites", { method: "POST" }));
        expect(res.status).toBe(200);
        const data = mockInviteCreate.mock.calls[0][0].data;
        expect(data.code).toMatch(/^[0-9A-F]{8}$/);
        expect(data.createdById).toBe("admin1");
    });

    it("POST gives the invite 7 days", async () => {
        const before = Date.now();
        await POST(new Request("http://localhost/api/admin/invites", { method: "POST" }));
        const { expiresAt } = mockInviteCreate.mock.calls[0][0].data;
        const week = 7 * 24 * 60 * 60 * 1000;
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + week);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + week);
    });

    it("DELETE removes an unused invite by id", async () => {
        const res = await del(JSON.stringify({ id: "i1" }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(mockInviteDeleteMany).toHaveBeenCalledWith({ where: { id: "i1", usedById: null } });
        expect(mockInviteFindUnique).not.toHaveBeenCalled();
    });

    it("DELETE of a used invite → 409 INVITE_USED, the row stays", async () => {
        mockInviteDeleteMany.mockResolvedValue({ count: 0 });
        mockInviteFindUnique.mockResolvedValue({ id: "i1" });
        const res = await del(JSON.stringify({ id: "i1" }));
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: "Esta invitación ya se ha usado y no se puede anular",
            code: "INVITE_USED",
        });
    });

    it("DELETE of an id that does not exist → 404 (it used to be a 500)", async () => {
        mockInviteDeleteMany.mockResolvedValue({ count: 0 });
        const res = await del(JSON.stringify({ id: "gone" }));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "Invitación no encontrada" });
    });

    it("DELETE with an invalid body → 400 (it used to be a 500), nothing deleted", async () => {
        const bad = await del("{not json");
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: "Petición no válida" });

        const missing = await del(JSON.stringify({}));
        expect(missing.status).toBe(400);
        expect((await missing.json()).issues[0].path).toBe("id");

        expect(mockInviteDeleteMany).not.toHaveBeenCalled();
    });
});
