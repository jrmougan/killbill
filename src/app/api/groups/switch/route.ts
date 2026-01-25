import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

// POST /api/groups/switch - Switch active group
export async function POST(request: Request) {
    try {
        const cookieStore = await cookies();
        const userId = cookieStore.get('user_id')?.value;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { groupId } = await request.json();

        if (!groupId) {
            return NextResponse.json({ error: 'Group ID is required' }, { status: 400 });
        }

        // Verify user is a member of this group
        const membership = await prisma.userGroup.findUnique({
            where: {
                userId_groupId: {
                    userId,
                    groupId,
                },
            },
        });

        if (!membership) {
            return NextResponse.json({ error: 'You are not a member of this group' }, { status: 403 });
        }

        // Update active group
        await prisma.user.update({
            where: { id: userId },
            data: { activeGroupId: groupId },
        });

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("Switch Group Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
