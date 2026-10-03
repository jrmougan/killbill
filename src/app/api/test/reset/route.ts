import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
  if (process.env.TEST_ROUTES_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    // Delete dependents first, including accounts whose User FK is Restrict.
    await prisma.$transaction([
      prisma.ledgerEntry.deleteMany(),
      prisma.ledgerTransaction.deleteMany(),
      prisma.account.deleteMany(),
      prisma.split.deleteMany(),
      prisma.expenseTag.deleteMany(),
      prisma.receiptLineItem.deleteMany(),
      prisma.recurringSeries.deleteMany(),
      prisma.expense.deleteMany(),
      prisma.settlement.deleteMany(),
      prisma.budget.deleteMany(),
      prisma.shoppingListItem.deleteMany(),
      prisma.shoppingList.deleteMany(),
      prisma.groupInvite.deleteMany(),
      prisma.membership.deleteMany(),
      prisma.tag.deleteMany(),
      // CI seeds system categories once; custom categories belong to scenarios.
      prisma.category.deleteMany({ where: { isSystem: false } }),
      prisma.inviteCode.deleteMany(),
      // Remove even the seeded admin: scenarios create their own admin users.
      prisma.user.deleteMany(),
      prisma.couple.deleteMany(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
