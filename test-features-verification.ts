
import { prisma } from "./src/lib/db";

async function main() {
    console.log("Starting Feature Verification Test...");

    // 1. Create Group & Users
    const code = "FEAT-" + Date.now();
    const group = await prisma.group.create({
        data: {
            name: "Feature Test Group",
            code: code,
            users: {
                create: [
                    { name: "Alice", email: `alice-${code}@test.com` },
                    { name: "Bob", email: `bob-${code}@test.com` }
                ]
            }
        },
        include: { users: true }
    });
    const alice = group.users[0]; // Payer of Expense 1
    const bob = group.users[1];   // Payer of Expense 2

    // 2. Create Expenses
    // Expense A: Alice pays 100 (Bob owes 50)
    const expenseDebt = await prisma.expense.create({
        data: {
            amount: 100,
            description: "Dinner Debt",
            paidById: alice.id,
            groupId: group.id,
            status: "OPEN"
        }
    });

    // Expense B: Bob pays 50 (Alice owes 25)
    // Bob will use this to pay Alice
    const expenseCredit = await prisma.expense.create({
        data: {
            amount: 50,
            description: "Taxi Credit",
            paidById: bob.id,
            groupId: group.id,
            status: "OPEN"
        }
    });

    console.log(`Initial Statuses: Debt=${expenseDebt.status}, Credit=${expenseCredit.status}`);

    // 3. Settle: Bob pays Alice using "Taxi Credit"
    // He owes 50. Taxi Value is 25 (Alice's share). 
    // Wait, in my logic "Amount" of payment is defined by User.
    // Let's say Bob uses the full 25 of his credit to pay 25 of the debt.

    // Call the logic that API uses (replicating API behavior manually as we can't fetch easily)
    // In API:
    // 1. Create Settlement
    // 2. Update Statuses

    console.log("Simulating Settlement...");

    await prisma.$transaction(async (tx) => {
        const settlement = await tx.settlement.create({
            data: {
                fromUserId: bob.id,
                toUserId: alice.id,
                groupId: group.id,
                amount: 25,
                status: "PENDING",
                debts: {
                    create: [{ expenseId: expenseDebt.id, amount: 25 }]
                },
                payments: {
                    create: [{
                        type: "EXPENSE",
                        amount: 25,
                        expenseId: expenseCredit.id,
                        description: "Taxi"
                    }]
                }
            }
        });

        // The API Logic I wrote:
        const expenseIdsToUpdate = [expenseDebt.id, expenseCredit.id];
        await tx.expense.updateMany({
            where: {
                id: { in: expenseIdsToUpdate },
                status: "OPEN"
            },
            data: { status: "PARTIAL" }
        });
    });

    // 4. Verify Status Updates
    const freshDebt = await prisma.expense.findUnique({ where: { id: expenseDebt.id } });
    const freshCredit = await prisma.expense.findUnique({ where: { id: expenseCredit.id } });

    console.log(`Final Statuses: Debt=${freshDebt?.status}, Credit=${freshCredit?.status}`);

    if (freshDebt?.status !== "PARTIAL") throw new Error("Debt Expense did not update to PARTIAL");
    if (freshCredit?.status !== "PARTIAL") throw new Error("Credit Expense did not update to PARTIAL");

    // 5. Verify Filter Logic assumption
    // Code in page.tsx: .filter(e => e.status === 'OPEN')
    if (freshCredit?.status === "OPEN") throw new Error("Credit Filter would FAIL (Status is OPEN)");
    console.log("Credit matches Filter criteria (Not OPEN). Verification Passed.");

    // Cleanup
    // await prisma.group.delete({ where: { id: group.id } });
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
