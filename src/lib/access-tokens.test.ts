import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    accessToken: {
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
    },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import {
    ACCESS_TOKEN_PREFIX,
    AccessTokenError,
    MAX_ACTIVE_TOKENS_PER_USER,
    TOKEN_LIMIT_MESSAGE,
    createAccessToken,
    generateAccessToken,
    hashAccessToken,
    listAccessTokens,
    resolveAccessToken,
    revokeAccessToken,
} from "./access-tokens";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function row(over: Record<string, unknown> = {}) {
    return {
        id: "t1",
        name: "Portátil",
        tokenPrefix: "kb_AbCdEfGh",
        createdAt: new Date(NOW.getTime() - DAY),
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        ...over,
    };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    for (const fn of Object.values(db.accessToken)) fn.mockReset();
    db.accessToken.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.useRealTimers());

describe("generateAccessToken / hashAccessToken", () => {
    it("generates kb_ + 43 base64url chars, its sha256 and an 11-char prefix", () => {
        const { token, hash, prefix } = generateAccessToken();
        expect(token).toMatch(/^kb_[A-Za-z0-9_-]{43}$/);
        expect(token.startsWith(ACCESS_TOKEN_PREFIX)).toBe(true);
        expect(hash).toBe(hashAccessToken(token));
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        expect(prefix).toBe(token.slice(0, 11));
        expect(generateAccessToken().token).not.toBe(token);
    });

    it("hashes deterministically (sha256 hex)", () => {
        expect(hashAccessToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
});

describe("createAccessToken", () => {
    beforeEach(() => {
        db.accessToken.count.mockResolvedValue(0);
        db.accessToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
            row({ id: "new", name: data.name, tokenPrefix: data.tokenPrefix, createdAt: NOW, expiresAt: data.expiresAt }),
        );
    });

    it("stores only hash + prefix and returns the plaintext once with its summary", async () => {
        const { token, summary } = await createAccessToken("u1", { name: "  Claude Desktop  ", expiresInDays: 90 });
        const data = db.accessToken.create.mock.calls[0][0].data;
        expect(data).toEqual({
            userId: "u1",
            name: "Claude Desktop",
            tokenHash: hashAccessToken(token),
            tokenPrefix: token.slice(0, 11),
            expiresAt: new Date(NOW.getTime() + 90 * DAY),
        });
        expect(JSON.stringify(data)).not.toContain(token);
        expect(summary).toEqual({
            id: "new",
            name: "Claude Desktop",
            prefix: token.slice(0, 11),
            createdAt: NOW.toISOString(),
            lastUsedAt: null,
            expiresAt: new Date(NOW.getTime() + 90 * DAY).toISOString(),
            status: "active",
        });
    });

    it("null duration = no expiry", async () => {
        const { summary } = await createAccessToken("u1", { name: "x", expiresInDays: null });
        expect(db.accessToken.create.mock.calls[0][0].data.expiresAt).toBeNull();
        expect(summary.expiresAt).toBeNull();
    });

    it("counts only non-revoked, non-expired tokens of the user", async () => {
        await createAccessToken("u1", { name: "x", expiresInDays: 30 });
        expect(db.accessToken.count).toHaveBeenCalledWith({
            where: { userId: "u1", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
        });
    });

    it("409 TOKEN_LIMIT at the max of active tokens", async () => {
        db.accessToken.count.mockResolvedValue(MAX_ACTIVE_TOKENS_PER_USER);
        const err = await createAccessToken("u1", { name: "x", expiresInDays: 30 }).catch((e) => e);
        expect(err).toBeInstanceOf(AccessTokenError);
        expect(err).toMatchObject({ status: 409, code: "TOKEN_LIMIT", message: TOKEN_LIMIT_MESSAGE, name: "AccessTokenError" });
        expect(TOKEN_LIMIT_MESSAGE).toBe("Has alcanzado el máximo de 20 tokens activos. Revoca alguno antes de crear otro.");
        expect(db.accessToken.create).not.toHaveBeenCalled();
    });

    it("400 on an empty/too long name or an unknown duration", async () => {
        await expect(createAccessToken("u1", { name: "   ", expiresInDays: 30 })).rejects.toMatchObject({ status: 400 });
        await expect(createAccessToken("u1", { name: "x".repeat(61), expiresInDays: 30 })).rejects.toMatchObject({
            status: 400,
        });
        await expect(
            createAccessToken("u1", { name: "x", expiresInDays: 7 as unknown as 30 }),
        ).rejects.toMatchObject({ status: 400, code: "INVALID_DURATION" });
        expect(db.accessToken.create).not.toHaveBeenCalled();
    });
});

describe("listAccessTokens", () => {
    it("lists newest first with a computed status", async () => {
        db.accessToken.findMany.mockResolvedValue([
            row({ id: "a" }),
            row({ id: "b", expiresAt: new Date(NOW.getTime() - 1) }),
            row({ id: "c", expiresAt: NOW }),
            row({ id: "d", revokedAt: new Date(NOW.getTime() - HOUR), expiresAt: new Date(NOW.getTime() - 1) }),
            row({ id: "e", expiresAt: new Date(NOW.getTime() + DAY), lastUsedAt: NOW }),
        ]);
        const list = await listAccessTokens("u1");
        expect(db.accessToken.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: "u1" }, orderBy: { createdAt: "desc" } });
        expect(list.map((t) => [t.id, t.status])).toEqual([
            ["a", "active"],
            ["b", "expired"],
            ["c", "expired"],
            ["d", "revoked"],
            ["e", "active"],
        ]);
        expect(list[4].lastUsedAt).toBe(NOW.toISOString());
        expect(Object.keys(list[0])).not.toContain("tokenHash");
    });
});

describe("revokeAccessToken", () => {
    it("revokes an own active token", async () => {
        expect(await revokeAccessToken("u1", "t1")).toBe(true);
        expect(db.accessToken.updateMany).toHaveBeenCalledWith({
            where: { id: "t1", userId: "u1", revokedAt: null },
            data: { revokedAt: NOW },
        });
        expect(db.accessToken.findFirst).not.toHaveBeenCalled();
    });

    it("is idempotent for an own already-revoked token", async () => {
        db.accessToken.updateMany.mockResolvedValue({ count: 0 });
        db.accessToken.findFirst.mockResolvedValue({ id: "t1" });
        expect(await revokeAccessToken("u1", "t1")).toBe(true);
        expect(db.accessToken.findFirst).toHaveBeenCalledWith({ where: { id: "t1", userId: "u1" }, select: { id: true } });
    });

    it("false for an unknown or someone else's token", async () => {
        db.accessToken.updateMany.mockResolvedValue({ count: 0 });
        db.accessToken.findFirst.mockResolvedValue(null);
        expect(await revokeAccessToken("u1", "other")).toBe(false);
    });
});

describe("resolveAccessToken", () => {
    const token = `kb_${"a".repeat(43)}`;
    const user = { email: "a@b.c", isAdmin: false, tokenVersion: 2, isGuest: false };
    const found = (over: Record<string, unknown> = {}) => ({
        ...row({ lastUsedAt: new Date(NOW.getTime() - 10 * 60 * 1000) }),
        userId: "u1",
        user,
        ...over,
    });

    it("rejects a malformed token without touching the DB", async () => {
        for (const bad of ["", "kb_", `kb_${"a".repeat(42)}`, `kb_${"a".repeat(44)}`, `xx_${"a".repeat(43)}`, `kb_${"a".repeat(42)}=`, "eyJ.a.b"]) {
            expect(await resolveAccessToken(bad)).toBeNull();
        }
        expect(db.accessToken.findUnique).not.toHaveBeenCalled();
    });

    it("resolves a valid token by its hash", async () => {
        db.accessToken.findUnique.mockResolvedValue(found());
        expect(await resolveAccessToken(token)).toEqual({
            userId: "u1",
            tokenId: "t1",
            email: "a@b.c",
            isAdmin: false,
            tokenVersion: 2,
        });
        expect(db.accessToken.findUnique).toHaveBeenCalledWith({
            where: { tokenHash: hashAccessToken(token) },
            include: { user: { select: { email: true, isAdmin: true, tokenVersion: true, isGuest: true } } },
        });
    });

    it("null for unknown, revoked, expired (incl. exactly now) and guest-owned tokens", async () => {
        db.accessToken.findUnique.mockResolvedValueOnce(null);
        expect(await resolveAccessToken(token)).toBeNull();
        db.accessToken.findUnique.mockResolvedValueOnce(found({ revokedAt: new Date(NOW.getTime() - 1) }));
        expect(await resolveAccessToken(token)).toBeNull();
        db.accessToken.findUnique.mockResolvedValueOnce(found({ expiresAt: NOW }));
        expect(await resolveAccessToken(token)).toBeNull();
        db.accessToken.findUnique.mockResolvedValueOnce(found({ user: { ...user, isGuest: true } }));
        expect(await resolveAccessToken(token)).toBeNull();
        expect(db.accessToken.updateMany).not.toHaveBeenCalled();
    });

    it("accepts a token that expires in the future", async () => {
        db.accessToken.findUnique.mockResolvedValue(found({ expiresAt: new Date(NOW.getTime() + 1000) }));
        expect(await resolveAccessToken(token)).not.toBeNull();
    });

    it("does not touch lastUsedAt when it was refreshed less than an hour ago", async () => {
        db.accessToken.findUnique.mockResolvedValue(found());
        await resolveAccessToken(token);
        expect(db.accessToken.updateMany).not.toHaveBeenCalled();
    });

    it("refreshes a stale/never-set lastUsedAt with a conditional updateMany", async () => {
        db.accessToken.findUnique.mockResolvedValue(found({ lastUsedAt: null }));
        await resolveAccessToken(token);
        db.accessToken.findUnique.mockResolvedValue(found({ lastUsedAt: new Date(NOW.getTime() - 2 * HOUR) }));
        await resolveAccessToken(token);
        expect(db.accessToken.updateMany).toHaveBeenCalledTimes(2);
        expect(db.accessToken.updateMany).toHaveBeenCalledWith({
            where: { id: "t1", OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: new Date(NOW.getTime() - HOUR) } }] },
            data: { lastUsedAt: NOW },
        });
    });

    it("a failing lastUsedAt update never fails the request", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        db.accessToken.findUnique.mockResolvedValue(found({ lastUsedAt: null }));
        db.accessToken.updateMany.mockRejectedValue(new Error("db down"));
        expect(await resolveAccessToken(token)).not.toBeNull();
        await vi.waitFor(() => expect(spy).toHaveBeenCalled());
        spy.mockRestore();
    });
});
