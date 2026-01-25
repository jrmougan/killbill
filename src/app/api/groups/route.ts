import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { cookies } from 'next/headers';

// POST /api/groups - Create a new group
export async function POST(request: Request) {
    try {
        const cookieStore = await cookies();
        const userId = cookieStore.get('user_id')?.value;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, type } = body; // type: "GROUP" or "COUPLE"

        if (!name) {
            return NextResponse.json({ error: 'Group name is required' }, { status: 400 });
        }

        const groupType = type === "COUPLE" ? "COUPLE" : "GROUP";

        // Create the group
        const group = await prisma.group.create({
            data: {
                name,
                code: Math.random().toString(36).substring(2, 8).toUpperCase(),
                type: groupType,
            },
        });

        // Add creator to UserGroup as OWNER
        await prisma.userGroup.create({
            data: {
                userId,
                groupId: group.id,
                role: "OWNER",
            },
        });

        // Set as active group
        await prisma.user.update({
            where: { id: userId },
            data: { activeGroupId: group.id },
        });

        return NextResponse.json({ success: true, group });

    } catch (error) {
        console.error("Create Group Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// GET /api/groups - Get all groups for current user
export async function GET() {
    try {
        const cookieStore = await cookies();
        const userId = cookieStore.get('user_id')?.value;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userGroups = await prisma.userGroup.findMany({
            where: { userId },
            include: {
                group: true,
            },
        });

        const groups = userGroups.map(ug => ug.group);

        return NextResponse.json({ groups });

    } catch (error) {
        console.error("Get Groups Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
