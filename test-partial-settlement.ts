
import { prisma } from "./src/lib/db";

async function main() {
    console.log("Starting Partial Settlement Test...");

    // 1. Create Group & Users
    const code = "PARTIAL-" + Date.now() + Math.random();
    const group = await prisma.group.create({
        data: {
            name: "Partial Test Group",
            code: code,
            users: {
                create: [
                    { name: "Payer", email: `payer-${code}@test.com` },
                    { name: "Receiver", email: `receiver-${code}@test.com` }
                ]
            }
        },
        include: { users: true }
    });
    const payer = group.users[0];
    const receiver = group.users[1];

    // 2. Create Expense: Receiver pays 100.
    // Payer's share is 50.
    const expense = await prisma.expense.create({
        data: {
            amount: 100,
            description: "Big Dinner",
            paidById: receiver.id,
            groupId: group.id,
            date: new Date()
        }
    });

    // 3. Payer settles PARTIALLY.
    // Total Debt = 50.
    // Payer pays 20.
    console.log("Payer paying 20 of the 50 debt...");

    const settlement = await prisma.settlement.create({
        data: {
            fromUserId: payer.id,
            toUserId: receiver.id,
            groupId: group.id,
            amount: 20,
            status: "PENDING",
            debts: {
                create: [{ expenseId: expense.id, amount: 20 }]
            },
            payments: {
                create: [{ type: "CASH", amount: 20 }]
            }
        },
        include: { debts: true }
    });

    console.log("Settlement Created:", JSON.stringify(settlement, null, 2));

    // 4. Verify
    if (settlement.amount !== 20) throw new Error("Settlement Amount mismatch");
    if (settlement.debts[0].amount !== 20) throw new Error("Debt Amount mismatch");

    console.log("Verification Success: Partial settlement created.");

    // Cleanup
    // await prisma.group.delete({ where: { id: group.id } });
}

main()
    .catch(e => console.error(JSON.stringify(e, null, 2)))
    .finally(() => prisma.$disconnect());
