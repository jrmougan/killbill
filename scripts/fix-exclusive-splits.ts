/**
 * Fix script: Recalculate splits for ALL expenses that have exclusive items (assignedTo)
 * in their receiptData but whose splits are still a naive 50/50.
 * 
 * Run locally:  npx tsx scripts/fix-exclusive-splits.ts
 * Run in Docker: cd /prisma-tools && npx tsx scripts/fix-exclusive-splits.ts
 */

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaMariaDb({
    host: process.env.DATABASE_HOST || 'localhost',
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || 'toor',
    database: process.env.DATABASE_NAME || 'killbill',
    port: Number(process.env.DATABASE_PORT) || 3306,
    connectionLimit: 5,
});

const prisma = new PrismaClient({ adapter });

function toCents(euros: number): number {
    return Math.round(euros * 100);
}

interface ReceiptItem {
    total: number;
    assignedTo?: string | null;
}

async function main() {
    console.log('🔍 Finding all expenses with receiptData...\n');

    // Get all expenses that have receiptData (JSON field is not null)
    const expenses = await prisma.expense.findMany({
        where: {
            receiptData: { not: undefined },
        },
        include: {
            splits: true,
            couple: {
                include: {
                    members: { select: { id: true, name: true } }
                }
            }
        }
    });

    let fixedCount = 0;
    let skippedCount = 0;

    for (const expense of expenses) {
        const receiptData = expense.receiptData as unknown as ReceiptItem[] | null;
        if (!receiptData || !Array.isArray(receiptData) || receiptData.length === 0) {
            continue;
        }

        // Check if this expense has any exclusive items
        const hasExclusive = receiptData.some(item => item.assignedTo);
        if (!hasExclusive) {
            skippedCount++;
            continue;
        }

        // Only process 50/50 splits (2 splits = shared expense)
        if (expense.splits.length !== 2) {
            console.log(`  ⚠️  Skipping "${expense.description}" - has ${expense.splits.length} splits (not 50/50)`);
            skippedCount++;
            continue;
        }

        const members = expense.couple.members;

        // Calculate correct splits
        let commonCents = 0;
        const exclusiveByUser: Record<string, number> = {};

        for (const item of receiptData) {
            const itemCents = toCents(item.total);
            if (item.assignedTo) {
                exclusiveByUser[item.assignedTo] = (exclusiveByUser[item.assignedTo] || 0) + itemCents;
            } else {
                commonCents += itemCents;
            }
        }

        const commonBase = Math.floor(commonCents / 2);
        const commonRemainder = commonCents - commonBase * 2;

        const correctSplits = members.map((m, i) => ({
            userId: m.id,
            name: m.name,
            amount: commonBase + (i < commonRemainder ? 1 : 0) + (exclusiveByUser[m.id] || 0),
        }));

        // Adjust for rounding discrepancy
        const splitsSum = correctSplits.reduce((a, s) => a + s.amount, 0);
        const diff = expense.amount - splitsSum;
        if (diff !== 0) correctSplits[0].amount += diff;

        // Check if splits actually need updating
        let needsUpdate = false;
        for (const split of expense.splits) {
            const correct = correctSplits.find(s => s.userId === split.userId);
            if (correct && split.amount !== correct.amount) {
                needsUpdate = true;
                break;
            }
        }

        if (!needsUpdate) {
            console.log(`  ✅ "${expense.description}" - splits already correct`);
            skippedCount++;
            continue;
        }

        // Log and fix
        console.log(`\n  🔧 Fixing "${expense.description}" (${expense.amount / 100}€):`);
        console.log(`     Common: ${commonCents / 100}€ | Exclusive: ${JSON.stringify(
            Object.fromEntries(Object.entries(exclusiveByUser).map(([k, v]) => {
                const name = members.find(m => m.id === k)?.name || k;
                return [name, v / 100 + '€'];
            }))
        )}`);

        for (const split of expense.splits) {
            const correct = correctSplits.find(s => s.userId === split.userId);
            if (correct && split.amount !== correct.amount) {
                console.log(`     ${correct.name}: ${split.amount / 100}€ → ${correct.amount / 100}€`);
                await prisma.split.update({
                    where: { id: split.id },
                    data: { amount: correct.amount },
                });
            }
        }
        fixedCount++;
    }

    console.log(`\n📊 Summary: Fixed ${fixedCount} expenses, skipped ${skippedCount}\n`);
}

main()
    .catch(e => { console.error('❌ Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
