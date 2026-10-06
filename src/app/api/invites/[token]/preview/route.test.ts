import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockRateLimit = vi.fn();
const mockEphemeralEnabled = vi.fn();

vi.mock("@/lib/db", () => ({
    prisma: { groupInvite: { findUnique: (...a: unknown[]) => mockFindUnique(...a) } },
}));
vi.mock("@/lib/rate-limit", () => ({
    rateLimit: (...a: unknown[]) => mockRateLimit(...a),
    getClientIp: () => "9.9.9.9",
}));
vi.mock("@/lib/flags", () => ({ ephemeralSpacesEnabled: () => mockEphemeralEnabled() }));

import { GET } from "./route";

const future = new Date(Date.now() + 60 * 60 * 1000);
const preview = (token: string) =>
    GET(new Request(`http://localhost/api/invites/${token}/preview`), { params: Promise.resolve({ token }) });

describe("GET /api/invites/[token]/preview", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
        mockEphemeralEnabled.mockReturnValue(false);
    });

    it("rate-limits by IP before any lookup: 429 + Retry-After", async () => {
        mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 77 });
        const res = await preview("abc");
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("77");
        expect(await res.json()).toEqual({ error: "Demasiadas solicitudes. Inténtalo de nuevo más tarde." });
        expect(mockRateLimit).toHaveBeenCalledWith("invite-preview:9.9.9.9", 30, 5 * 60 * 1000);
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it("404 NOT_FOUND for an unknown token, with no-referrer", async () => {
        mockFindUnique.mockResolvedValue(null);
        const res = await preview("nope");
        expect(res.status).toBe(404);
        expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(await res.json()).toEqual({ valid: false, reason: "NOT_FOUND", error: "Enlace de invitación no encontrado" });
    });

    it("previews a valid MEMBER invite (name/type only)", async () => {
        mockFindUnique.mockResolvedValue({
            kind: "MEMBER", maxUses: 5, usedCount: 0, expiresAt: future, revokedAt: null,
            group: { id: "g1", name: "Casa", type: "GROUP", status: "ACTIVE" },
        });
        const res = await preview("tok");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ valid: true, kind: "MEMBER", space: { name: "Casa", type: "GROUP" } });
    });

    it("a lookup failure is a JSON 500, not an unhandled throw", async () => {
        mockFindUnique.mockRejectedValue(new Error("db down"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await preview("tok");
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error al comprobar la invitación" });
    });
});
