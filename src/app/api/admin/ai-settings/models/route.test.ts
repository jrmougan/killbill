import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    aiProviderConfig: { findMany: vi.fn() },
}));

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/db", () => ({ default: db, prisma: db }));

import { _resetRateLimitStore } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/secret-box";
import { GET } from "./route";

const ROUTE_URL = "http://localhost/api/admin/ai-settings/models";
const API_KEY = "sk-super-secret-value-abcd";

const fetchMock = vi.fn();
const get = (query = "?provider=gemini") => GET(new Request(`${ROUTE_URL}${query}`));
const upstream = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// The real ai-models + ai-settings + secret-box run; only the DB and fetch are faked.
describe("GET /api/admin/ai-settings/models", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetRateLimitStore();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        vi.stubEnv("JWT_SECRET", "jwt-secret-for-tests");
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        vi.stubEnv("OCR_TEST_PROVIDER_URL", "");
        vi.stubEnv("TEST_ROUTES_ENABLED", "");
        vi.spyOn(console, "warn").mockImplementation(() => {});

        mockGetSessionCtx.mockResolvedValue({ userId: "admin1", isAdmin: true, kind: undefined });
        db.user.findUnique.mockResolvedValue({ isAdmin: true });
        db.aiProviderConfig.findMany.mockResolvedValue([
            { provider: "GEMINI", encryptedApiKey: encryptSecret(API_KEY, "gemini"), model: null },
        ]);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("authorization", () => {
        it("401 without a session, and for MCP / guest tokens, without calling the provider", async () => {
            mockGetSessionCtx.mockResolvedValue(null);
            const anonymous = await get();
            expect(anonymous.status).toBe(401);
            expect(await anonymous.json()).toEqual({ error: "No autorizado" });
            expect(anonymous.headers.get("Cache-Control")).toBe("no-store");

            for (const kind of ["mcp", "guest"]) {
                mockGetSessionCtx.mockResolvedValue({ userId: "admin1", kind });
                expect((await get()).status).toBe(401);
            }
            expect(fetchMock).not.toHaveBeenCalled();
            expect(db.aiProviderConfig.findMany).not.toHaveBeenCalled();
        });

        it("403 'Acceso denegado' for a non-admin, without calling the provider", async () => {
            db.user.findUnique.mockResolvedValue({ isAdmin: false });
            const res = await get();
            expect(res.status).toBe(403);
            expect(await res.json()).toEqual({ error: "Acceso denegado" });
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    describe("query validation", () => {
        it.each(["", "?provider=", "?provider=openai", "?provider=GEMINI"])("400 for %j", async (query) => {
            const res = await get(query);
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error).toBe("Proveedor no válido");
            expect(body.issues[0].path).toBe("provider");
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });

    it("lists the Gemini vision models with the stored key, which never reaches the response", async () => {
        fetchMock.mockResolvedValueOnce(
            upstream({
                models: [
                    { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
                    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
                ],
            }),
        );

        const res = await get();

        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        const text = await res.text();
        expect(text).not.toContain(API_KEY);
        expect(JSON.parse(text)).toEqual({
            provider: "gemini",
            models: [
                { id: "gemini-flash-latest", label: "gemini-flash-latest" },
                { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            ],
        });
        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe(API_KEY);
        expect(String(fetchMock.mock.calls[0][0])).not.toContain(API_KEY);
    });

    it("lists OpenRouter without any key", async () => {
        db.aiProviderConfig.findMany.mockResolvedValue([]);
        fetchMock.mockResolvedValueOnce(
            upstream({
                data: [
                    {
                        id: "vendor/vision",
                        name: "Vendor: Vision",
                        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
                        supported_parameters: ["structured_outputs"],
                        endpoints: ["/api/v1/chat/completions"],
                    },
                ],
            }),
        );

        const res = await get("?provider=openrouter");

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ provider: "openrouter", models: [{ id: "vendor/vision", label: "Vendor: Vision" }] });
    });

    it("409 AI_KEY_MISSING when Gemini has no key, without calling Google", async () => {
        db.aiProviderConfig.findMany.mockResolvedValue([]);
        const res = await get();
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
            error: "Configura primero una clave de API para ver los modelos",
            code: "AI_KEY_MISSING",
        });
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("422 AI_KEY_REJECTED when the provider refuses the key; its body and the key stay out", async () => {
        fetchMock.mockResolvedValueOnce(
            upstream({ error: { code: 400, message: `API key not valid: ${API_KEY}`, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400),
        );
        const res = await get();
        expect(res.status).toBe(422);
        const text = await res.text();
        expect(JSON.parse(text)).toEqual({
            error: "El proveedor ha rechazado la clave de API: no es válida o no tiene permiso",
            code: "AI_KEY_REJECTED",
        });
        expect(text).not.toContain(API_KEY);
        expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(API_KEY);
    });

    it("503 AI_PROVIDER_RATE_LIMITED when the provider answers 429", async () => {
        fetchMock.mockResolvedValueOnce(upstream({ error: { status: "RESOURCE_EXHAUSTED" } }, 429));
        const res = await get();
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({
            error: "El proveedor ha limitado las solicitudes. Inténtalo más tarde",
            code: "AI_PROVIDER_RATE_LIMITED",
        });
    });

    it("502 AI_PROVIDER_UNAVAILABLE on a provider 5xx or a timeout", async () => {
        fetchMock
            .mockResolvedValueOnce(upstream({ error: {} }, 500))
            .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
        for (let i = 0; i < 2; i++) {
            const res = await get();
            expect(res.status).toBe(502);
            expect(await res.json()).toEqual({
                error: "No se pudo obtener la lista de modelos del proveedor",
                code: "AI_PROVIDER_UNAVAILABLE",
            });
        }
    });

    it("500 with the route's message on an unexpected failure", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.stubEnv("OCR_TEST_PROVIDER_URL", "http://127.0.0.1:4567");
        const res = await get();
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: "Error al obtener los modelos de IA" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("429 after 30 listings in a minute by the same admin", async () => {
        fetchMock.mockImplementation(async () => upstream({ models: [] }));
        for (let i = 0; i < 30; i++) expect((await get()).status).toBe(200);
        const res = await get();
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(30);
    });
});
