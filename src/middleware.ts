import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
    const userId = request.cookies.get('user_id')?.value;
    const isAuthPage = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/register');

    if (!userId && !isAuthPage) {
        const url = new URL('/login', request.url);
        url.search = request.nextUrl.search;
        return NextResponse.redirect(url)
    }

    if (userId && isAuthPage) {
        const url = new URL('/dashboard', request.url);
        url.search = request.nextUrl.search;
        return NextResponse.redirect(url)
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|manifest|icon).*)'],
}
