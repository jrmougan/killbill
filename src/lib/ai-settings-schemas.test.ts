import { describe, expect, it } from "vitest";
import { UpdateAiSettingsBody } from "./ai-settings-schemas";

const VALID_KEY = "sk-valid-key-1234";

describe("UpdateAiSettingsBody", () => {
    it("accepts a key, a model, or both, and keeps undefined vs null apart", () => {
        expect(UpdateAiSettingsBody.parse({ provider: "gemini", apiKey: VALID_KEY })).toEqual({
            provider: "gemini",
            apiKey: VALID_KEY,
        });
        expect(UpdateAiSettingsBody.parse({ provider: "gemini", apiKey: null })).toEqual({
            provider: "gemini",
            apiKey: null,
        });
        expect(UpdateAiSettingsBody.parse({ provider: "openrouter", model: null })).toEqual({
            provider: "openrouter",
            model: null,
        });
        expect(UpdateAiSettingsBody.parse({ provider: "openrouter", apiKey: VALID_KEY, model: "a/b" })).toEqual({
            provider: "openrouter",
            apiKey: VALID_KEY,
            model: "a/b",
        });
    });

    it("requires at least one of apiKey/model", () => {
        expect(UpdateAiSettingsBody.safeParse({ provider: "gemini" }).success).toBe(false);
    });

    it.each([null, [], "x", 3])("rejects the non-object body %j", (body) => {
        expect(UpdateAiSettingsBody.safeParse(body).success).toBe(false);
    });

    it("rejects an unknown provider", () => {
        const result = UpdateAiSettingsBody.safeParse({ provider: "openai", model: "x" });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe("Proveedor no válido");
    });

    it("trims the key", () => {
        expect(UpdateAiSettingsBody.parse({ provider: "gemini", apiKey: `  ${VALID_KEY}\n` }).apiKey).toBe(VALID_KEY);
    });

    it.each([
        ["too short", "short12"],
        ["too long", "x".repeat(513)],
        ["inner space", "sk-valid key-1234"],
        ["inner tab", "sk-valid\tkey-1234"],
        ["inner newline", "sk-valid\nkey-1234"],
        ["non-ASCII", "sk-válid-key-1234"],
        ["not a string", 12345678],
    ])("rejects a key: %s", (_label, apiKey) => {
        expect(UpdateAiSettingsBody.safeParse({ provider: "gemini", apiKey }).success).toBe(false);
    });

    it("accepts the key length bounds", () => {
        for (const apiKey of ["x".repeat(8), "x".repeat(512)]) {
            expect(UpdateAiSettingsBody.safeParse({ provider: "gemini", apiKey }).success).toBe(true);
        }
    });

    it("validates the model per provider", () => {
        const ok = (provider: string, model: unknown) =>
            UpdateAiSettingsBody.safeParse({ provider, model }).success;
        expect(ok("gemini", "gemini-2.5-flash")).toBe(true);
        expect(ok("gemini", "vendor/model")).toBe(false);
        expect(ok("gemini", "../secrets")).toBe(false);
        expect(ok("openrouter", "xiaomi/mimo-v2.6-flash:free")).toBe(true);
        for (const provider of ["gemini", "openrouter"]) {
            expect(ok(provider, "")).toBe(false);
            expect(ok(provider, "has space")).toBe(false);
            expect(ok(provider, "-leading")).toBe(false);
            expect(ok(provider, "x".repeat(129))).toBe(false);
            expect(ok(provider, "x".repeat(128))).toBe(true);
            expect(ok(provider, 42)).toBe(false);
        }
    });

    it("never echoes the submitted value in error messages", () => {
        const secret = "sk leaked value 1234";
        for (const body of [
            { provider: "gemini", apiKey: secret },
            { provider: "gemini", model: secret },
            { provider: secret, apiKey: secret },
        ]) {
            const result = UpdateAiSettingsBody.safeParse(body);
            expect(result.success).toBe(false);
            expect(JSON.stringify(result.error?.issues)).not.toContain("leaked");
        }
    });
});
