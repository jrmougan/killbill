import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionCtx } from '@/lib/authz';
import { signMcpToken } from '@/lib/jwt';
import { testRoutesRefusal } from '@/lib/test-routes-guard';

/**
 * TEST ONLY: sign the legacy 90-day `kind: 'mcp'` JWT for the caller's browser
 * session, exactly as POST /api/me/mcp-token did before issue #60. The app no
 * longer issues it, but mcp-auth.ts still accepts the ones already out there
 * (their retirement is issue #61), so e2e needs a way to keep covering them.
 */
export async function POST() {
  if (process.env.TEST_ROUTES_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404 });
  }

  const refusal = await testRoutesRefusal();
  if (refusal) {
    return NextResponse.json({ error: `Test routes refused: ${refusal}` }, { status: 403 });
  }

  const ctx = await getSessionCtx();
  if (!ctx || ctx.kind !== undefined) {
    return NextResponse.json({ error: 'Browser session required' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true, isAdmin: true, tokenVersion: true },
  });
  if (!user) return NextResponse.json({ error: 'Browser session required' }, { status: 401 });

  const token = await signMcpToken({
    userId: ctx.userId,
    email: user.email,
    isAdmin: user.isAdmin,
    tv: user.tokenVersion,
  });
  return NextResponse.json({ token }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
