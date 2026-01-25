import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request: Request) {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const { code } = await request.json();
        if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 });

        const group = await prisma.group.findUnique({ where: { code } });
        if (!group) return NextResponse.json({ error: 'Invalid group code' }, { status: 404 });

        // Update user's group
        await prisma.user.update({
            where: { id: userId },
            data: { groupId: group.id }
        });

        return NextResponse.json({ success: true, group });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
