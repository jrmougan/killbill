import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionCtx = vi.fn();
const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    aiProviderConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/lib/authz", () => ({ getSessionCtx: () => mockGetSessionCtx() }));
vi.mock("@/lib/db", () => ({ default: db, prisma: db }));

import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import type { AiSettingsView } from "@/lib/ai-settings-schemas";
import { GET, PATCH } from "./route";

const ROUTE_URL = "http://localhost/api/admin/ai-settings";
const API_KEY = "sk-super-secret-value-abcd";

type Row = { provider: string; encryptedApiKey: string | null; model: string | null };

const get = () => GET(new Request(ROUTE_URL));
const patch = (body: unknown) =>
    PATCH(new Request(ROUTE_URL, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("/api/admin/ai-settings", () => {
    let rows: Map<string, Row>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        vi.stubEnv("JWT_SECRET", "jwt-secret-for-tests");
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        vi.stubEnv("OPENROUTER_OCR_MODEL", "");

        mockGetSessionCtx.mockResolvedValue({ userId: "admin1", isAdmin: true, kind: undefined });
        db.user.findUnique.mockResolvedValue({ isAdmin: true });

        // In-memory table: the real ai-settings + secret-box run against it.
        rows = new Map();
        db.aiProviderConfig.findMany.mockImplementation(async () => [...rows.values()]);
        db.aiProviderConfig.upsert.mockImplementation(async ({ where, create, update }) => {
            const current = rows.get(where.provider);
            const next = current
                ? { ...current, ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) }
                : { encryptedApiKey: null, model: null, ...Object.fromEntries(Object.entries(create).filter(([, v]) => v !== undefined)) };
            rows.set(where.provider, next as Row);
            return next;
        });
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe("authorization", () => {
        it("401 without a session, and for MCP / guest tokens", async () => {
            mockGetSessionCtx.mockResolvedValue(null);
            const anonymous = await get();
            expect(anonymous.status).toBe(401);
            expect(await anonymous.json()).toEqual({ error: "No autorizado" });
            expect((await patch({ provider: "gemini", apiKey: API_KEY })).status).toBe(401);

            for (const kind of ["mcp", "guest"]) {
                mockGetSessionCtx.mockResolvedValue({ userId: "admin1", kind });
                expect((await get()).status).toBe(401);
                expect((await patch({ provider: "gemini", apiKey: API_KEY })).status).toBe(401);
            }
            expect(db.aiProviderConfig.findMany).not.toHaveBeenCalled();
            expect(db.aiProviderConfig.upsert).not.toHaveBeenCalled();
        });

        it("403 'Acceso denegado' when the DB says the user is not an admin (JWT claim ignored)", async () => {
            db.user.findUnique.mockResolvedValue({ isAdmin: false });
            const read = await get();
            expect(read.status).toBe(403);
            expect(await read.json()).toEqual({ error: "Acceso denegado" });
            expect((await patch({ provider: "gemini", apiKey: API_KEY })).status).toBe(403);
            expect(db.aiProviderConfig.findMany).not.toHaveBeenCalled();
            expect(db.aiProviderConfig.upsert).not.toHaveBeenCalled();
        });
    });

    describe("GET", () => {
        it("returns both providers, gemini first, with the defaults when nothing is configured", async () => {
            const res = await get();
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                providers: [
                    {
                        provider: "gemini",
                        keySource: "none",
                        keyHint: null,
                        keyUndecryptable: false,
                        model: "gemini-flash-latest",
                        modelSource: "default",
                        defaultModel: "gemini-flash-latest",
                        fallbackModel: "gemini-flash-latest",
                    },
                    {
                        provider: "openrouter",
                        keySource: "none",
                        keyHint: null,
                        keyUndecryptable: false,
                        model: "xiaomi/mimo-v2.6-flash",
                        modelSource: "default",
                        defaultModel: "xiaomi/mimo-v2.6-flash",
                        fallbackModel: "xiaomi/mimo-v2.6-flash",
                    },
                ],
            });
        });

        it("never exposes a stored or env key, nor its ciphertext: only source + last-4 hint", async () => {
            const encryptedApiKey = encryptSecret(API_KEY, "gemini");
            rows.set("GEMINI", { provider: "GEMINI", encryptedApiKey, model: null });
            vi.stubEnv("OPENROUTER_API_KEY", "sk-env-secret-value-wxyz");

            const res = await get();
            const text = await res.text();

            expect(text).not.toContain(API_KEY);
            expect(text).not.toContain(encryptedApiKey);
            expect(text).not.toContain("sk-env-secret-value-wxyz");
            const { providers } = JSON.parse(text) as AiSettingsView;
            expect(providers[0]).toMatchObject({ keySource: "database", keyHint: "abcd" });
            expect(providers[1]).toMatchObject({ keySource: "environment", keyHint: "wxyz" });
        });
    });

    describe("PATCH", () => {
        it("sets a key: stored encrypted and bound to its provider, response shows only the hint", async () => {
            const res = await patch({ provider: "gemini", apiKey: API_KEY });
            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).not.toContain(API_KEY);
            expect((JSON.parse(text) as AiSettingsView).providers[0]).toMatchObject({
                provider: "gemini",
                keySource: "database",
                keyHint: "abcd",
            });

            const stored = rows.get("GEMINI")!.encryptedApiKey!;
            expect(stored).not.toContain(API_KEY);
            expect(decryptSecret(stored, "gemini")).toBe(API_KEY);
        });

        it("clears a key with null, falling back to the environment", async () => {
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-9876");
            await patch({ provider: "gemini", apiKey: API_KEY });

            const res = await patch({ provider: "gemini", apiKey: null });
            expect(res.status).toBe(200);
            const { providers } = (await res.json()) as AiSettingsView;
            expect(providers[0]).toMatchObject({ keySource: "environment", keyHint: "9876" });
            expect(rows.get("GEMINI")!.encryptedApiKey).toBeNull();
        });

        it("sets and clears a model, leaving the key untouched", async () => {
            await patch({ provider: "openrouter", apiKey: API_KEY });
            const encrypted = rows.get("OPENROUTER")!.encryptedApiKey;

            const set = await patch({ provider: "openrouter", model: "vendor/model:free" });
            expect(set.status).toBe(200);
            expect(((await set.json()) as AiSettingsView).providers[1]).toMatchObject({
                model: "vendor/model:free",
                modelSource: "database",
                keySource: "database",
            });
            expect(rows.get("OPENROUTER")!.encryptedApiKey).toBe(encrypted);

            const cleared = await patch({ provider: "openrouter", model: null });
            expect(((await cleared.json()) as AiSettingsView).providers[1]).toMatchObject({
                model: "xiaomi/mimo-v2.6-flash",
                modelSource: "default",
                keySource: "database",
            });
            expect(rows.get("OPENROUTER")!.encryptedApiKey).toBe(encrypted);
        });

        it("400 on invalid values, without echoing them and without writing", async () => {
            const invalid = [
                { provider: "gemini", apiKey: "with space-secret-value" },
                { provider: "gemini", apiKey: "short" },
                { provider: "gemini", model: "vendor/secret-model" },
                { provider: "openrouter", model: "../secret-model" },
                { provider: "secret-provider", apiKey: API_KEY },
            ];
            for (const body of invalid) {
                const res = await patch(body);
                expect(res.status).toBe(400);
                const text = await res.text();
                expect(JSON.parse(text).issues.length).toBeGreaterThan(0);
                expect(text).not.toContain("secret");
                expect(text).not.toContain("short");
            }
            expect(db.aiProviderConfig.upsert).not.toHaveBeenCalled();
        });

        it("400 on unparseable JSON, without echoing it", async () => {
            const res = await patch(`{"apiKey":"${API_KEY}"`);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: "Petición no válida" });
        });

        it("400 on an empty patch (no apiKey nor model)", async () => {
            const res = await patch({ provider: "gemini" });
            expect(res.status).toBe(400);
            expect((await res.json()).error).toBe("Indica una clave de API o un modelo");
            expect(db.aiProviderConfig.upsert).not.toHaveBeenCalled();
        });

        it("500 with the route's message when the write fails, without the key in body or logs", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => {});
            db.aiProviderConfig.upsert.mockRejectedValue(new Error("db down"));

            const res = await patch({ provider: "gemini", apiKey: API_KEY });
            expect(res.status).toBe(500);
            expect(await res.json()).toEqual({ error: "Error al guardar la configuración de IA" });
            expect(error.mock.calls.flat().map(String).join(" ")).not.toContain(API_KEY);
            error.mockRestore();
        });
    });

    describe("Cache-Control", () => {
        it("no-store on every response, errors included", async () => {
            expect((await get()).headers.get("Cache-Control")).toBe("no-store");
            expect((await patch({ provider: "gemini", model: "gemini-pro" })).headers.get("Cache-Control")).toBe("no-store");
            expect((await patch({ provider: "gemini" })).headers.get("Cache-Control")).toBe("no-store");

            mockGetSessionCtx.mockResolvedValue(null);
            expect((await get()).headers.get("Cache-Control")).toBe("no-store");
        });
    });
});
