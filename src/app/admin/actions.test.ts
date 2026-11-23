import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const deleteMany = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/db", () => ({
    prisma: {
        user: { findUnique: (...a: unknown[]) => findUnique(...a) },
        inviteCode: { create: (...a: unknown[]) => create(...a), deleteMany: (...a: unknown[]) => deleteMany(...a) },
    },
}));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { createInviteAction, deleteInviteAction } from "./actions";
import { checkAdmin } from "./admin-data";

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ userId: "u1", isAdmin: true });
    findUnique.mockResolvedValue({ id: "u1", isAdmin: true });
    create.mockResolvedValue({ id: "i1" });
    deleteMany.mockResolvedValue({ count: 1 });
});

describe("checkAdmin", () => {
    it("requires a session", async () => {
        mockGetSession.mockResolvedValue(null);
        expect(await checkAdmin()).toEqual({ status: "unauthenticated" });
    });

    it("re-checks isAdmin in the DB, ignoring the JWT claim", async () => {
        findUnique.mockResolvedValue({ id: "u1", isAdmin: false });
        expect(await checkAdmin()).toEqual({ status: "forbidden" });
    });

    it("rejects guest sessions without touching the DB", async () => {
        mockGetSession.mockResolvedValue({ userId: "g1", kind: "guest" });
        expect(await checkAdmin()).toEqual({ status: "forbidden" });
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("rejects an admin's MCP token without touching the DB", async () => {
        mockGetSession.mockResolvedValue({ userId: "u1", isAdmin: true, kind: "mcp" });
        expect(await checkAdmin()).toEqual({ status: "forbidden" });
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("a token of a deleted user is unauthenticated", async () => {
        findUnique.mockResolvedValue(null);
        expect(await checkAdmin()).toEqual({ status: "unauthenticated" });
    });

    it("admin → ok", async () => {
        expect(await checkAdmin()).toEqual({ status: "ok", userId: "u1" });
    });
});

describe("admin Server Actions", () => {
    it("non-admins cannot create or delete invites", async () => {
        findUnique.mockResolvedValue({ id: "u1", isAdmin: false });
        expect(await createInviteAction()).toEqual({ ok: false, error: "Acceso denegado" });
        expect(await deleteInviteAction("i1")).toEqual({ ok: false, error: "Acceso denegado" });
        expect(create).not.toHaveBeenCalled();
        expect(deleteMany).not.toHaveBeenCalled();
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("anonymous callers are denied", async () => {
        mockGetSession.mockResolvedValue(null);
        expect(await createInviteAction()).toMatchObject({ ok: false });
        expect(create).not.toHaveBeenCalled();
    });

    it("an admin creates an 8-char code valid for 7 days and revalidates /admin", async () => {
        const before = Date.now();
        expect(await createInviteAction()).toEqual({ ok: true });
        const { data } = create.mock.calls[0][0] as { data: { code: string; createdById: string; expiresAt: Date } };
        expect(data.code).toMatch(/^[0-9A-F]{8}$/);
        expect(data.createdById).toBe("u1");
        expect(data.expiresAt.getTime() - before).toBeGreaterThanOrEqual(7 * 24 * 3600 * 1000 - 1000);
        expect(revalidatePath).toHaveBeenCalledWith("/admin");
    });

    it("an admin voids an invite only while nobody has used it", async () => {
        expect(await deleteInviteAction("i1")).toEqual({ ok: true });
        expect(deleteMany).toHaveBeenCalledWith({ where: { id: "i1", usedById: null } });
        expect(revalidatePath).toHaveBeenCalledWith("/admin");
    });

    it("an invite already used or voided is reported as gone and the list is refreshed", async () => {
        deleteMany.mockResolvedValue({ count: 0 });
        expect(await deleteInviteAction("i1")).toEqual({
            ok: false,
            error: "Esta invitación ya se había usado o anulado",
            gone: true,
        });
        expect(revalidatePath).toHaveBeenCalledWith("/admin");
    });

    it("a DB failure while voiding is reported without revalidating", async () => {
        deleteMany.mockRejectedValue(new Error("connection lost"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await deleteInviteAction("i1")).toEqual({ ok: false, error: "No se pudo eliminar la invitación" });
        expect(revalidatePath).not.toHaveBeenCalled();
    });

    it("an empty id is refused before touching the DB", async () => {
        expect(await deleteInviteAction("")).toEqual({ ok: false, error: "No se pudo eliminar la invitación" });
        expect(deleteMany).not.toHaveBeenCalled();
    });
});
