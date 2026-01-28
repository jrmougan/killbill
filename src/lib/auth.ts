import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './jwt';

export * from './jwt';

export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;
    if (!token) return null;
    return await verifyToken(token);
}

export async function updateSession(request: NextRequest) {
    const token = request.cookies.get('session_token')?.value;
    if (!token) return;

    // Refresh session if needed/valid
    const parsed = await verifyToken(token);
    if (!parsed) return;

    const res = NextResponse.next();
    res.cookies.set({
        name: 'session_token',
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return res;
}
