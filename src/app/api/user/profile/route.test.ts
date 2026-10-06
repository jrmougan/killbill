import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockUserUpdate = vi.fn();

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { update: (...a: unknown[]) => mockUserUpdate(...a) } } }));

import { PATCH } from "./route";

const patch = (body: unknown) =>
    PATCH(new Request("http://localhost/api/user/profile", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    mockUserUpdate.mockImplementation(async ({ data }) => ({ id: "u1", ...data }));
});

describe("PATCH /api/user/profile", () => {
    it("401 without a session, 403 for a guest", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        expect((await patch({ name: "A" })).status).toBe(401);
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        expect((await patch({ name: "A" })).status).toBe(403);
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("400 (not 500) on a very long name (UI-01)", async () => {
        const res = await patch({ name: "x".repeat(200) });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/no puede superar/);
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("400 on an empty name or an invalid avatar", async () => {
        expect((await patch({ name: "  " })).status).toBe(400);
        expect((await patch({ name: "Ana", avatar: "x".repeat(300) })).status).toBe(400);
    });

    it("400 shapes: historical messages + issues, nothing written", async () => {
        const badJson = await PATCH(new Request("http://localhost/api/user/profile", { method: "PATCH", body: "{" }));
        expect(await badJson.json()).toEqual({ error: "Cuerpo de la petición no válido" });
        expect(await (await patch({ name: 7 })).json()).toMatchObject({ error: "El nombre es obligatorio", issues: [{ path: "name" }] });
        expect(await (await patch({ name: "Ana", avatar: 5 })).json()).toMatchObject({ error: "El avatar no es válido", issues: [{ path: "avatar" }] });
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("an empty avatar keeps the current one", async () => {
        await patch({ name: "Ana", avatar: "" });
        expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ name: "Ana", avatar: undefined });
    });

    it("updates the trimmed name", async () => {
        const res = await patch({ name: "  Ana  ", avatar: "🐱" });
        expect(res.status).toBe(200);
        expect(mockUserUpdate.mock.calls[0][0].data).toEqual({ name: "Ana", avatar: "🐱" });
    });
});
