import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/jwt'

export async function proxy(request: NextRequest) {

    // Public invite consent pages (/i/*) live OUTSIDE the auth guard: anyone
    // holding a link must be able to reach the consent screen without a session.
    // We still stamp `Referrer-Policy: no-referrer` so the bearer token carried in
    // the URL never leaks through the Referer header (to sub-resource hosts or the
    // next page the visitor navigates to). No join ever happens here — the page
    // only previews and requires an explicit action to claim.
    if (request.nextUrl.pathname.startsWith('/i/')) {
        const res = NextResponse.next()
        res.headers.set('Referrer-Policy', 'no-referrer')
        return res
    }

    // Define protected paths
    // /setup should NOT be protected as it handles its own logic
    const protectedPaths = ['/dashboard', '/admin', '/api/admin', '/expenses', '/personal', '/settle', '/settings']
    const isProtected = protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))

    if (isProtected) {
        const token = request.cookies.get('session_token')?.value
        const verifiedToken = token ? await verifyToken(token) : null

        if (!verifiedToken) {
            // If API request, return JSON error
            if (request.nextUrl.pathname.startsWith('/api')) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
            }
            // If Page request, redirect to login
            return NextResponse.redirect(new URL('/login', request.url))
        }
    }

    return NextResponse.next()
}

export const config = {
    matcher: [
        '/dashboard/:path*',
        '/admin/:path*',
        '/api/admin/:path*',
        '/expenses/:path*',
        '/personal/:path*',
        '/settle/:path*',
        '/settings/:path*',
        // Matched only to stamp Referrer-Policy: no-referrer — never guarded.
        '/i/:path*',
    ],
}
