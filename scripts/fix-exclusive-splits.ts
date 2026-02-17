/**
 * Fix script: Recalculate splits for ALL expenses that have exclusive items (assignedTo)
 * Uses mysql2 directly (no Prisma adapter needed).
 * 
 * Run in Docker: cd /prisma-tools && npm install mysql2 && npx tsx scripts/fix-exclusive-splits.ts
 */

import mysql from 'mysql2/promise';

function toCents(euros: number): number {
    return Math.round(euros * 100);
}

async function main() {
    const conn = await mysql.createConnection({
        host: process.env.DATABASE_HOST || 'localhost',
        user: process.env.DATABASE_USER || 'root',
        password: process.env.DATABASE_PASSWORD || 'toor',
        database: process.env.DATABASE_NAME || 'killbill',
        port: Number(process.env.DATABASE_PORT) || 3306,
    });

    console.log('🔍 Finding all expenses with exclusive receipt items...\n');

    // Get all expenses with receiptData
    const [expenses] = await conn.query(`
        SELECT e.id, e.description, e.amount, e.receiptData, e.paidById,
               c.id as coupleId
        FROM Expense e
        JOIN \`Couple\` c ON e.coupleId = c.id
        WHERE e.receiptData IS NOT NULL
    `) as any[];

    let fixedCount = 0;

    for (const expense of expenses) {
        let receiptData: any[];
        try {
            receiptData = typeof expense.receiptData === 'string'
                ? JSON.parse(expense.receiptData)
                : expense.receiptData;
        } catch { continue; }

        if (!Array.isArray(receiptData) || receiptData.length === 0) continue;

        // Check for exclusive items
        const hasExclusive = receiptData.some((item: any) => item.assignedTo);
        if (!hasExclusive) continue;

        // Get splits for this expense
        const [splits] = await conn.query(
            `SELECT s.id, s.userId, s.amount FROM Split s WHERE s.expenseId = ?`,
            [expense.id]
        ) as any[];

        // Only fix 50/50 splits (2 splits)
        if (splits.length !== 2) {
            console.log(`  ⚠️  Skipping "${expense.description}" - ${splits.length} splits`);
            continue;
        }

        // Get member names
        const [members] = await conn.query(
            `SELECT id, name FROM User WHERE coupleId = ?`,
            [expense.coupleId]
        ) as any[];

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

        const correctSplits = members.map((m: any, i: number) => ({
            userId: m.id,
            name: m.name,
            amount: commonBase + (i < commonRemainder ? 1 : 0) + (exclusiveByUser[m.id] || 0),
        }));

        // Adjust for rounding
        const splitsSum = correctSplits.reduce((a: number, s: any) => a + s.amount, 0);
        const diff = expense.amount - splitsSum;
        if (diff !== 0) correctSplits[0].amount += diff;

        // Check if update needed
        let needsUpdate = false;
        for (const split of splits) {
            const correct = correctSplits.find((s: any) => s.userId === split.userId);
            if (correct && split.amount !== correct.amount) {
                needsUpdate = true;
                break;
            }
        }

        if (!needsUpdate) {
            console.log(`  ✅ "${expense.description}" - already correct`);
            continue;
        }

        // Fix splits
        console.log(`\n  🔧 Fixing "${expense.description}" (${expense.amount / 100}€):`);
        for (const split of splits) {
            const correct = correctSplits.find((s: any) => s.userId === split.userId);
            if (correct && split.amount !== correct.amount) {
                console.log(`     ${correct.name}: ${split.amount / 100}€ → ${correct.amount / 100}€`);
                await conn.query(`UPDATE Split SET amount = ? WHERE id = ?`, [correct.amount, split.id]);
            }
        }
        fixedCount++;
    }

    console.log(`\n📊 Fixed ${fixedCount} expenses.\n`);
    await conn.end();
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1); });
