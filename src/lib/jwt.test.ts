// @vitest-environment node
// jwt.ts runs in the Next.js (node) server runtime. jose's Uint8Array
// instanceof checks fail under jsdom due to cross-realm typed arrays, so
// pin this file to the node environment.
import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from './jwt';

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
