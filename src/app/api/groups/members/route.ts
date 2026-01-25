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

    if (!user?.groupId) return NextResponse.json({ error: 'No Group' }, { status: 400 });

    const group = await prisma.group.findUnique({
        where: { id: user.groupId },
        include: {
            users: {
                select: {
                    id: true,
                    name: true,
                    avatar: true,
                }
            }
        }
    });

    if (!group) return NextResponse.json({ error: 'Group Not Found' }, { status: 404 });

    return NextResponse.json({ members: group.users });
}
