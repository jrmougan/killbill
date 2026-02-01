// Helper to round to 2 decimals to avoid floating point errors
function round(num: number): number {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function calculateBalances(
    users: { id: string }[],
    expenses: { paidById: string; amount: number; splits?: { userId: string, amount: number }[] }[],
    settlements: { fromUserId: string; toUserId: string; amount: number }[],
    currentUserId: string
): Record<string, number> {
    const paidByUser: Record<string, number> = {};
    const totalSpent = expenses.reduce((acc, expense) => {
        paidByUser[expense.paidById] = (paidByUser[expense.paidById] || 0) + expense.amount;
        return acc + expense.amount;
    }, 0);

    const numUsers = users.length || 1;

    // We don't really use fairShare directly for everyone if there are splits, 
    // but useful for default reference.
    // const fairShare = totalSpent / numUsers; 

    const balances: Record<string, number> = {};

    // Initialize for all users
    users.forEach(u => balances[u.id] = 0);

    // Calculate net expense position (paid - share)
    users.forEach(u => {
        const paid = paidByUser[u.id] || 0;

        // Calculate fair share based on splits
        let myShare = 0;
        expenses.forEach(e => {
            if (e.splits && e.splits.length > 0) {
                // If splits exist, check if I am in them
                const mySplit = e.splits.find(s => s.userId === u.id);
                if (mySplit) {
                    myShare += mySplit.amount;
                }
            } else {
                // Shared equally
                myShare += e.amount / numUsers;
            }
        });

        balances[u.id] = round(paid - myShare);
    });

    // Apply settlements
    settlements.forEach(s => {
        if (balances[s.fromUserId] !== undefined) balances[s.fromUserId] = round(balances[s.fromUserId] + s.amount);
        if (balances[s.toUserId] !== undefined) balances[s.toUserId] = round(balances[s.toUserId] - s.amount);
    });

    // Enforce Zero Sum (Fix for 0.01 rounding errors)
    let sum = 0;
    const userIds = Object.keys(balances);
    userIds.forEach(id => sum += balances[id]);

    // If sum is not 0 (e.g. 0.01), subtract it from the last user (or the one with largest balance)
    // To be deterministic, we just adjust the first user? Or the current user?
    // Let's adjust the user with the largest absolute balance to minimize relative error?
    // Or just the first one for simplicity.
    if (Math.abs(sum) > 0.005) {
        // Round sum to remove tiny float noise
        sum = round(sum);
        if (userIds.length > 0) {
            // Subtract the discrepancy from the first user
            balances[userIds[0]] = round(balances[userIds[0]] - sum);
        }
    }

    return balances;
}

// Function to get detailed debts just for the current user
// Returns positive number if I OWE them, negative if THEY OWE me (inverse of balance for easier UI reading "You owe X")
// Actually, let's keep it simple: Record<otherUserId, amount>
// Positive = I owe them
// Negative = They owe me
export function getMyDebts(
    users: { id: string }[],
    expenses: { paidById: string; amount: number; splits?: { userId: string, amount: number }[] }[],
    settlements: { fromUserId: string; toUserId: string; amount: number }[],
    currentUserId: string
): Record<string, number> {
    // This is surprisingly complex to do perfectly "who owes who" without a graph simplification algorithm.
    // However, for a simple splitwise clone, we can approximate or use the global net method.
    // Dashboard uses global net. 
    // If I have a net balance of -10 (I owe 10), and User B has +10 (Owed 10). I simply owe User B.
    // If I owe 10, B is +5, C is +5. I owe B 5 and C 5? Or just owe the pot?

    // Simplification: We will match negative balances (debtors) to positive balances (creditors).

    const balances = calculateBalances(users, expenses, settlements, currentUserId);

    const debtors = Object.entries(balances)
        .filter(([_, amount]) => amount < -0.01)
        .sort((a, b) => a[1] - b[1]); // Most debt first (most negative)

    const creditors = Object.entries(balances)
        .filter(([_, amount]) => amount > 0.01)
        .sort((a, b) => b[1] - a[1]); // Most credit first

    const debts: Record<string, number> = {}; // myUserId -> targetUserId : amount (How much *I* owe *Target*)

    // We want to find specifically what *currentUserId* owes.
    // If currentUserId is not in debtors, they don't owe anything.
    if (balances[currentUserId] >= 0) return {};

    // Standard algo to resolve debts
    let i = 0; // debtor index
    let j = 0; // creditor index

    while (i < debtors.length && j < creditors.length) {
        const debtor = debtors[i];
        const creditor = creditors[j];

        const debtAmount = Math.abs(debtor[1]);
        const creditAmount = creditor[1];

        const amount = Math.min(debtAmount, creditAmount);

        // Record the transaction
        if (debtor[0] === currentUserId) {
            debts[creditor[0]] = (debts[creditor[0]] || 0) + amount;
        }

        // Update remaining
        debtor[1] += amount;
        creditor[1] -= amount;

        if (Math.abs(debtor[1]) < 0.01) i++;
        if (creditor[1] < 0.01) j++;
    }

    return debts;
}

export function getLastSettlementDate(
    settlements: { date: Date | string }[]
): Date {
    if (!settlements || settlements.length === 0) {
        return new Date(0); // Beginning of time
    }

    // Sort by date desc
    const sorted = [...settlements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return new Date(sorted[0].date);
}
