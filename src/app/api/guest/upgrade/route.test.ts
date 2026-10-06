import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockEphemeralEnabled = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserUpdate = vi.fn();
const mockMembershipUpdateMany = vi.fn();
const mockCookieSet = vi.fn();
const mockCookieDelete = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/auth", () => ({ signToken: async () => "signed.jwt" }));
vi.mock("@/lib/flags", () => ({ ephemeralSpacesEnabled: () => mockEphemeralEnabled() }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "hashed" } }));
vi.mock("next/headers", () => ({
    cookies: async () => ({ set: mockCookieSet, delete: mockCookieDelete }),
}));
vi.mock("@/lib/db", () => {
    const user = {
        findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
        update: (...a: unknown[]) => mockUserUpdate(...a),
    };
    const membership = { updateMany: (...a: unknown[]) => mockMembershipUpdateMany(...a) };
    return {
        prisma: {
            user,
            membership,
            $transaction: (cb: (tx: unknown) => unknown) => cb({ user, membership }),
        },
    };
});

import { POST } from "./route";

function req(body: unknown) {
    return new Request("http://localhost/api/guest/upgrade", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

describe("POST /api/guest/upgrade", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockEphemeralEnabled.mockReturnValue(true);
        mockGetSessionCtx.mockResolvedValue({ userId: "guest1", kind: "guest", groupId: "e1" });
        mockUserFindUnique.mockResolvedValue({ id: "guest1", isGuest: true });
        mockUserUpdate.mockResolvedValue({ id: "guest1", email: "a@b.c", isAdmin: false });
        mockMembershipUpdateMany.mockResolvedValue({ count: 1 });
    });

    it("403 when the flag is off", async () => {
        mockEphemeralEnabled.mockReturnValue(false);
        const res = await POST(req({ email: "a@b.c", password: "password1" }));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe("FEATURE_DISABLED");
    });

    it("403 when the session is not a guest", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "u1", kind: undefined, groupId: "g1" });
        const res = await POST(req({ email: "a@b.c", password: "password1" }));
        expect(res.status).toBe(403);
    });

    it("400 on a short password", async () => {
        const res = await POST(req({ email: "a@b.c", password: "short" }));
        expect(res.status).toBe(400);
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("400 on an invalid email", async () => {
        const res = await POST(req({ email: "not-an-email", password: "password1" }));
        expect(res.status).toBe(400);
    });

    it("upgrades the same user row and promotes GUEST → MEMBER", async () => {
        const res = await POST(req({ email: "a@b.c", password: "password1" }));
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.groupId).toBe("e1");
        expect(mockUserUpdate).toHaveBeenCalledOnce();
        expect(mockMembershipUpdateMany).toHaveBeenCalledOnce();
        expect(mockCookieSet).toHaveBeenCalledWith("session_token", "signed.jwt", expect.anything());
    });

    it("maps a P2002 email collision to EMAIL_TAKEN (no merge)", async () => {
        mockUserUpdate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
        const res = await POST(req({ email: "taken@b.c", password: "password1" }));
        const data = await res.json();
        expect(res.status).toBe(409);
        expect(data.code).toBe("EMAIL_TAKEN");
    });

    it("409 when the row is no longer a guest (double upgrade)", async () => {
        mockUserFindUnique.mockResolvedValue({ id: "guest1", isGuest: false });
        const res = await POST(req({ email: "a@b.c", password: "password1" }));
        expect(res.status).toBe(409);
    });

    it("keeps the historical 400 messages (invalid / non-object body, missing fields first)", async () => {
        const raw = (body: string) =>
            POST(new Request("http://localhost/api/guest/upgrade", { method: "POST", body }));
        expect(await (await raw("{nope")).json()).toEqual({ error: "Cuerpo inválido" });
        const nullBody = await raw("null"); // used to be a 500 (TypeError)
        expect(nullBody.status).toBe(400);
        expect((await nullBody.json()).error).toBe("Cuerpo inválido");

        // Missing password wins over a malformed email, as before.
        const missing = await POST(req({ email: "nope" }));
        expect(missing.status).toBe(400);
        expect((await missing.json()).error).toBe("Email y contraseña obligatorios");

        const badEmail = await POST(req({ email: "nope", password: "password1" }));
        const data = await badEmail.json();
        expect(data.error).toBe("Email inválido");
        expect(data.issues[0].path).toBe("email");

        const shortPw = await POST(req({ email: "a@b.c", password: 12345678 }));
        expect((await shortPw.json()).error).toBe("Email y contraseña obligatorios");
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("normalizes the email (trim + lowercase) before saving", async () => {
        await POST(req({ email: "  Ana@Example.COM ", password: "password1" }));
        expect(mockUserUpdate.mock.calls[0][0].data.email).toBe("ana@example.com");
    });

    it("403 (not 401) without any session, and an unexpected failure is a 500", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await POST(req({ email: "a@b.c", password: "password1" }))).status).toBe(403);

        mockGetSessionCtx.mockResolvedValue({ userId: "guest1", kind: "guest", groupId: "e1" });
        mockUserUpdate.mockRejectedValue(new Error("db down"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await POST(req({ email: "a@b.c", password: "password1" }));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "No se pudo crear la cuenta" });
    });
});
