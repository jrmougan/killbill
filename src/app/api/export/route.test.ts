import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const mockRequireSpaceAccess = vi.fn();
const mockGetActiveGroup = vi.fn();
const mockExpenseFindMany = vi.fn();

vi.mock("@/lib/authz", () => ({
    getSessionCtx: () => mockGetSessionCtx(),
    requireSpaceAccess: (...a: unknown[]) => mockRequireSpaceAccess(...a),
}));
vi.mock("@/lib/membership", () => ({ getActiveGroup: (...a: unknown[]) => mockGetActiveGroup(...a) }));
vi.mock("@/lib/db", () => ({
    prisma: { expense: { findMany: (...a: unknown[]) => mockExpenseFindMany(...a) } },
}));

import { GET } from "./route";

const get = (qs = "") => GET(new Request(`http://localhost/api/export${qs}`));

describe("GET /api/export", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSessionCtx.mockResolvedValue({ userId: "u1", isAdmin: false, kind: undefined });
        mockGetActiveGroup.mockResolvedValue("g1");
        mockRequireSpaceAccess.mockResolvedValue({ ok: true });
        mockExpenseFindMany.mockResolvedValue([]);
    });

    it("401 'Unauthorized' without a session", async () => {
        mockGetSessionCtx.mockResolvedValue(null);
        const res = await get();
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "Unauthorized" });
    });

    it("403 for guests (member-only action)", async () => {
        mockGetSessionCtx.mockResolvedValue({ userId: "g", kind: "guest", groupId: "e1" });
        const res = await get();
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Acción no permitida para invitados" });
    });

    it("400 without an active space (shared export)", async () => {
        mockGetActiveGroup.mockResolvedValue(null);
        const res = await get();
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "No tienes ningún espacio activo" });
    });

    it("authorizes the shared export against the active space (archived allowed)", async () => {
        mockRequireSpaceAccess.mockResolvedValue({ ok: false, status: 403, error: "No eres miembro" });
        const res = await get();
        expect(res.status).toBe(403);
        expect(mockRequireSpaceAccess).toHaveBeenCalledWith(expect.anything(), "g1", { allowArchived: true });
        expect(mockExpenseFindMany).not.toHaveBeenCalled();
    });

    it("returns CSV with the shared filename and an inclusive date range", async () => {
        const res = await get("?from=2025-01-01&to=2025-01-31");
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
        expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=gastos.csv");
        expect(await res.text()).toBe("fecha,descripcion,importe,categoria,pagado_por,mi_parte,notas");
        const where = mockExpenseFindMany.mock.calls[0][0].where;
        expect(where).toMatchObject({ coupleId: "g1", visibility: "SHARED" });
        expect(where.date.gte).toEqual(new Date("2025-01-01"));
        expect(where.date.lt).toEqual(new Date("2025-02-01"));
    });

    it("personal scope exports the caller's PERSONAL expenses without a space", async () => {
        mockGetActiveGroup.mockResolvedValue(null);
        const res = await get("?scope=personal&from=");
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toBe("attachment; filename=gastos-personales.csv");
        expect(mockExpenseFindMany.mock.calls[0][0].where).toEqual({ ownerId: "u1", visibility: "PERSONAL" });
    });

    it("400 on an unparseable date (it used to reach Prisma and 500)", async () => {
        const res = await get("?from=no-es-fecha");
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("Fecha inválida");
        expect(body.issues[0].path).toBe("from");
        expect(mockExpenseFindMany).not.toHaveBeenCalled();
    });
});
