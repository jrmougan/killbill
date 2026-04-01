import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/jwt'

export async function proxy(request: NextRequest) {

    // Define protected paths
    // /setup should NOT be protected as it handles its own logic
    const protectedPaths = ['/dashboard', '/admin', '/api/admin', '/expenses', '/settle', '/settings']
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
        '/settle/:path*',
        '/settings/:path*',
    ],
}
