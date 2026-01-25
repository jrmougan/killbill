
import { prisma } from "./src/lib/db";

async function main() {
    // 1. Create 2 Users in a Group
    console.log("Creating Group and Users...");
    const group = await prisma.group.create({
        data: {
            name: "Test Group",
            code: "TESTG-" + Date.now() + Math.random(),
            users: {
                create: [
                    { name: "Alice", email: "alice-" + Date.now() + "@test.com" },
                    { name: "Bob", email: "bob-" + Date.now() + "@test.com" }
                ]
            }
        },
        include: { users: true }
    });
    const alice = group.users[0];
    const bob = group.users[1];
    console.log(`Users Created: Alice (${alice.id}), Bob (${bob.id})`);

    // 2. Create Expense 1: Alice pays 100 on Dinner
    console.log("Creating Expense (Alice pays 100 on Dinner)...");
    const dinnerExpense = await prisma.expense.create({
        data: {
            amount: 100,
            description: "Dinner",
            paidById: alice.id,
            groupId: group.id,
            date: new Date()
        }
    });

    // 3. Create Expense 2: Bob pays 100 on Taxi
    console.log("Creating Expense (Bob pays 100 on Taxi)...");
    const taxiExpense = await prisma.expense.create({
        data: {
            amount: 100,
            description: "Taxi",
            paidById: bob.id,
            groupId: group.id,
            date: new Date()
        }
    });

    // Bob owes Alice 50 (Dinner). Alice owes Bob 50 (Taxi).
    // Bob settles his debt (50) by using the Taxi expense credit he has.

    console.log("Settling Debt (Bob pays 50 via Taxi Credit)...");

    // API Payload Simulation
    const debts = [{ expenseId: dinnerExpense.id, amount: 50 }];
    const payments = [{ type: "EXPENSE", amount: 50, description: "Offset with Taxi", expenseId: taxiExpense.id }];

    const fromUserId = bob.id;
    const toUserId = alice.id;

    // Execute logic
    const result = await prisma.$transaction(async (tx) => {
        const settlement = await tx.settlement.create({
            data: {
                fromUserId,
                toUserId,
                groupId: group.id,
                amount: 50, // Total amount
                status: "PENDING", // NEW: Status defaulted/set
                debts: {
                    create: debts.map((d: any) => ({
                        expenseId: d.expenseId,
                        amount: d.amount
                    }))
                },
                payments: {
                    create: payments.map((p: any) => ({
                        type: p.type,
                        amount: p.amount,
                        description: p.description,
                        category: p.category,
                        expenseId: p.expenseId // NEW: Linked
                    }))
                }
            },
            include: { debts: true, payments: true }
        });
        return settlement;
    });

    console.log("Settlement Created:", JSON.stringify(result, null, 2));

    // Verify
    if (result.amount !== 50) throw new Error("Amount mismatch");
    if (result.status !== "PENDING") throw new Error("Status mismatch");
    if (result.payments[0].expenseId !== taxiExpense.id) throw new Error("Expense Linkage mismatch");

    console.log("Verification Success: Settlement recorded with Status and Expense Payment.");

    // Cleanup
    await prisma.group.delete({ where: { id: group.id } });
}

main()
    .catch(e => console.error(JSON.stringify(e, null, 2)))
    .finally(() => prisma.$disconnect());
