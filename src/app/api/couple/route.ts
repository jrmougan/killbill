import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getPrimaryGroup, getGroupMembers } from '@/lib/membership';
import { randomBytes } from 'crypto';

export async function GET(_request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    // Phase 4 selector switch: group + members come from the Membership layer
    // instead of user.coupleId / couple.members.
    const groupId = await getPrimaryGroup(userId);
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

    // Reject if the caller already belongs to a couple (Membership selector read).
    if (await getPrimaryGroup(userId)) {
        return NextResponse.json({ error: 'Ya perteneces a una pareja' }, { status: 400 });
    }

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
                name: name || "Nuestra Pareja",
                code: code,
            }
        });
        await tx.membership.create({
            data: { groupId: created.id, userId, role: 'OWNER', status: 'ACTIVE' }
        });
        return created;
    });

    return NextResponse.json({ success: true, couple });
}
