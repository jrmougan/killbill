import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getActiveGroup, getGroupMembers, ACTIVE_GROUP_COOKIE } from '@/lib/membership';
import { randomBytes } from 'crypto';

export async function GET(_request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Resolve the caller's ACTIVE group + members via the Membership layer (F4).
    const groupId = await getActiveGroup(userId);
    if (!groupId) return NextResponse.json({ couple: null, userId });

    const [couple, members] = await Promise.all([
        prisma.couple.findUnique({ where: { id: groupId } }),
        getGroupMembers(groupId),
    ]);
    if (!couple) return NextResponse.json({ couple: null, userId });

    return NextResponse.json({ couple: { ...couple, members }, userId });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // F4 (multi-group): no blanket "already in a group" block — a user may own or
    // belong to several groups.
    const body = await request.json();
    const { name } = body;

    // Generate cryptographically random code for invite
    const code = randomBytes(3).toString('hex').toUpperCase();

    // Create the couple and the creator's OWNER membership atomically. Phase 5
    // (WS1 write-stop): the Membership is the sole linkage — the couple.create no
    // longer connects User.coupleId.
    const couple = await prisma.$transaction(async (tx) => {
        const created = await tx.couple.create({
            data: {
                name: name || "Mi grupo",
                code: code,
            }
        });
        await tx.membership.create({
            data: { groupId: created.id, userId, role: 'OWNER', status: 'ACTIVE' }
        });
        return created;
    });

    // F4: make the newly-created group the active one.
    (await cookies()).set(ACTIVE_GROUP_COOKIE, couple.id, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ success: true, couple });
}
