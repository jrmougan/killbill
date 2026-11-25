import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    aiProviderConfig: { findMany: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ default: db, prisma: db }));

import { DEFAULT_MODELS, getAiRuntimeConfig, getAiSettingsView, updateAiProviderSettings } from "./ai-settings";
import { decryptSecret, encryptSecret } from "./secret-box";

function row(provider: "GEMINI" | "OPENROUTER", encryptedApiKey: string | null, model: string | null = null) {
    return { provider, encryptedApiKey, model };
}

describe("ai-settings", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        db.aiProviderConfig.findMany.mockResolvedValue([]);
        db.aiProviderConfig.upsert.mockResolvedValue({});
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        vi.stubEnv("JWT_SECRET", "jwt-secret-for-tests");
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        vi.stubEnv("OPENROUTER_OCR_MODEL", "");
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        warn.mockRestore();
    });

    describe("precedence", () => {
        it("uses defaults and no key when nothing is configured (empty env counts as unset)", async () => {
            await expect(getAiRuntimeConfig()).resolves.toEqual({
                gemini: { apiKey: null, model: DEFAULT_MODELS.gemini },
                openrouter: { apiKey: null, model: DEFAULT_MODELS.openrouter },
            });
            const { providers } = await getAiSettingsView();
            expect(providers.map((p) => p.provider)).toEqual(["gemini", "openrouter"]);
            for (const view of providers) {
                expect(view).toMatchObject({
                    keySource: "none",
                    keyHint: null,
                    keyUndecryptable: false,
                    modelSource: "default",
                });
                expect(view.model).toBe(view.defaultModel);
            }
        });

        it("uses env over defaults", async () => {
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-AAAA");
            vi.stubEnv("OPENROUTER_API_KEY", "env-router-key-BBBB");
            vi.stubEnv("OPENROUTER_OCR_MODEL", "vendor/env-model");
            await expect(getAiRuntimeConfig()).resolves.toEqual({
                gemini: { apiKey: "env-gemini-key-AAAA", model: DEFAULT_MODELS.gemini },
                openrouter: { apiKey: "env-router-key-BBBB", model: "vendor/env-model" },
            });
            const [gemini, openrouter] = (await getAiSettingsView()).providers;
            expect(gemini).toMatchObject({ keySource: "environment", keyHint: "AAAA", modelSource: "default" });
            expect(openrouter).toMatchObject({
                keySource: "environment",
                keyHint: "BBBB",
                model: "vendor/env-model",
                modelSource: "environment",
            });
        });

        it("uses DB over env", async () => {
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-AAAA");
            vi.stubEnv("OPENROUTER_API_KEY", "env-router-key-BBBB");
            vi.stubEnv("OPENROUTER_OCR_MODEL", "vendor/env-model");
            db.aiProviderConfig.findMany.mockResolvedValue([
                row("GEMINI", encryptSecret("db-gemini-key-CCCC", "gemini"), "gemini-db"),
                row("OPENROUTER", encryptSecret("db-router-key-DDDD", "openrouter"), "vendor/db-model"),
            ]);
            await expect(getAiRuntimeConfig()).resolves.toEqual({
                gemini: { apiKey: "db-gemini-key-CCCC", model: "gemini-db" },
                openrouter: { apiKey: "db-router-key-DDDD", model: "vendor/db-model" },
            });
            const [gemini, openrouter] = (await getAiSettingsView()).providers;
            expect(gemini).toMatchObject({ keySource: "database", keyHint: "CCCC", modelSource: "database" });
            expect(openrouter).toMatchObject({
                keySource: "database",
                keyHint: "DDDD",
                modelSource: "database",
                model: "vendor/db-model",
                defaultModel: DEFAULT_MODELS.openrouter,
                fallbackModel: "vendor/env-model",
            });
            expect(gemini.fallbackModel).toBe(DEFAULT_MODELS.gemini);
        });

        it("resolves key and model independently, and null columns fall back", async () => {
            vi.stubEnv("OPENROUTER_API_KEY", "env-router-key-BBBB");
            vi.stubEnv("OPENROUTER_OCR_MODEL", "vendor/env-model");
            db.aiProviderConfig.findMany.mockResolvedValue([
                row("GEMINI", null, "gemini-db"),
                row("OPENROUTER", encryptSecret("db-router-key-DDDD", "openrouter"), null),
            ]);
            await expect(getAiRuntimeConfig()).resolves.toEqual({
                gemini: { apiKey: null, model: "gemini-db" },
                openrouter: { apiKey: "db-router-key-DDDD", model: "vendor/env-model" },
            });
        });

        it("ignores OPENROUTER_OCR_MODEL for Gemini", async () => {
            vi.stubEnv("OPENROUTER_OCR_MODEL", "vendor/env-model");
            expect((await getAiRuntimeConfig()).gemini.model).toBe(DEFAULT_MODELS.gemini);
        });
    });

    describe("view", () => {
        it("never exposes the key or its ciphertext", async () => {
            const encrypted = encryptSecret("db-gemini-key-CCCC", "gemini");
            vi.stubEnv("OPENROUTER_API_KEY", "env-router-key-BBBB");
            db.aiProviderConfig.findMany.mockResolvedValue([row("GEMINI", encrypted)]);
            const json = JSON.stringify(await getAiSettingsView());
            expect(json).not.toContain("db-gemini-key");
            expect(json).not.toContain("env-router-key");
            expect(json).not.toContain(encrypted);
        });
    });

    describe("undecryptable key", () => {
        it("falls back to env, flags it and logs no secret material", async () => {
            const encrypted = encryptSecret("db-gemini-key-CCCC", "gemini");
            vi.stubEnv("JWT_SECRET", "rotated-secret");
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-AAAA");
            db.aiProviderConfig.findMany.mockResolvedValue([row("GEMINI", encrypted, "gemini-db")]);

            const config = await getAiRuntimeConfig();
            expect(config.gemini).toEqual({ apiKey: "env-gemini-key-AAAA", model: "gemini-db" });

            const [gemini] = (await getAiSettingsView()).providers;
            expect(gemini).toMatchObject({ keySource: "environment", keyHint: "AAAA", keyUndecryptable: true });

            expect(warn).toHaveBeenCalled();
            const logged = JSON.stringify(warn.mock.calls);
            expect(logged).not.toContain(encrypted);
            expect(logged).not.toContain("env-gemini-key");
            expect(logged).not.toContain("rotated-secret");
        });

        it("reports no key when env has none either", async () => {
            db.aiProviderConfig.findMany.mockResolvedValue([row("GEMINI", "v1.garbage.garbage.garbage")]);
            expect((await getAiRuntimeConfig()).gemini.apiKey).toBeNull();
            const [gemini] = (await getAiSettingsView()).providers;
            expect(gemini).toMatchObject({ keySource: "none", keyHint: null, keyUndecryptable: true });
        });

        it("rejects a ciphertext copied from another provider's row", async () => {
            db.aiProviderConfig.findMany.mockResolvedValue([
                row("OPENROUTER", encryptSecret("db-gemini-key-CCCC", "gemini")),
            ]);
            const [, openrouter] = (await getAiSettingsView()).providers;
            expect(openrouter).toMatchObject({ keySource: "none", keyUndecryptable: true });
        });
    });

    describe("database failure", () => {
        it("logs and falls back to env", async () => {
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-AAAA");
            db.aiProviderConfig.findMany.mockRejectedValue(new Error("connect mysql://user:pw@host"));
            await expect(getAiRuntimeConfig()).resolves.toEqual({
                gemini: { apiKey: "env-gemini-key-AAAA", model: DEFAULT_MODELS.gemini },
                openrouter: { apiKey: null, model: DEFAULT_MODELS.openrouter },
            });
            expect(warn).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(warn.mock.calls)).not.toContain("user:pw");
        });

        it("reads the database on every call", async () => {
            await getAiRuntimeConfig();
            await getAiRuntimeConfig();
            expect(db.aiProviderConfig.findMany).toHaveBeenCalledTimes(2);
        });
    });

    describe("updateAiProviderSettings", () => {
        function upsertArgs() {
            return db.aiProviderConfig.upsert.mock.calls[0][0];
        }

        it("encrypts the key bound to the provider and leaves the model untouched", async () => {
            await updateAiProviderSettings("gemini", { apiKey: "new-gemini-key-EEEE" });
            const { where, create, update } = upsertArgs();
            expect(where).toEqual({ provider: "GEMINI" });
            expect(create.provider).toBe("GEMINI");
            expect(update.model).toBeUndefined();
            expect(create.model).toBeUndefined();
            expect(update.encryptedApiKey).not.toContain("new-gemini-key");
            expect(decryptSecret(update.encryptedApiKey, "gemini")).toBe("new-gemini-key-EEEE");
            expect(() => decryptSecret(update.encryptedApiKey, "openrouter")).toThrow();
        });

        it("sets the model and leaves the key untouched", async () => {
            await updateAiProviderSettings("openrouter", { model: "vendor/model" });
            const { where, update } = upsertArgs();
            expect(where).toEqual({ provider: "OPENROUTER" });
            expect(update.model).toBe("vendor/model");
            expect(update.encryptedApiKey).toBeUndefined();
        });

        it("clears a field with null", async () => {
            await updateAiProviderSettings("gemini", { apiKey: null, model: null });
            const { update } = upsertArgs();
            expect(update.encryptedApiKey).toBeNull();
            expect(update.model).toBeNull();
        });

        it("leaves a cleared field to the env on the next read", async () => {
            vi.stubEnv("GEMINI_API_KEY", "env-gemini-key-AAAA");
            await updateAiProviderSettings("gemini", { apiKey: null });
            db.aiProviderConfig.findMany.mockResolvedValue([row("GEMINI", upsertArgs().update.encryptedApiKey)]);
            expect((await getAiRuntimeConfig()).gemini.apiKey).toBe("env-gemini-key-AAAA");
        });
    });
});
