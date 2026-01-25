import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user?.activeGroupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    const groupMembers = await prisma.userGroup.findMany({
        where: { groupId: user.activeGroupId },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    avatar: true,
                }
            }
        }
    });

    const members = groupMembers.map(gm => gm.user);

    return NextResponse.json({ members });
}
