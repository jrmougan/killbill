import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCount = vi.fn();
const mockTxCount = vi.fn();
const mockCreate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("bcryptjs", () => ({ default: { hash: async () => "hashed" } }));
vi.mock("@/lib/db", () => ({
    prisma: {
        user: { count: (...a: unknown[]) => mockCount(...a) },
        $transaction: (...a: unknown[]) => mockTransaction(...a),
    },
}));

import { GET, POST } from "./route";

const req = (body: unknown) =>
    new Request("http://localhost/api/setup", { method: "POST", body: JSON.stringify(body) });
const valid = { name: "Admin", email: "admin@example.com", password: "supersecret" };

describe("POST /api/setup", () => {
    beforeEach(() => {
        mockCount.mockReset().mockResolvedValue(0);
        mockTxCount.mockReset().mockResolvedValue(0);
        mockCreate.mockReset().mockImplementation(async ({ data }) => ({ id: "a1", name: data.name, email: data.email }));
        mockTransaction.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) =>
            cb({ user: { count: mockTxCount, create: mockCreate } }),
        );
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("creates the first admin inside a SERIALIZABLE transaction, without leaking the hash", async () => {
        const res = await POST(req(valid));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.user).toEqual({ id: "a1", name: "Admin", email: "admin@example.com" });
        expect(mockCreate.mock.calls[0][0].data).toMatchObject({ isAdmin: true, password: "hashed" });
        expect(mockTransaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
    });

    it("is disabled once any user exists (no hashing, no create)", async () => {
        mockCount.mockResolvedValue(1);
        const res = await POST(req(valid));
        expect(res.status).toBe(403);
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("re-checks inside the transaction: a user created meanwhile → 403, no second admin", async () => {
        mockTxCount.mockResolvedValue(1);
        const res = await POST(req(valid));
        expect(res.status).toBe(403);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it("a lost race (transaction aborted by the DB) reports setup already done", async () => {
        mockTransaction.mockRejectedValue(Object.assign(new Error("deadlock"), { code: "P2034" }));
        mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
        const res = await POST(req(valid));
        expect(res.status).toBe(403);
    });

    it("a repeated call after success is refused (idempotent bootstrap)", async () => {
        expect((await POST(req(valid))).status).toBe(200);
        mockCount.mockResolvedValue(1);
        expect((await POST(req({ ...valid, email: "evil@example.com" }))).status).toBe(403);
        expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("400 on missing fields / short password", async () => {
        expect((await POST(req({ name: "A" }))).status).toBe(400);
        expect((await POST(req({ ...valid, password: "short" }))).status).toBe(400);
        expect((await POST(req({ ...valid, name: { x: 1 } }))).status).toBe(400);
    });

    it("keeps the historical 400 wording, and never creates on bad input", async () => {
        const raw = (body: string) => POST(new Request("http://localhost/api/setup", { method: "POST", body }));
        expect(await (await raw("{nope")).json()).toEqual({ error: "Cuerpo de la petición no válido" });
        expect((await (await raw("[]")).json()).error).toBe("Cuerpo de la petición no válido");
        expect((await (await POST(req({ name: "A" }))).json()).error).toBe("Se requiere nombre, email y contraseña");
        const shortPw = await (await POST(req({ ...valid, password: 12345678 }))).json();
        expect(shortPw.error).toBe("La contraseña debe tener al menos 8 caracteres");
        expect(shortPw.issues[0].path).toBe("password");
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("trims name and email before creating the admin", async () => {
        await POST(req({ ...valid, name: "  Admin ", email: " admin@example.com " }));
        expect(mockCreate.mock.calls[0][0].data).toMatchObject({ name: "Admin", email: "admin@example.com" });
    });

    it("an unexpected failure is a 500 'Error interno'", async () => {
        mockTransaction.mockRejectedValue(new Error("db down"));
        mockCount.mockResolvedValue(0);
        const res = await POST(req(valid));
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error interno" });
    });
});

describe("GET /api/setup", () => {
    it("reports setupRequired without revealing the user count", async () => {
        mockCount.mockReset().mockResolvedValue(5);
        const body = await (await GET()).json();
        expect(body).toEqual({ setupRequired: false });
    });
});
