import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
    $transaction: vi.fn(),
    user: { update: vi.fn(), findUnique: vi.fn() },
    accessToken: { updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { bumpTokenVersion } from "./token-version";

const NOW = new Date("2026-10-07T12:00:00.000Z");

describe("bumpTokenVersion", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        db.user.update.mockReturnValue("user-op");
        db.accessToken.updateMany.mockReturnValue("tokens-op");
        db.$transaction.mockResolvedValue([{ tokenVersion: 5 }, { count: 2 }]);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("bumps tokenVersion and revokes the active access tokens in one transaction", async () => {
        expect(await bumpTokenVersion("u1")).toBe(5);
        expect(db.user.update).toHaveBeenCalledWith({
            where: { id: "u1" },
            data: { tokenVersion: { increment: 1 } },
            select: { tokenVersion: true },
        });
        expect(db.accessToken.updateMany).toHaveBeenCalledWith({
            where: { userId: "u1", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
            data: { revokedAt: NOW },
        });
        expect(db.$transaction).toHaveBeenCalledWith(["user-op", "tokens-op"]);
    });

    it("propagates a failed transaction", async () => {
        db.$transaction.mockRejectedValue(new Error("db down"));
        await expect(bumpTokenVersion("u1")).rejects.toThrow("db down");
    });
});
