import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./secret-box";

const AAD = "gemini";

function flipFirstChar(segment: string): string {
    return (segment[0] === "A" ? "B" : "A") + segment.slice(1);
}

describe("secret-box", () => {
    beforeEach(() => {
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        vi.stubEnv("JWT_SECRET", "jwt-secret-for-tests");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("round-trips and uses the v1 format with a 12-byte IV", () => {
        const payload = encryptSecret("sk-secret-value", AAD);
        const [version, iv, tag, ciphertext] = payload.split(".");
        expect(version).toBe("v1");
        expect(Buffer.from(iv, "base64url")).toHaveLength(12);
        expect(Buffer.from(tag, "base64url")).toHaveLength(16);
        expect(payload).not.toContain("sk-secret-value");
        expect(ciphertext.length).toBeGreaterThan(0);
        expect(decryptSecret(payload, AAD)).toBe("sk-secret-value");
    });

    it("uses a random IV per encryption", () => {
        expect(encryptSecret("same", AAD)).not.toBe(encryptSecret("same", AAD));
    });

    it.each([1, 2, 3])("rejects a tampered segment %i", (index) => {
        const parts = encryptSecret("sk-secret-value", AAD).split(".");
        parts[index] = flipFirstChar(parts[index]);
        expect(() => decryptSecret(parts.join("."), AAD)).toThrow();
    });

    it("rejects a non-canonical final base64url character", () => {
        const parts = encryptSecret("sk-secret-value", AAD).split(".");
        // A 16-byte tag leaves 4 unused bits in its last character: lenient decoding
        // would yield the same bytes, so this edit must be caught by the format check.
        const last = parts[2].at(-1) as string;
        parts[2] = parts[2].slice(0, -1) + (last === "Q" ? "R" : String.fromCharCode(last.charCodeAt(0) + 1));
        expect(() => decryptSecret(parts.join("."), AAD)).toThrow();
    });

    it("rejects the wrong AAD", () => {
        const payload = encryptSecret("sk-secret-value", "gemini");
        expect(() => decryptSecret(payload, "openrouter")).toThrow();
    });

    it("rejects an unknown version and malformed payloads", () => {
        const payload = encryptSecret("sk-secret-value", AAD);
        expect(() => decryptSecret(payload.replace(/^v1/, "v2"), AAD)).toThrow();
        expect(() => decryptSecret("not-a-payload", AAD)).toThrow();
        expect(() => decryptSecret("v1.a.b", AAD)).toThrow();
    });

    it("rejects a payload encrypted under another secret", () => {
        const payload = encryptSecret("sk-secret-value", AAD);
        vi.stubEnv("JWT_SECRET", "rotated-secret");
        expect(() => decryptSecret(payload, AAD)).toThrow();
    });

    it("prefers AI_SETTINGS_ENCRYPTION_KEY over JWT_SECRET", () => {
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "dedicated-key");
        const payload = encryptSecret("sk-secret-value", AAD);
        vi.stubEnv("JWT_SECRET", "rotated-secret");
        expect(decryptSecret(payload, AAD)).toBe("sk-secret-value");
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        expect(() => decryptSecret(payload, AAD)).toThrow();
    });

    it("throws without any secret, and errors never carry the plaintext", () => {
        vi.stubEnv("JWT_SECRET", "");
        expect(() => encryptSecret("sk-secret-value", AAD)).toThrow(/JWT_SECRET/);
        try {
            encryptSecret("sk-secret-value", AAD);
        } catch (error) {
            expect(String(error)).not.toContain("sk-secret-value");
        }
    });
});
