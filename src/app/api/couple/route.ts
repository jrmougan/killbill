import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { randomBytes } from 'crypto';

export async function GET(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!user?.coupleId) return NextResponse.json({ couple: null, userId });

    return NextResponse.json({ couple: user.couple, userId });
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    const body = await request.json();
    const { name } = body;

    // Generate cryptographically random code for invite
    const code = randomBytes(3).toString('hex').toUpperCase();

    const couple = await prisma.couple.create({
        data: {
            name: name || "Nuestra Pareja",
            code: code,
            members: {
                connect: { id: userId }
            }
        }
    });

    return NextResponse.json({ success: true, couple });
}
