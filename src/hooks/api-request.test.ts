import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, DEFAULT_ERROR, DEFAULT_NETWORK_ERROR } from "./api-request";

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
    it("sends a JSON body with the content-type header and returns the data", async () => {
        const fetchFn = mockFetch(async () => json({ list: { id: "l1" } }));
        const r = await apiRequest("/api/x", { method: "PATCH", body: { name: "A" } });
        expect(r).toEqual({ ok: true, status: 200, data: { list: { id: "l1" } } });
        expect(fetchFn).toHaveBeenCalledWith("/api/x", {
            method: "PATCH",
            signal: undefined,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "A" }),
        });
    });

    it("defaults to POST without a body", async () => {
        const fetchFn = mockFetch(async () => json({}));
        await apiRequest("/api/x");
        expect(fetchFn).toHaveBeenCalledWith("/api/x", { method: "POST", signal: undefined });
    });

    it("passes FormData through untouched", async () => {
        const fetchFn = mockFetch(async () => json({ success: true }));
        const fd = new FormData();
        await apiRequest("/api/upload", { body: fd });
        expect(fetchFn.mock.calls[0][1]).toEqual({ method: "POST", signal: undefined, body: fd });
    });

    it("surfaces the API error message and keeps the payload (status/code)", async () => {
        mockFetch(async () => json({ error: "Tienes saldo pendiente.", code: "HAS_BALANCE" }, 409));
        const r = await apiRequest("/api/x", { method: "DELETE" });
        expect(r).toEqual({
            ok: false,
            status: 409,
            data: { error: "Tienes saldo pendiente.", code: "HAS_BALANCE" },
            error: "Tienes saldo pendiente.",
        });
    });

    it("falls back to errorMessage for an error without a usable `error`", async () => {
        mockFetch(async () => json({ error: "" }, 500));
        expect(await apiRequest("/api/x", { errorMessage: "No se pudo" })).toMatchObject({ ok: false, error: "No se pudo" });
        mockFetch(async () => new Response("<html>", { status: 502 }));
        expect(await apiRequest("/api/x")).toMatchObject({ ok: false, status: 502, data: null, error: DEFAULT_ERROR });
    });

    it("maps a rejected fetch to a network error (status 0)", async () => {
        mockFetch(async () => {
            throw new TypeError("Failed to fetch");
        });
        expect(await apiRequest("/api/x")).toEqual({ ok: false, status: 0, data: null, error: DEFAULT_NETWORK_ERROR });
        expect(await apiRequest("/api/x", { networkErrorMessage: "Error de conexión" })).toMatchObject({ error: "Error de conexión" });
    });

    it("tolerates an empty 2xx body", async () => {
        mockFetch(async () => new Response(null, { status: 204 }));
        expect(await apiRequest("/api/x")).toEqual({ ok: true, status: 204, data: null });
    });
});
