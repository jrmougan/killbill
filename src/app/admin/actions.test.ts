import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const del = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));
vi.mock("@/lib/db", () => ({
    prisma: {
        user: { findUnique: (...a: unknown[]) => findUnique(...a) },
        inviteCode: { create: (...a: unknown[]) => create(...a), delete: (...a: unknown[]) => del(...a) },
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
    del.mockResolvedValue({});
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
        expect(del).not.toHaveBeenCalled();
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

    it("an admin deletes an invite; a DB failure is reported", async () => {
        expect(await deleteInviteAction("i1")).toEqual({ ok: true });
        expect(del).toHaveBeenCalledWith({ where: { id: "i1" } });
        del.mockRejectedValue(new Error("P2025"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect(await deleteInviteAction("i1")).toEqual({ ok: false, error: "No se pudo eliminar la invitación" });
    });
});
