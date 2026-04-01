import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.com`;
}

function randomCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

export async function POST(request: Request) {
  if (process.env.TEST_ROUTES_ENABLED !== 'true') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const { scenario } = await request.json();
    const PASSWORD = 'Password123';
    const hashedPassword = await bcrypt.hash(PASSWORD, 10);

    if (scenario === 'admin-with-invite') {
      const adminEmail = uniqueEmail('admin');
      const admin = await prisma.user.create({
        data: {
          name: 'Admin Test',
          email: adminEmail,
          password: hashedPassword,
          isAdmin: true,
          avatar: '👤',
        },
      });

      const code = randomCode();
      await prisma.inviteCode.create({
        data: {
          code,
          createdById: admin.id,
        },
      });

      return NextResponse.json({
        admin: { email: adminEmail, password: PASSWORD },
        inviteCode: code,
      });
    }

    if (scenario === 'solo-user') {
      // Need an admin and invite code to create the user
      const adminEmail = uniqueEmail('admin_solo');
      const admin = await prisma.user.create({
        data: {
          name: 'Admin Solo',
          email: adminEmail,
          password: hashedPassword,
          isAdmin: true,
          avatar: '👤',
        },
      });

      const code = randomCode();
      await prisma.inviteCode.create({
        data: {
          code,
          createdById: admin.id,
        },
      });

      const userEmail = uniqueEmail('user');
      const user = await prisma.user.create({
        data: {
          name: 'Test User',
          email: userEmail,
          password: hashedPassword,
          avatar: '👤',
        },
      });

      await prisma.inviteCode.update({
        where: { code },
        data: { usedById: user.id, usedAt: new Date() },
      });

      return NextResponse.json({
        user: { email: userEmail, password: PASSWORD, id: user.id },
      });
    }

    if (scenario === 'couple-no-expenses') {
      const emailA = uniqueEmail('userA');
      const emailB = uniqueEmail('userB');

      const couple = await prisma.couple.create({
        data: {
          name: 'Test Couple',
          code: randomCode(),
        },
      });

      const userA = await prisma.user.create({
        data: {
          name: 'User A',
          email: emailA,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      return NextResponse.json({
        userA: { email: emailA, password: PASSWORD, id: userA.id },
        userB: { email: emailB, password: PASSWORD, id: userB.id },
        coupleId: couple.id,
      });
    }

    if (scenario === 'couple-with-debt') {
      const emailA = uniqueEmail('userA');
      const emailB = uniqueEmail('userB');

      const couple = await prisma.couple.create({
        data: {
          name: 'Debt Couple',
          code: randomCode(),
        },
      });

      const userA = await prisma.user.create({
        data: {
          name: 'User A',
          email: emailA,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      // 100€ expense paid by userA, split 50/50 (amounts in cents)
      const expense = await prisma.expense.create({
        data: {
          description: 'Test Expense',
          amount: 10000, // 100€ in cents
          category: 'other',
          paidById: userA.id,
          coupleId: couple.id,
          splits: {
            create: [
              { userId: userA.id, amount: 5000 },
              { userId: userB.id, amount: 5000 },
            ],
          },
        },
      });

      return NextResponse.json({
        userA: { email: emailA, password: PASSWORD, id: userA.id },
        userB: { email: emailB, password: PASSWORD, id: userB.id },
        coupleId: couple.id,
        expenseId: expense.id,
      });
    }

    if (scenario === 'couple-with-pending-settlement') {
      const emailA = uniqueEmail('userA');
      const emailB = uniqueEmail('userB');

      const couple = await prisma.couple.create({
        data: {
          name: 'Settlement Couple',
          code: randomCode(),
        },
      });

      const userA = await prisma.user.create({
        data: {
          name: 'User A',
          email: emailA,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
          coupleId: couple.id,
        },
      });

      // 100€ expense paid by userA
      await prisma.expense.create({
        data: {
          description: 'Test Expense',
          amount: 10000,
          category: 'other',
          paidById: userA.id,
          coupleId: couple.id,
          splits: {
            create: [
              { userId: userA.id, amount: 5000 },
              { userId: userB.id, amount: 5000 },
            ],
          },
        },
      });

      // Settlement of 50€ from B → A, PENDING
      const settlement = await prisma.settlement.create({
        data: {
          amount: 5000, // 50€ in cents
          fromUserId: userB.id,
          toUserId: userA.id,
          coupleId: couple.id,
          status: 'PENDING',
          method: 'BIZUM',
        },
      });

      return NextResponse.json({
        userA: { email: emailA, password: PASSWORD, id: userA.id },
        userB: { email: emailB, password: PASSWORD, id: userB.id },
        coupleId: couple.id,
        settlementId: settlement.id,
      });
    }

    return NextResponse.json({ error: `Unknown scenario: ${scenario}` }, { status: 400 });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
