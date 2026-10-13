import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";

/**
 * Opaque, revocable access tokens for MCP clients (agents, desktop apps…).
 *
 * A token is `kb_` + base64url(32 random bytes) — 256 bits of entropy, shown to
 * the user EXACTLY ONCE. The database stores only its sha256 (`tokenHash`,
 * unique) plus a short non-secret `tokenPrefix` (first 11 chars, e.g.
 * `kb_AbCdEfGh`) so the UI can identify a token without reconstructing it.
 * `expiresAt = null` means the token never expires.
 *
 * Unlike session JWTs the token carries no `tv`: "cerrar sesión en todos los
 * dispositivos" (bumpTokenVersion) revokes every active token by setting
 * `revokedAt` on its rows instead.
 */

export const ACCESS_TOKEN_PREFIX = "kb_";
export const MAX_ACTIVE_TOKENS_PER_USER = 20;
/** Allowed lifetimes in days; `null` = sin caducidad. */
export const ACCESS_TOKEN_DURATIONS = [30, 90, 365] as const;
export type AccessTokenDuration = (typeof ACCESS_TOKEN_DURATIONS)[number] | null;

/** Max length of a token's display name (matches `@db.VarChar(60)`). */
export const ACCESS_TOKEN_NAME_MAX = 60;
/** Length of the persisted, non-secret prefix (`kb_` + 8 chars). */
const PREFIX_LEN = 11;
/** `kb_` + base64url of exactly 32 bytes (43 chars, unpadded). */
const TOKEN_RE = /^kb_[A-Za-z0-9_-]{43}$/;
/** `lastUsedAt` is refreshed at most once per this window. */
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessTokenSummary = {
    id: string;
    name: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    status: "active" | "expired" | "revoked";
};

/** Typed domain error; mapped by `toErrorResponse` (by name) to `{ error, code }`. */
export class AccessTokenError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
    ) {
        super(message);
        this.name = "AccessTokenError";
    }
}

export const TOKEN_LIMIT_MESSAGE = `Has alcanzado el máximo de ${MAX_ACTIVE_TOKENS_PER_USER} tokens activos. Revoca alguno antes de crear otro.`;

/** Generate a fresh token (plaintext, shown once) with its hash and display prefix. */
export function generateAccessToken(): { token: string; hash: string; prefix: string } {
    const token = ACCESS_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    return { token, hash: hashAccessToken(token), prefix: token.slice(0, PREFIX_LEN) };
}

/** sha256 hex digest of a token — the only form persisted (`tokenHash`). */
export function hashAccessToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

type TokenRow = {
    id: string;
    name: string;
    tokenPrefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
};

const SUMMARY_SELECT = {
    id: true,
    name: true,
    tokenPrefix: true,
    createdAt: true,
    lastUsedAt: true,
    expiresAt: true,
    revokedAt: true,
} as const;

function isExpired(expiresAt: Date | null, now: Date): boolean {
    return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

function toSummary(row: TokenRow, now: Date = new Date()): AccessTokenSummary {
    return {
        id: row.id,
        name: row.name,
        prefix: row.tokenPrefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        status: row.revokedAt ? "revoked" : isExpired(row.expiresAt, now) ? "expired" : "active",
    };
}

/** Prisma filter of a user's tokens that are neither revoked nor expired at `now`. */
export function activeTokensWhere(userId: string, now: Date = new Date()) {
    return {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
}

/**
 * Create a token for `userId`. Returns the plaintext (show it once) and its
 * summary. 409 `TOKEN_LIMIT` when the user already has the max of active tokens.
 * The name/duration are re-validated here (defence in depth; the route's Zod
 * schema is the primary check).
 */
export async function createAccessToken(
    userId: string,
    input: { name: string; expiresInDays: AccessTokenDuration },
): Promise<{ token: string; summary: AccessTokenSummary }> {
    const name = input.name.trim();
    if (!name) throw new AccessTokenError(400, "INVALID_NAME", "El nombre es obligatorio");
    if (name.length > ACCESS_TOKEN_NAME_MAX) {
        throw new AccessTokenError(400, "INVALID_NAME", "El nombre es demasiado largo");
    }
    const days = input.expiresInDays;
    if (days !== null && !(ACCESS_TOKEN_DURATIONS as readonly number[]).includes(days)) {
        throw new AccessTokenError(400, "INVALID_DURATION", "Duración no válida");
    }

    const now = new Date();
    // Soft cap (no lock): two exactly concurrent creates could overshoot by one,
    // which the route's per-user rate limit keeps irrelevant.
    const active = await prisma.accessToken.count({ where: activeTokensWhere(userId, now) });
    if (active >= MAX_ACTIVE_TOKENS_PER_USER) {
        throw new AccessTokenError(409, "TOKEN_LIMIT", TOKEN_LIMIT_MESSAGE);
    }

    const { token, hash, prefix } = generateAccessToken();
    const row = await prisma.accessToken.create({
        data: {
            userId,
            name,
            tokenHash: hash,
            tokenPrefix: prefix,
            expiresAt: days === null ? null : new Date(now.getTime() + days * DAY_MS),
        },
        select: SUMMARY_SELECT,
    });
    return { token, summary: toSummary(row, now) };
}

/** Every token of `userId` (incl. revoked/expired), newest first. */
export async function listAccessTokens(userId: string): Promise<AccessTokenSummary[]> {
    const rows = await prisma.accessToken.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: SUMMARY_SELECT,
    });
    const now = new Date();
    return rows.map((r) => toSummary(r, now));
}

/**
 * Revoke one of the caller's tokens. `false` when it does not exist or belongs
 * to someone else; idempotent (`true`) when it was already revoked.
 */
export async function revokeAccessToken(userId: string, id: string): Promise<boolean> {
    const { count } = await prisma.accessToken.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (count > 0) return true;
    const existing = await prisma.accessToken.findFirst({ where: { id, userId }, select: { id: true } });
    return existing !== null;
}

/**
 * Resolve a Bearer credential to its owner. `null` for a malformed token
 * (without touching the DB), an unknown/revoked/expired one, or one whose user
 * is a guest. Refreshes `lastUsedAt` at most once per hour (fire-and-forget).
 */
export async function resolveAccessToken(token: string): Promise<{
    userId: string;
    tokenId: string;
    email: string | null;
    isAdmin: boolean;
    tokenVersion: number;
} | null> {
    if (!TOKEN_RE.test(token)) return null;

    const row = await prisma.accessToken.findUnique({
        where: { tokenHash: hashAccessToken(token) },
        include: { user: { select: { email: true, isAdmin: true, tokenVersion: true, isGuest: true } } },
    });
    const now = new Date();
    if (!row || !row.user || row.revokedAt || isExpired(row.expiresAt, now) || row.user.isGuest) return null;

    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
        const cutoff = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
        // Conditional so concurrent requests write at most once per window.
        prisma.accessToken
            .updateMany({
                where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: cutoff } }] },
                data: { lastUsedAt: now },
            })
            .catch((e: unknown) => console.error("No se pudo actualizar lastUsedAt del token:", e));
    }

    return {
        userId: row.userId,
        tokenId: row.id,
        email: row.user.email,
        isAdmin: row.user.isAdmin,
        tokenVersion: row.user.tokenVersion,
    };
}
