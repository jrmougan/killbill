import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken, refreshGuestToken } from '@/lib/jwt'
import { guestRouteDecision, underPath } from '@/lib/authz-guest'

/**
 * Pages (and the admin API) that require ANY valid session. Anonymous visitors
 * are redirected to /login (pages) or get a 401 (API). Other API routes do their
 * own session check (some are public: invite preview/claim, cron, test, setup).
 */
const PROTECTED_PATHS = [
    '/dashboard', '/admin', '/api/admin', '/expenses', '/expense', '/personal', '/settle',
    '/settings', '/lists', '/month', '/budget', '/analytics', '/categories', '/tags',
    '/spaces', '/welcome',
]

const GUEST_COOKIE_MAX_AGE = 72 * 60 * 60

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl

    // Public invite consent pages (/i/*) live OUTSIDE the auth guard: anyone
    // holding a link must be able to reach the consent screen without a session.
    // We still stamp `Referrer-Policy: no-referrer` so the bearer token carried in
    // the URL never leaks through the Referer header (to sub-resource hosts or the
    // next page the visitor navigates to). No join ever happens here — the page
    // only previews and requires an explicit action to claim.
    if (underPath(pathname, '/i')) {
        const res = NextResponse.next()
        res.headers.set('Referrer-Policy', 'no-referrer')
        return res
    }

    const token = request.cookies.get('session_token')?.value
    const verifiedToken = token ? await verifyToken(token) : null
    const isApi = underPath(pathname, '/api')

    // GUEST confinement (deny-by-default) + sliding renewal. A guest session is
    // caged to its single EPHEMERAL space: it may only open the guest pages
    // (Inicio, gastos, saldar, crear cuenta) and call the API endpoints those
    // pages use — see `src/lib/authz-guest.ts` for the exact allowlist. Anything
    // else is a 403 (API) or a redirect to /dashboard (pages), including
    // /settings, /admin, /month, /lists, /categories, /tags, /spaces/**, and
    // POST /api/spaces, /api/me/**, /api/budget, /api/user/**. The DB-backed
    // revocation (expelled / archived) lives in getSessionCtx/requireSpaceAccess;
    // handlers still authorize every resource against its own group.
    if (verifiedToken?.kind === 'guest') {
        const decision = guestRouteDecision(pathname, request.method)
        if (decision === 'forbid') {
            return NextResponse.json({ error: 'Acción no permitida para invitados' }, { status: 403 })
        }
        if (decision === 'redirect') {
            return NextResponse.redirect(new URL('/dashboard', request.url))
        }

        // On every allowed hit re-sign the 72h token (capped at the space's
        // expiry) so an active guest stays logged in without ever exceeding the
        // trip window.
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
                maxAge: GUEST_COOKIE_MAX_AGE,
            })
        }
        return res
    }

    const isProtected = PROTECTED_PATHS.some(path => underPath(pathname, path))
    if (isProtected && !verifiedToken) {
        if (isApi) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }
        return NextResponse.redirect(new URL('/login', request.url))
    }

    return NextResponse.next()
}

export const config = {
    // Every route except Next internals and static files: the guest fence is
    // deny-by-default, so it must see every page and every /api call.
    matcher: [
        '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|css|js|map|txt|woff2?)$).*)',
    ],
}
