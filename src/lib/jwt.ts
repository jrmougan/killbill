import { SignJWT, jwtVerify } from 'jose';

// Resolved lazily so a missing secret fails loudly at sign/verify time
// (not at module import / build time) — never fall back to a hardcoded value.
function getKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET is not set. Refusing to sign/verify session tokens without a configured secret.');
    }
    return new TextEncoder().encode(secret);
}

export async function signToken(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d') // 7 days session
        .sign(getKey());
}

export async function verifyToken(token: string) {
    try {
        const { payload } = await jwtVerify(token, getKey(), {
            algorithms: ['HS256'],
        });
        return payload;
    } catch (error) {
        return null;
    }
}
