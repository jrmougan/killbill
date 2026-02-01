// scripts/migrate-to-cents.ts
// Run with: npx ts-node scripts/migrate-to-cents.ts
// OR: npx tsx scripts/migrate-to-cents.ts

import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Starting migration to cents...');

    // 1. Migrate Expenses
    const expenses = await prisma.$queryRaw`SELECT id, amount FROM Expense`;
    console.log(`Found ${(expenses as any[]).length} expenses to migrate.`);

    for (const exp of expenses as any[]) {
        const cents = Math.round(exp.amount * 100);
        await prisma.$executeRaw`UPDATE Expense SET amount = ${cents} WHERE id = ${exp.id}`;
    }
    console.log('✅ Expenses migrated.');

    // 2. Migrate Splits
    const splits = await prisma.$queryRaw`SELECT id, amount FROM Split`;
    console.log(`Found ${(splits as any[]).length} splits to migrate.`);

    for (const split of splits as any[]) {
        const cents = Math.round(split.amount * 100);
        await prisma.$executeRaw`UPDATE Split SET amount = ${cents} WHERE id = ${split.id}`;
    }
    console.log('✅ Splits migrated.');

    // 3. Migrate Settlements
    const settlements = await prisma.$queryRaw`SELECT id, amount FROM Settlement`;
    console.log(`Found ${(settlements as any[]).length} settlements to migrate.`);

    for (const settlement of settlements as any[]) {
        const cents = Math.round(settlement.amount * 100);
        await prisma.$executeRaw`UPDATE Settlement SET amount = ${cents} WHERE id = ${settlement.id}`;
    }
    console.log('✅ Settlements migrated.');

    console.log('🎉 Migration complete!');
}

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
