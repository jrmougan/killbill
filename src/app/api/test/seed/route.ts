import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { resolveCategoryId } from '@/lib/category-db';
import { postExpenseLedger, postSettlementLedger } from '@/lib/ledger';
import { signGuestToken } from '@/lib/jwt';
import { generateInviteToken, hashInviteToken, tokenPrefix } from '@/lib/invite-token';
import type { SpaceStatus, SpaceType } from '@/generated/prisma/enums';

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.com`;
}

function randomCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Registered users sharing the fixed scenario password (one bcrypt hash). */
async function createUsers(hashedPassword: string, prefixes: string[]) {
  return Promise.all(prefixes.map(async (prefix) => {
    const email = uniqueEmail(prefix);
    const user = await prisma.user.create({
      data: { name: `User ${prefix.slice(-1)}`, email, password: hashedPassword, avatar: '👤' },
    });
    return { ...user, email };
  }));
}

/** A space whose first user is OWNER and the rest MEMBER (all ACTIVE). */
async function createSpace(
  name: string,
  users: { id: string }[],
  opts: { type?: SpaceType; status?: SpaceStatus; archivedAt?: Date; expiresAt?: Date } = {},
) {
  const space = await prisma.couple.create({
    data: { name, code: randomCode(), createdById: users[0].id, ...opts },
  });
  await prisma.membership.createMany({
    data: users.map((u, i) => ({
      groupId: space.id, userId: u.id, role: i === 0 ? 'OWNER' as const : 'MEMBER' as const, status: 'ACTIVE' as const,
    })),
  });
  return space;
}

/**
 * A SHARED expense with its Split rows AND its ledger transaction, atomically —
 * balances are read from the ledger, so an Expense without its posting would be
 * invisible to the dashboard/settle-up.
 */
async function createSharedExpense(args: {
  groupId: string; description: string; amount: number; paidById: string;
  splits: { userId: string; amount: number }[]; members: { id: string }[];
  categoryId?: string | null; date?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        description: args.description,
        amount: args.amount,
        date: args.date ?? new Date(),
        categoryId: args.categoryId ?? await resolveCategoryId('other'),
        paidById: args.paidById,
        ownerId: args.paidById,
        createdById: args.paidById,
        visibility: 'SHARED',
        splitStrategy: 'EQUAL',
        coupleId: args.groupId,
        splits: { create: args.splits },
      },
    });
    await postExpenseLedger(tx, {
      expenseId: expense.id, groupId: args.groupId, amount: args.amount, paidById: args.paidById,
      occurredAt: expense.date, splits: args.splits, members: args.members,
    });
    return expense;
  });
}

function creds(user: { email: string; id: string }, password: string) {
  return { email: user.email, password, id: user.id };
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
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
        },
      });

      await prisma.membership.createMany({
        data: [
          { groupId: couple.id, userId: userA.id, role: 'OWNER', status: 'ACTIVE' },
          { groupId: couple.id, userId: userB.id, role: 'MEMBER', status: 'ACTIVE' },
        ],
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
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
        },
      });

      await prisma.membership.createMany({
        data: [
          { groupId: couple.id, userId: userA.id, role: 'OWNER', status: 'ACTIVE' },
          { groupId: couple.id, userId: userB.id, role: 'MEMBER', status: 'ACTIVE' },
        ],
      });

      // 100€ expense paid by userA, split 50/50 (amounts in cents)
      const expense = await prisma.expense.create({
        data: {
          description: 'Test Expense',
          amount: 10000, // 100€ in cents
          categoryId: await resolveCategoryId('other'),
          paidById: userA.id,
          ownerId: userA.id,
          coupleId: couple.id,
          splits: {
            create: [
              { userId: userA.id, amount: 5000 },
              { userId: userB.id, amount: 5000 },
            ],
          },
        },
      });

      // The dashboard/settle read balances from the double-entry ledger (phase 3+),
      // so a seeded shared expense must post its ledger transaction too.
      await postExpenseLedger(prisma, {
        expenseId: expense.id, groupId: couple.id, amount: 10000, paidById: userA.id,
        occurredAt: expense.date,
        splits: [{ userId: userA.id, amount: 5000 }, { userId: userB.id, amount: 5000 }],
        members: [{ id: userA.id }, { id: userB.id }],
      });

      return NextResponse.json({
        userA: { email: emailA, password: PASSWORD, id: userA.id },
        userB: { email: emailB, password: PASSWORD, id: userB.id },
        coupleId: couple.id,
        // Legacy short code: only the (gated) test route reveals it, never /api/couple.
        coupleCode: couple.code,
        coupleName: couple.name,
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
        },
      });

      const userB = await prisma.user.create({
        data: {
          name: 'User B',
          email: emailB,
          password: hashedPassword,
          avatar: '👤',
        },
      });

      await prisma.membership.createMany({
        data: [
          { groupId: couple.id, userId: userA.id, role: 'OWNER', status: 'ACTIVE' },
          { groupId: couple.id, userId: userB.id, role: 'MEMBER', status: 'ACTIVE' },
        ],
      });

      // 100€ expense paid by userA
      const pendingExpense = await prisma.expense.create({
        data: {
          description: 'Test Expense',
          amount: 10000,
          categoryId: await resolveCategoryId('other'),
          paidById: userA.id,
          ownerId: userA.id,
          coupleId: couple.id,
          splits: {
            create: [
              { userId: userA.id, amount: 5000 },
              { userId: userB.id, amount: 5000 },
            ],
          },
        },
      });
      await postExpenseLedger(prisma, {
        expenseId: pendingExpense.id, groupId: couple.id, amount: 10000, paidById: userA.id,
        occurredAt: pendingExpense.date,
        splits: [{ userId: userA.id, amount: 5000 }, { userId: userB.id, amount: 5000 }],
        members: [{ id: userA.id }, { id: userB.id }],
      });

      // Settlement of 50€ from B → A, PENDING (pending settlements do NOT post to
      // the ledger; only confirmed ones affect balances).
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

    if (scenario === 'couple-with-personal-expense') {
      const emailA = uniqueEmail('userA');
      const emailB = uniqueEmail('userB');

      const couple = await prisma.couple.create({
        data: { name: 'Personal Couple', code: randomCode() },
      });

      const userA = await prisma.user.create({
        data: { name: 'User A', email: emailA, password: hashedPassword, avatar: '👤' },
      });
      const userB = await prisma.user.create({
        data: { name: 'User B', email: emailB, password: hashedPassword, avatar: '👤' },
      });

      await prisma.membership.createMany({
        data: [
          { groupId: couple.id, userId: userA.id, role: 'OWNER', status: 'ACTIVE' },
          { groupId: couple.id, userId: userB.id, role: 'MEMBER', status: 'ACTIVE' },
        ],
      });

      // A shared expense (100€, 50/50) so the couple balance is non-trivial...
      const sharedExpense = await prisma.expense.create({
        data: {
          description: 'Shared Expense',
          amount: 10000,
          categoryId: await resolveCategoryId('other'),
          paidById: userA.id,
          ownerId: userA.id,
          visibility: 'SHARED',
          coupleId: couple.id,
          splits: {
            create: [
              { userId: userA.id, amount: 5000 },
              { userId: userB.id, amount: 5000 },
            ],
          },
        },
      });
      await postExpenseLedger(prisma, {
        expenseId: sharedExpense.id, groupId: couple.id, amount: 10000, paidById: userA.id,
        occurredAt: sharedExpense.date,
        splits: [{ userId: userA.id, amount: 5000 }, { userId: userB.id, amount: 5000 }],
        members: [{ id: userA.id }, { id: userB.id }],
      });

      // ...and a PERSONAL expense owned by userA (private, no couple, no splits).
      const personalExpense = await prisma.expense.create({
        data: {
          description: 'Personal Expense',
          amount: 50000, // 500€
          categoryId: await resolveCategoryId('health'),
          paidById: userA.id,
          ownerId: userA.id,
          visibility: 'PERSONAL',
          coupleId: null,
        },
      });

      // A personal budget for userA (health category).
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      // Phase 5 (stop-dual-write): Budget keys on categoryId + periodStart (the
      // enum/month columns are no longer written). Resolve the system category.
      const healthCat = await prisma.category.findFirst({ where: { groupId: null, key: 'health' } });
      const personalBudget = await prisma.budget.create({
        data: {
          categoryId: healthCat!.id,
          amount: 60000,
          periodStart: monthStart,
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          periodType: 'MONTH',
          ownerId: userA.id,
        },
      });

      return NextResponse.json({
        userA: { email: emailA, password: PASSWORD, id: userA.id },
        userB: { email: emailB, password: PASSWORD, id: userB.id },
        coupleId: couple.id,
        sharedExpenseId: sharedExpense.id,
        personalExpenseId: personalExpense.id,
        personalBudgetId: personalBudget.id,
      });
    }

    if (scenario === 'group-of-3') {
      const [userA, userB, userC] = await createUsers(hashedPassword, ['userA', 'userB', 'userC']);
      const members = [userA, userB, userC];
      const space = await createSpace('Group of 3', members, { type: 'GROUP' });

      // 100€ / 3 is not exact: the leftover cent goes to the FIRST member (the
      // finance.ts / computeExpenseEntries convention) → 33.34 + 33.33 + 33.33.
      const expense = await createSharedExpense({
        groupId: space.id, description: 'Cena a tres', amount: 10000, paidById: userA.id,
        splits: [
          { userId: userA.id, amount: 3334 },
          { userId: userB.id, amount: 3333 },
          { userId: userC.id, amount: 3333 },
        ],
        members,
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        userC: creds(userC, PASSWORD),
        coupleId: space.id,
        expenseId: expense.id,
      });
    }

    if (scenario === 'mobile-stress') {
      // Worst-case content for the 320px overflow sweep (e2e/mobile): names at
      // their max length, unbreakable words and 7-digit amounts.
      const LONG_WORD = 'Desoxirribonucleicoextraordinariamentelar'.slice(0, 40);
      const [userA, userB, userC] = await createUsers(hashedPassword, ['userA', 'userB', 'userC']);
      await prisma.user.update({
        where: { id: userA.id },
        data: { name: 'María de los Ángeles Fernández-Villaverde y Rodríguez' },
      });
      const members = [userA, userB, userC];
      const space = await createSpace('Viaje fin de curso Costa da Morte 2026 con toda la pandilla', members, { type: 'GROUP' });

      // 999.999,99 € split in three: every balance has seven digits.
      const expense = await createSharedExpense({
        groupId: space.id, description: LONG_WORD, amount: 99_999_999, paidById: userA.id,
        splits: [
          { userId: userA.id, amount: 33_333_333 },
          { userId: userB.id, amount: 33_333_333 },
          { userId: userC.id, amount: 33_333_333 },
        ],
        members,
      });
      await prisma.expense.update({ where: { id: expense.id }, data: { notes: `${LONG_WORD}${LONG_WORD}` } });
      await prisma.tag.create({ data: { name: LONG_WORD, coupleId: space.id } });
      const now = new Date();
      await prisma.budget.create({
        data: {
          categoryId: (await resolveCategoryId('other'))!,
          amount: 5000,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          periodType: 'MONTH',
          coupleId: space.id,
        },
      });
      const settlement = await prisma.settlement.create({
        data: {
          amount: 33_333_333, fromUserId: userB.id, toUserId: userA.id,
          coupleId: space.id, status: 'PENDING', method: 'BIZUM',
        },
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        coupleId: space.id,
        expenseId: expense.id,
        settlementId: settlement.id,
      });
    }

    if (scenario === 'space-settling') {
      const [userA, userB] = await createUsers(hashedPassword, ['userA', 'userB']);
      const members = [userA, userB];
      const space = await createSpace('Settling Couple', members);

      // Same debt as couple-with-debt: A paid 100€ 50/50 → B owes A 50€.
      const expense = await createSharedExpense({
        groupId: space.id, description: 'Test Expense', amount: 10000, paidById: userA.id,
        splits: [{ userId: userA.id, amount: 5000 }, { userId: userB.id, amount: 5000 }],
        members,
      });

      // What settle-up does once the debtor triggers it: ACTIVE → SETTLING plus a
      // PENDING CASH settlement debtor → creditor (PENDING never posts to the ledger).
      await prisma.couple.update({ where: { id: space.id }, data: { status: 'SETTLING' } });
      const settlement = await prisma.settlement.create({
        data: {
          coupleId: space.id, fromUserId: userB.id, toUserId: userA.id,
          amount: 5000, method: 'CASH', status: 'PENDING',
        },
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        coupleId: space.id,
        expenseId: expense.id,
        settlementId: settlement.id,
      });
    }

    if (scenario === 'space-archived') {
      const [userA, userB] = await createUsers(hashedPassword, ['userA', 'userB']);
      const members = [userA, userB];
      const space = await createSpace('Archived Couple', members);

      // Historical expenses (dated in the past): A paid 80€, B paid 30€, both
      // 50/50 → B owed A 25€, settled by a CONFIRMED settlement (posted to the
      // ledger) so the archived space closes with a zero balance.
      const now = Date.now();
      const expense1 = await createSharedExpense({
        groupId: space.id, description: 'Viaje (histórico)', amount: 8000, paidById: userA.id,
        splits: [{ userId: userA.id, amount: 4000 }, { userId: userB.id, amount: 4000 }],
        members, date: new Date(now - 60 * DAY_MS),
      });
      const expense2 = await createSharedExpense({
        groupId: space.id, description: 'Cena (histórica)', amount: 3000, paidById: userB.id,
        splits: [{ userId: userA.id, amount: 1500 }, { userId: userB.id, amount: 1500 }],
        members, date: new Date(now - 45 * DAY_MS),
      });
      const settlement = await prisma.$transaction(async (tx) => {
        const s = await tx.settlement.create({
          data: {
            coupleId: space.id, fromUserId: userB.id, toUserId: userA.id,
            amount: 2500, method: 'BIZUM', status: 'CONFIRMED', date: new Date(now - 40 * DAY_MS),
          },
        });
        await postSettlementLedger(tx, s);
        return s;
      });

      // A payment left PENDING before archiving (legacy data): Inicio says it
      // can no longer be resolved (CF-13). Not in the ledger, balance stays 0.
      await prisma.settlement.create({
        data: {
          coupleId: space.id, fromUserId: userA.id, toUserId: userB.id,
          amount: 1000, method: 'CASH', status: 'PENDING', date: new Date(now - 35 * DAY_MS),
        },
      });

      await prisma.couple.update({
        where: { id: space.id },
        data: { status: 'ARCHIVED', archivedAt: new Date(now - 30 * DAY_MS) },
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        coupleId: space.id,
        expenseIds: [expense1.id, expense2.id],
        settlementId: settlement.id,
      });
    }

    if (scenario === 'ephemeral-with-guest') {
      const [owner] = await createUsers(hashedPassword, ['ownerA']);
      const expiresAt = new Date(Date.now() + 7 * DAY_MS);
      const space = await createSpace('Ephemeral Trip', [owner], { type: 'EPHEMERAL', expiresAt });

      // Shadow guest written straight to the DB (bypasses the invite flow and so
      // the EPHEMERAL_SPACES_ENABLED route gate): no email/password, role GUEST.
      const guest = await prisma.user.create({
        data: { name: 'Guest Test', isGuest: true, avatar: '👤' },
      });
      await prisma.membership.create({
        data: { groupId: space.id, userId: guest.id, role: 'GUEST', status: 'ACTIVE' },
      });

      const members = [owner, guest];
      const expense = await createSharedExpense({
        groupId: space.id, description: 'Gasolina', amount: 6000, paidById: owner.id,
        splits: [{ userId: owner.id, amount: 3000 }, { userId: guest.id, amount: 3000 }],
        members,
      });

      // Guests have no password: hand back a guest session JWT (as the invite
      // claim would set in `session_token`). Only usable while the app runs with
      // EPHEMERAL_SPACES_ENABLED on.
      const guestSessionToken = await signGuestToken(
        { userId: guest.id, groupId: space.id, role: 'GUEST' },
        expiresAt,
      );

      return NextResponse.json({
        owner: creds(owner, PASSWORD),
        guest: { id: guest.id, sessionToken: guestSessionToken },
        coupleId: space.id,
        expiresAt: expiresAt.toISOString(),
        expenseId: expense.id,
      });
    }

    if (scenario === 'lists-prefilled') {
      const [userA, userB] = await createUsers(hashedPassword, ['userA', 'userB']);
      const space = await createSpace('Lists Couple', [userA, userB]);
      const checkedAt = new Date();

      // Aisle keys come from src/lib/aisles.ts; null = unassigned.
      const groupList = await prisma.shoppingList.create({
        data: {
          name: 'Mercadona', description: 'Compra semanal',
          groupId: space.id, createdById: userA.id,
          items: {
            create: [
              { name: 'Leche', quantity: 6, unit: 'L', aisle: 'lacteos', sortOrder: 0 },
              { name: 'Plátanos', quantity: 1, unit: 'kg', aisle: 'fruta_verdura', sortOrder: 1,
                checked: true, checkedById: userB.id, checkedAt },
              { name: 'Pan', quantity: 2, unit: 'ud', aisle: 'panaderia', sortOrder: 2 },
              { name: 'Pollo', quantity: 500, unit: 'g', aisle: 'carne_pescado', sortOrder: 3,
                note: 'Pechuga', checked: true, checkedById: userA.id, checkedAt },
              { name: 'Detergente', aisle: 'drogueria', sortOrder: 4 },
              { name: 'Cosa rara', sortOrder: 5 },
            ],
          },
        },
        include: { items: true },
      });

      const personalList = await prisma.shoppingList.create({
        data: {
          name: 'Farmacia', ownerId: userA.id, createdById: userA.id,
          items: {
            create: [
              { name: 'Ibuprofeno', quantity: 1, unit: 'pack', sortOrder: 0 },
              { name: 'Agua', quantity: 2, unit: 'L', aisle: 'bebidas', sortOrder: 1,
                checked: true, checkedById: userA.id, checkedAt },
            ],
          },
        },
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        coupleId: space.id,
        groupListId: groupList.id,
        groupItemIds: groupList.items.map((i) => i.id),
        personalListId: personalList.id,
      });
    }

    if (scenario === 'ux-showcase') {
      // Realistic data mirroring the EQUIL mockups (docs/design) for the Ralph UX
      // loop's screenshots (scripts/ralph): a couple "Casa" where Lucía owes Álvaro,
      // a 4-person trip "Lisboa" where Álvaro owes, budgets and a shared list.
      const [alvaro, lucia, marta, pablo] = await createUsers(hashedPassword, ['alvaro', 'lucia', 'marta', 'pablo']);
      const names: [typeof alvaro, string][] = [[alvaro, 'Álvaro'], [lucia, 'Lucía'], [marta, 'Marta'], [pablo, 'Pablo']];
      // No emoji avatar: the mockups show the initial ("Á").
      await Promise.all(names.map(([u, name]) => prisma.user.update({ where: { id: u.id }, data: { name, avatar: null } })));

      const couple = [alvaro, lucia];
      const casa = await createSpace('Casa', couple, { type: 'COUPLE' });
      const now = new Date();
      const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS);
      const half = (amount: number, first: string, second: string) => [
        { userId: first, amount: Math.ceil(amount / 2) },
        { userId: second, amount: Math.floor(amount / 2) },
      ];
      // Last month's account, already settled (history: a confirmed Bizum and a
      // rejected cash payment). Backdated createdAt/updatedAt so /settle's ticket
      // period (since the balance was last 0) starts before this month's expenses.
      const seguro = await createSharedExpense({
        groupId: casa.id, description: 'Seguro hogar', amount: 12000, paidById: alvaro.id,
        splits: half(12000, alvaro.id, lucia.id), members: couple,
        categoryId: await resolveCategoryId('utilities'), date: daysAgo(40),
      });
      await prisma.expense.update({ where: { id: seguro.id }, data: { createdAt: daysAgo(40) } });
      await prisma.settlement.create({
        data: {
          coupleId: casa.id, fromUserId: lucia.id, toUserId: alvaro.id, amount: 2000,
          method: 'CASH', status: 'REJECTED', date: daysAgo(36), createdAt: daysAgo(36), updatedAt: daysAgo(36),
        },
      });
      await prisma.$transaction(async (tx) => {
        const s = await tx.settlement.create({
          data: {
            coupleId: casa.id, fromUserId: lucia.id, toUserId: alvaro.id, amount: 6000,
            method: 'BIZUM', status: 'CONFIRMED', date: daysAgo(35), createdAt: daysAgo(35), updatedAt: daysAgo(35),
          },
        });
        await postSettlementLedger(tx, s);
      });
      // This week Lucía said she paid 15 € in cash and Álvaro said he never got it:
      // her Inicio lists it under Recientes as "Álvaro no lo recibió" (CF-06).
      const rejectedPayment = await prisma.settlement.create({
        data: {
          coupleId: casa.id, fromUserId: lucia.id, toUserId: alvaro.id, amount: 1500,
          method: 'CASH', status: 'REJECTED', date: daysAgo(2), createdAt: daysAgo(2), updatedAt: daysAgo(1),
        },
      });
      const casaExpenses: [string, number, typeof alvaro, string, number][] = [
        ['Mercadona', 6420, alvaro, 'shopping', 0],
        ['Cena sushi', 3800, lucia, 'food', 0],
        ['Luz octubre', 5830, alvaro, 'utilities', 2],
        ['Cine', 1800, lucia, 'entertainment', 3],
        ['Lidl', 4210, alvaro, 'shopping', 5],
        ['Gasolina', 5000, alvaro, 'transport', 8],
      ];
      const casaIds: string[] = [];
      for (const [description, amount, payer, key, ago] of casaExpenses) {
        const { id } = await createSharedExpense({
          groupId: casa.id, description, amount, paidById: payer.id,
          splits: half(amount, alvaro.id, lucia.id), members: couple,
          categoryId: await resolveCategoryId(key), date: daysAgo(ago),
        });
        casaIds.push(id);
      }

      const trip = [alvaro, lucia, marta, pablo];
      const lisboa = await createSpace('Lisboa', [marta, alvaro, lucia, pablo], { type: 'GROUP' });
      // Álvaro co-administers the trip, so Espacios shows him the "Invitar a Lisboa" card.
      await prisma.membership.update({
        where: { groupId_userId: { groupId: lisboa.id, userId: alvaro.id } },
        data: { role: 'ADMIN' },
      });
      await createSharedExpense({
        groupId: lisboa.id, description: 'Pastéis de nata', amount: 3000, paidById: marta.id,
        splits: trip.map((u) => ({ userId: u.id, amount: 750 })), members: trip,
        categoryId: await resolveCategoryId('food'), date: daysAgo(1),
      });
      // Álvaro already paid his share to Marta; she has not confirmed it yet.
      const pendingPayment = await prisma.settlement.create({
        data: {
          coupleId: lisboa.id, fromUserId: alvaro.id, toUserId: marta.id, amount: 750,
          method: 'BIZUM', status: 'PENDING', date: now,
        },
      });

      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      // One budget per state: ok (Compras), near the limit (Comida 38/45 €) and over (Ocio 18/15 €).
      for (const [key, amount] of [['shopping', 30000], ['food', 4500], ['entertainment', 1500]] as const) {
        const categoryId = await resolveCategoryId(key);
        if (!categoryId) throw new Error(`System category "${key}" is not seeded`);
        await prisma.budget.create({
          data: { categoryId, amount, periodStart, periodEnd, periodType: 'MONTH', coupleId: casa.id },
        });
      }

      const list = await prisma.shoppingList.create({
        data: {
          name: 'Mercadona', groupId: casa.id, createdById: alvaro.id,
          items: {
            create: [
              { name: 'Leche', quantity: 6, unit: 'L', aisle: 'lacteos', sortOrder: 0 },
              { name: 'Tomates', quantity: 1, unit: 'kg', aisle: 'fruta_verdura', sortOrder: 1 },
              { name: 'Pan', quantity: 2, unit: 'ud', aisle: 'panaderia', sortOrder: 2,
                checked: true, checkedById: lucia.id, checkedAt: now },
              { name: 'Yogures', quantity: 8, unit: 'ud', aisle: 'lacteos', sortOrder: 3 },
              { name: 'Detergente', aisle: 'drogueria', sortOrder: 4 },
            ],
          },
        },
      });
      // Personal list so the chips show "Común first, then Personal".
      await prisma.shoppingList.create({
        data: {
          name: 'Farmacia', ownerId: alvaro.id, createdById: alvaro.id,
          items: {
            create: [
              { name: 'Ibuprofeno', quantity: 1, unit: 'caja', sortOrder: 0 },
              { name: 'Crema solar', sortOrder: 1 },
            ],
          },
        },
      });

      return NextResponse.json({
        userA: creds(alvaro, PASSWORD),
        userB: creds(lucia, PASSWORD),
        coupleId: casa.id,
        groupId: lisboa.id,
        expenseId: casaIds[0],
        listId: list.id,
        settlementId: pendingPayment.id,
        // Marta receives settlementId (the creditor's view of the detail).
        userC: creds(marta, PASSWORD),
        rejectedSettlementId: rejectedPayment.id,
      });
    }

    if (scenario === 'categories-custom-with-budget') {
      const [userA, userB] = await createUsers(hashedPassword, ['userA', 'userB']);
      const members = [userA, userB];
      const space = await createSpace('Category Couple', members);

      // A NEW space-scoped custom category (non-reserved key, registered icon,
      // palette hex) — same shape createCategoryForScope writes.
      const category = await prisma.category.create({
        data: {
          key: 'mascotas', label: 'Mascotas', labelEn: 'Pets', emoji: '🐾',
          icon: 'Gift', color: '', bgColor: '', hex: '#8b5cf6',
          sortOrder: 100, isSystem: false, groupId: space.id,
        },
      });

      // Some spend in it this month so the budget shows progress (30€ of 200€).
      const expense = await createSharedExpense({
        groupId: space.id, description: 'Pienso', amount: 3000, paidById: userA.id,
        splits: [{ userId: userA.id, amount: 1500 }, { userId: userB.id, amount: 1500 }],
        members, categoryId: category.id,
      });

      const now = new Date();
      const budget = await prisma.budget.create({
        data: {
          categoryId: category.id,
          amount: 20000,
          periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
          periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
          periodType: 'MONTH',
          coupleId: space.id,
        },
      });

      return NextResponse.json({
        userA: creds(userA, PASSWORD),
        userB: creds(userB, PASSWORD),
        coupleId: space.id,
        categoryId: category.id,
        categoryKey: category.key,
        expenseId: expense.id,
        budgetId: budget.id,
      });
    }

    if (scenario === 'invite-edge-cases') {
      const [owner, member, outsider1, outsider2] = await createUsers(
        hashedPassword,
        ['owner', 'member', 'outsider1', 'outsider2'],
      );
      const space = await createSpace('Invite Edge Cases Group', [owner, member], { type: 'GROUP' });
      const now = Date.now();

      // 1) Token válido (maxUses 5)
      const tokenValid = generateInviteToken();
      const inviteValid = await prisma.groupInvite.create({
        data: {
          groupId: space.id,
          tokenHash: hashInviteToken(tokenValid),
          tokenPrefix: tokenPrefix(tokenValid),
          kind: 'MEMBER',
          maxUses: 5,
          usedCount: 0,
          expiresAt: new Date(now + 7 * DAY_MS),
          createdById: owner.id,
        },
      });

      // 2) Token expirado (expiresAt en el pasado)
      const tokenExpired = generateInviteToken();
      const inviteExpired = await prisma.groupInvite.create({
        data: {
          groupId: space.id,
          tokenHash: hashInviteToken(tokenExpired),
          tokenPrefix: tokenPrefix(tokenExpired),
          kind: 'MEMBER',
          maxUses: 5,
          usedCount: 0,
          expiresAt: new Date(now - 1 * DAY_MS),
          createdById: owner.id,
        },
      });

      // 3) Token revocado (revokedAt no nulo)
      const tokenRevoked = generateInviteToken();
      const inviteRevoked = await prisma.groupInvite.create({
        data: {
          groupId: space.id,
          tokenHash: hashInviteToken(tokenRevoked),
          tokenPrefix: tokenPrefix(tokenRevoked),
          kind: 'MEMBER',
          maxUses: 5,
          usedCount: 0,
          expiresAt: new Date(now + 7 * DAY_MS),
          revokedAt: new Date(now - 3600 * 1000),
          createdById: owner.id,
        },
      });

      // 4) Token agotado (usedCount >= maxUses)
      const tokenExhausted = generateInviteToken();
      const inviteExhausted = await prisma.groupInvite.create({
        data: {
          groupId: space.id,
          tokenHash: hashInviteToken(tokenExhausted),
          tokenPrefix: tokenPrefix(tokenExhausted),
          kind: 'MEMBER',
          maxUses: 1,
          usedCount: 1,
          expiresAt: new Date(now + 7 * DAY_MS),
          createdById: owner.id,
        },
      });

      return NextResponse.json({
        owner: creds(owner, PASSWORD),
        member: creds(member, PASSWORD),
        outsider1: creds(outsider1, PASSWORD),
        outsider2: creds(outsider2, PASSWORD),
        coupleId: space.id,
        tokens: {
          valid: tokenValid,
          expired: tokenExpired,
          revoked: tokenRevoked,
          exhausted: tokenExhausted,
        },
        inviteIds: {
          valid: inviteValid.id,
          expired: inviteExpired.id,
          revoked: inviteRevoked.id,
          exhausted: inviteExhausted.id,
        },
      });
    }

    return NextResponse.json({ error: `Unknown scenario: ${scenario}` }, { status: 400 });
  } catch (error) {
    console.error('Seed error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
