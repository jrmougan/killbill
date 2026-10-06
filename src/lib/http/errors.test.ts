import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { HttpError, toErrorResponse, validationError, badRequest, conflict, forbidden, notFound, unauthorized } from "./errors";
import { SettlementError } from "@/lib/settlement-rules";
import { SpacePolicyError } from "@/lib/space-policy";

vi.mock("@/lib/membership", () => ({ MAX_GROUP_MEMBERS: 20 }));

class ListError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message);
        this.name = "ListError";
    }
}

describe("toErrorResponse", () => {
    it("maps an HttpError to { error, code, ...extra } + status + headers", async () => {
        const res = toErrorResponse(new HttpError(429, "Despacio", "SLOW", { retry: 1 }, { "Retry-After": "7" }));
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("7");
        expect(await res.json()).toEqual({ error: "Despacio", code: "SLOW", retry: 1 });
    });

    it("omits `code` when the HttpError has none", async () => {
        expect(await toErrorResponse(new HttpError(404, "Gasto no encontrado")).json()).toEqual({ error: "Gasto no encontrado" });
    });

    it("maps a ZodError to 400 with the first message and `issues`", async () => {
        const r = z.object({ a: z.string({ error: "Falta a" }), b: z.number({ error: "Falta b" }) }).safeParse({});
        const res = toErrorResponse(r.error);
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: "Falta a",
            issues: [{ path: "a", message: "Falta a" }, { path: "b", message: "Falta b" }],
        });
    });

    it("maps SettlementError like its toJSON() (code + extra)", async () => {
        const e = new SettlementError(409, "SETTLEMENT_EXCEEDS_DEBT", "Demasiado", { maxAmountCents: 500 });
        const res = toErrorResponse(e);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual(e.toJSON());
    });

    it("maps SpacePolicyError and other typed domain errors by name", async () => {
        const p = toErrorResponse(new SpacePolicyError("SPACE_NOT_WRITABLE", "Archivado", 409));
        expect(p.status).toBe(409);
        expect(await p.json()).toEqual({ error: "Archivado", code: "SPACE_NOT_WRITABLE" });
        const l = toErrorResponse(new ListError(404, "LIST_NOT_FOUND", "Lista no encontrada"));
        expect(l.status).toBe(404);
        expect(await l.json()).toEqual({ error: "Lista no encontrada", code: "LIST_NOT_FOUND" });
    });

    it("anything else is a logged 500 with the route's fallback message", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const res = toErrorResponse(new Error("boom"), { fallbackMessage: "Error al crear el gasto", logLabel: "X:" });
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error al crear el gasto" });
        expect(spy).toHaveBeenCalledWith("X:", expect.any(Error));
        const generic = toErrorResponse("weird");
        expect(await generic.json()).toEqual({ error: "Error interno del servidor" });
        spy.mockRestore();
    });

    it("an Error with a status but an unknown name is NOT trusted (500)", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const e = Object.assign(new Error("secret internals"), { status: 400 });
        expect(toErrorResponse(e).status).toBe(500);
        spy.mockRestore();
    });
});

describe("helpers", () => {
    it("build the usual statuses", () => {
        expect(badRequest("x").status).toBe(400);
        expect(unauthorized().message).toBe("No autorizado");
        expect(forbidden().status).toBe(403);
        expect(notFound("x").status).toBe(404);
        expect(conflict("x", "C").code).toBe("C");
    });

    it("validationError falls back to 'Petición no válida' without issues", () => {
        const e = validationError(new z.ZodError([]));
        expect(e.message).toBe("Petición no válida");
    });
});
