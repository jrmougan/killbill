import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, refreshGuestToken } from '@/lib/jwt'

// Path prefixes a GUEST session may reach (plan §2.4). Everything else —
// /settings, /admin, /budget, /analytics, /personal, /tags... — is off-limits.
const GUEST_ALLOWED_PREFIXES = ['/dashboard', '/expenses', '/expense', '/settle', '/guest']

/** A guest may load /expenses/* but NOT the CSV import (personal-only surface). */
function isGuestAllowedPath(pathname: string): boolean {
    if (pathname.startsWith('/expenses/import')) return false
    return GUEST_ALLOWED_PREFIXES.some(p => pathname.startsWith(p))
}

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
    const protectedPaths = ['/dashboard', '/admin', '/api/admin', '/expenses', '/personal', '/settle', '/settings', '/lists']
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

        // GUEST confinement + sliding renewal (Fase 3). A guest is caged to a
        // handful of pages; anything else bounces to its dashboard. The DB-backed
        // revocation (expelled / archived) lives in getSessionCtx/requireSpaceAccess
        // — this branch is only the coarse page-level gate. On every allowed hit we
        // re-sign the 72h token (capped at the space's expiry) so an active guest
        // stays logged in without ever exceeding the trip window.
        if (verifiedToken.kind === 'guest') {
            const pathname = request.nextUrl.pathname
            if (!isGuestAllowedPath(pathname)) {
                if (pathname.startsWith('/api')) {
                    return NextResponse.json({ error: 'Acción no permitida para invitados' }, { status: 403 })
                }
                return NextResponse.redirect(new URL('/dashboard', request.url))
            }

            const res = NextResponse.next()
            const refreshed = await refreshGuestToken(verifiedToken)
            if (refreshed) {
                res.cookies.set({
                    name: 'session_token',
                    value: refreshed,
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    path: '/',
                    maxAge: 72 * 60 * 60,
                })
            }
            return res
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
        '/lists/:path*',
        // Matched only to stamp Referrer-Policy: no-referrer — never guarded.
        '/i/:path*',
    ],
}
