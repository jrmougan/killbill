// @vitest-environment node
// jwt.ts runs in the Next.js (node) server runtime. jose's Uint8Array
// instanceof checks fail under jsdom due to cross-realm typed arrays, so
// pin this file to the node environment.
import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken, signGuestToken, refreshGuestToken, GUEST_SESSION_SECONDS } from './jwt';

describe('jwt utilities', () => {
    beforeAll(() => {
        // jwt.ts resolves JWT_SECRET lazily at sign/verify time.
        process.env.JWT_SECRET = 'test-secret-for-vitest';
    });

    it('should round-trip a payload through sign and verify', async () => {
        const token = await signToken({ userId: 'user1' });
        expect(typeof token).toBe('string');

        const payload = await verifyToken(token);
        expect(payload).not.toBeNull();
        expect(payload?.userId).toBe('user1');
    });

    it('should set standard JWT claims (iat, exp)', async () => {
        const token = await signToken({ userId: 'user2' });
        const payload = await verifyToken(token);
        expect(payload?.iat).toBeTypeOf('number');
        expect(payload?.exp).toBeTypeOf('number');
        // 7d expiry should be in the future relative to issued-at.
        expect((payload!.exp as number)).toBeGreaterThan(payload!.iat as number);
    });

    it('should return null for a tampered token', async () => {
        const token = await signToken({ userId: 'user1' });
        // Flip the FIRST character of the signature segment. Flipping the last
        // base64url char can be a no-op (its trailing bits are unused, so a→b
        // may decode to identical bytes and still verify — a flaky test); the
        // first char always carries a full 6 bits, so the signature is always
        // altered.
        const [header, payloadSeg, sig] = token.split('.');
        const flippedSig = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
        const tampered = `${header}.${payloadSeg}.${flippedSig}`;
        const payload = await verifyToken(tampered);
        expect(payload).toBeNull();
    });

    it('should return null for a structurally invalid token', async () => {
        expect(await verifyToken('not-a-jwt')).toBeNull();
        expect(await verifyToken('')).toBeNull();
    });

    it('should return null for a token signed with a different secret', async () => {
        const original = process.env.JWT_SECRET;
        process.env.JWT_SECRET = 'some-other-secret';
        const foreignToken = await signToken({ userId: 'user1' });
        process.env.JWT_SECRET = original;

        const payload = await verifyToken(foreignToken);
        expect(payload).toBeNull();
    });
});

describe('guest session tokens', () => {
    beforeAll(() => {
        process.env.JWT_SECRET = 'test-secret-for-vitest';
    });

    it('signs a guest token carrying kind/groupId/role and a 72h exp', async () => {
        const token = await signGuestToken({ userId: 'g1', groupId: 'space1', role: 'GUEST' });
        const payload = await verifyToken(token);
        expect(payload).not.toBeNull();
        expect(payload?.kind).toBe('guest');
        expect(payload?.userId).toBe('g1');
        expect(payload?.groupId).toBe('space1');
        expect(payload?.role).toBe('GUEST');
        // exp ≈ iat + 72h, no hardCap claim when the space has no expiry.
        expect((payload!.exp as number) - (payload!.iat as number)).toBe(GUEST_SESSION_SECONDS);
        expect(payload?.hardCap).toBeUndefined();
    });

    it('clamps exp to the space expiry (hardCap) when it is sooner than 72h', async () => {
        const soon = new Date(Date.now() + 60 * 60 * 1000); // +1h
        const token = await signGuestToken({ userId: 'g1', groupId: 'space1', role: 'GUEST' }, soon);
        const payload = await verifyToken(token);
        const hardCap = Math.floor(soon.getTime() / 1000);
        expect(payload?.hardCap).toBe(hardCap);
        expect(payload?.exp).toBe(hardCap);
    });

    it('does not clamp when the space expiry is further out than 72h', async () => {
        const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30d
        const token = await signGuestToken({ userId: 'g1', groupId: 'space1', role: 'GUEST' }, far);
        const payload = await verifyToken(token);
        expect((payload!.exp as number) - (payload!.iat as number)).toBe(GUEST_SESSION_SECONDS);
    });

    it('refreshGuestToken re-issues a guest token from a verified guest payload', async () => {
        const original = await signGuestToken({ userId: 'g1', groupId: 'space1', role: 'GUEST' });
        const payload = await verifyToken(original);
        const refreshed = await refreshGuestToken(payload!);
        expect(refreshed).not.toBeNull();
        const rp = await verifyToken(refreshed!);
        expect(rp?.kind).toBe('guest');
        expect(rp?.userId).toBe('g1');
        expect(rp?.groupId).toBe('space1');
    });

    it('refreshGuestToken returns null for a non-guest payload', async () => {
        const token = await signToken({ userId: 'u1', email: 'a@b.c', isAdmin: false });
        const payload = await verifyToken(token);
        expect(await refreshGuestToken(payload!)).toBeNull();
    });

    it('refreshGuestToken returns null once the hard cap has passed', async () => {
        // A payload whose hardCap is already in the past cannot be extended.
        const payload = {
            userId: 'g1',
            groupId: 'space1',
            role: 'GUEST',
            kind: 'guest',
            hardCap: Math.floor((Date.now() - 1000) / 1000),
        };
        expect(await refreshGuestToken(payload)).toBeNull();
    });
});
