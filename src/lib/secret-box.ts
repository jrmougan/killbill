import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets stored in the database (server only).
 * AES-256-GCM, payload "v1.<iv>.<tag>.<ciphertext>" in base64url. The AAD binds a
 * ciphertext to its row, so a value copied onto another row fails to decrypt.
 *
 * Error messages never include the plaintext, the payload or the key.
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HKDF_INFO = "killbill:ai-settings:v1";

// Resolved on every call, like jwt.ts: a missing secret fails at use time (not at
// import/build time) and a rotated secret takes effect without stale state.
function deriveKey(): Buffer {
    const secret = process.env.AI_SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("Neither AI_SETTINGS_ENCRYPTION_KEY nor JWT_SECRET is set.");
    }
    return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), HKDF_INFO, KEY_BYTES));
}

export function encryptSecret(plaintext: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, deriveKey(), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
        VERSION,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

// Buffer.from is lenient (ignores junk and a final character's unused bits), so
// require the canonical encoding: any edit of the payload must be a failure.
function decodeStrict(segment: string): Buffer {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) {
        throw new Error("Malformed encrypted secret.");
    }
    return bytes;
}

export function decryptSecret(payload: string, aad: string): string {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error("Unknown encrypted secret format.");
    }
    const iv = decodeStrict(parts[1]);
    const tag = decodeStrict(parts[2]);
    const ciphertext = decodeStrict(parts[3]);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new Error("Malformed encrypted secret.");
    }
    const decipher = createDecipheriv(ALGORITHM, deriveKey(), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
