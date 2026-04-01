import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
  if (process.env.TEST_ROUTES_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    // Delete in correct dependency order
    await prisma.split.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.settlement.deleteMany();
    await prisma.inviteCode.deleteMany();
    await prisma.user.deleteMany();
    await prisma.couple.deleteMany();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
