import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockGetActiveGroup = vi.fn();
const mockTagFindFirst = vi.fn();
const mockTagFindMany = vi.fn();
const mockTagCreate = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => mockGetSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock("@/lib/membership", () => ({ getActiveGroup: (...a: unknown[]) => mockGetActiveGroup(...a) }));
vi.mock("@/lib/db", () => ({
    prisma: {
        tag: {
            findFirst: (...a: unknown[]) => mockTagFindFirst(...a),
            findMany: (...a: unknown[]) => mockTagFindMany(...a),
            create: (...a: unknown[]) => mockTagCreate(...a),
        },
    },
}));

import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("http://localhost/api/tags", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionCtx.mockResolvedValue({ userId: "u1" });
    mockGetActiveGroup.mockResolvedValue("c1");
    mockRequireSpaceAccess.mockResolvedValue({ ok: true });
    mockTagFindFirst.mockResolvedValue(null);
    mockTagCreate.mockImplementation(async ({ data }) => ({ id: "t1", ...data }));
});

describe("POST /api/tags", () => {
    it("rejects a guest session", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        expect((await post({ name: "Viaje" })).status).toBe(403);
        expect(mockTagCreate).not.toHaveBeenCalled();
    });

    it("409 with a Spanish message on a duplicate name (UI-01)", async () => {
        mockTagFindFirst.mockResolvedValue({ id: "t0" });
        const res = await post({ name: "Vacaciones" });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe("TAG_EXISTS");
        expect(body.error).toMatch(/Ya existe una etiqueta/);
    });

    it("409 when the concurrent create loses the unique race (P2002)", async () => {
        mockTagCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
        expect((await post({ name: "Vacaciones" })).status).toBe(409);
    });

    it("400 on an empty, too long or badly coloured tag", async () => {
        expect((await post({ name: "  " })).status).toBe(400);
        expect((await post({ name: "x".repeat(41) })).status).toBe(400);
        expect((await post({ name: "ok", color: "red" })).status).toBe(400);
    });

    it("400 shapes: historical messages, issues per field, nothing written", async () => {
        const badJson = await POST(new Request("http://localhost/api/tags", { method: "POST", body: "{" }));
        expect(await badJson.json()).toEqual({ error: "Cuerpo de la petición no válido" });
        expect(await (await post({ name: 42 })).json())
            .toMatchObject({ error: "El nombre de la etiqueta es obligatorio", issues: [{ path: "name" }] });
        expect(await (await post({ name: "ok", color: 7 })).json())
            .toMatchObject({ error: "El color no es válido", issues: [{ path: "color" }] });
        expect(mockTagCreate).not.toHaveBeenCalled();
    });

    it("trims the name and defaults an empty colour", async () => {
        await post({ name: "  Casa  ", color: "", personal: true });
        expect(mockTagCreate.mock.calls[0][0].data).toEqual({ name: "Casa", color: "#8b5cf6", ownerId: "u1" });
    });

    it("authorizes a space tag against the target space (writable)", async () => {
        mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 409, error: "archivado", code: "SPACE_NOT_WRITABLE" });
        const res = await post({ name: "Casa", groupId: "c9" });
        expect(res.status).toBe(409);
        expect(mockRequireSpaceAccess.mock.calls[0][1]).toBe("c9");
        expect(mockTagCreate).not.toHaveBeenCalled();
    });

    it("creates a personal tag scoped by owner", async () => {
        const res = await post({ name: "Mía", personal: true, color: "#2F7D5B" });
        expect(res.status).toBe(201);
        expect(mockTagCreate.mock.calls[0][0].data).toEqual({ name: "Mía", color: "#2F7D5B", ownerId: "u1" });
        expect(mockRequireSpaceAccess).not.toHaveBeenCalled();
    });
});

describe("GET /api/tags", () => {
    it("a guest only sees the tags of its own space", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "g1", kind: "guest", groupId: "trip" });
        mockTagFindMany.mockResolvedValue([]);
        expect((await GET(new Request("http://localhost/api/tags"))).status).toBe(200);
        expect(mockTagFindMany.mock.calls[0][0].where).toEqual({ coupleId: "trip" });
    });
});
