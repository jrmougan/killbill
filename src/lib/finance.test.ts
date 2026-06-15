import { describe, it, expect } from 'vitest';
import { calculateBalances, getMyDebts, getLastSettlementDate } from './finance';

describe('finance utilities', () => {
    const users = [
        { id: 'user1', name: 'Alice' },
        { id: 'user2', name: 'Bob' }
    ];

    describe('calculateBalances', () => {
        it('should calculate 50/50 split correctly', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 100 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const balances = calculateBalances(users, expenses, settlements, 'user1');

            // Alice paid 100. Share is 50 each.
            // Alice balance: 100 - 50 = +50
            // Bob balance: 0 - 50 = -50
            expect(balances['user1']).toBe(50);
            expect(balances['user2']).toBe(-50);
        });

        it('should handle custom splits correctly', () => {
            const expenses = [
                {
                    id: 'exp1',
                    paidById: 'user1',
                    amount: 100,
                    splits: [
                        { userId: 'user1', amount: 30 },
                        { userId: 'user2', amount: 70 }
                    ]
                }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const balances = calculateBalances(users, expenses, settlements, 'user1');

            // Alice paid 100. Share is 30 for Alice, 70 for Bob.
            // Alice balance: 100 - 30 = +70
            // Bob balance: 0 - 70 = -70
            expect(balances['user1']).toBe(70);
            expect(balances['user2']).toBe(-70);
        });

        it('should not lose cents on odd-amount equal split (3 people / 100 cents)', () => {
            const threeUsers = [
                { id: 'user1', name: 'Alice' },
                { id: 'user2', name: 'Bob' },
                { id: 'user3', name: 'Carol' }
            ];
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 100 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const balances = calculateBalances(threeUsers, expenses, settlements, 'user1');

            // 100 / 3 = 34 + 33 + 33 (remainder cent to first user).
            // Alice paid 100, share 34 -> +66
            // Bob share 33 -> -33
            // Carol share 33 -> -33
            expect(balances['user1']).toBe(66);
            expect(balances['user2']).toBe(-33);
            expect(balances['user3']).toBe(-33);

            // Balances must reconcile to zero (no lost/created cent).
            const sum = balances['user1'] + balances['user2'] + balances['user3'];
            expect(sum).toBe(0);
        });

        it('should not lose a cent on odd 2-way equal split', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 101 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const balances = calculateBalances(users, expenses, settlements, 'user1');

            // 101 / 2 = 51 + 50 (remainder cent to first user).
            // Alice paid 101, share 51 -> +50
            // Bob share 50 -> -50
            expect(balances['user1']).toBe(50);
            expect(balances['user2']).toBe(-50);
            expect(balances['user1'] + balances['user2']).toBe(0);
        });

        it('should account for settlements', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 100 }
            ];
            const settlements = [
                { fromUserId: 'user2', toUserId: 'user1', amount: 20 }
            ];
            const balances = calculateBalances(users, expenses, settlements, 'user1');

            // Base balance: Alice +50, Bob -50
            // After 20 settlement from Bob to Alice:
            // Alice balance: 50 + 20 = +70
            // Bob balance: -50 - 20 = -70
            // Wait, looking at finance.ts logic:
            // balances[s.fromUserId] += s.amount;
            // balances[s.toUserId] -= s.amount;
            // If Bob (from) pays Alice (to) 20€:
            // balances[Bob] += 20 -> -50 + 20 = -30
            // balances[Alice] -= 20 -> 50 - 20 = 30
            // This means Alice is now owed only 30, and Bob owes only 30. Correct.
            expect(balances['user1']).toBe(30);
            expect(balances['user2']).toBe(-30);
        });
    });

    describe('getMyDebts', () => {
        it('should return who I owe and how much', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user2', amount: 100 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const debts = getMyDebts(users, expenses, settlements, 'user1');

            // Alice (user1) owes Bob (user2) 50€
            expect(debts['user2']).toBe(50);
        });

        it('treats a 1-cent imbalance as settled (rounding dead-band)', () => {
            // user2 paid 1 cent; the leftover cent makes user1's share 1c and user2's 0c,
            // so user1's net balance is exactly -1 cent. The dead-band must treat this as settled.
            const expenses = [{ id: 'tiny', paidById: 'user2', amount: 1 }];
            const debts = getMyDebts(users, expenses, [], 'user1');
            expect(debts).toEqual({});
        });

        it('reports a debt of exactly 2 cents (just outside the dead-band)', () => {
            // user2 paid 4 cents, split 2/2 → user1 owes 2 cents.
            const expenses = [{ id: 'small', paidById: 'user2', amount: 4 }];
            const debts = getMyDebts(users, expenses, [], 'user1');
            expect(debts).toEqual({ user2: 2 });
        });

        it('should return empty object if I am owed money', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 100 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const debts = getMyDebts(users, expenses, settlements, 'user1');

            expect(debts).toEqual({});
        });

        it('should split my debt across multiple creditors', () => {
            const threeUsers = [
                { id: 'user1', name: 'Alice' },
                { id: 'user2', name: 'Bob' },
                { id: 'user3', name: 'Carol' }
            ];
            // Bob paid 90, Carol paid 60. Equal split of each across 3 people.
            // Bob: 90 paid - (90/3=30 share + 60/3=20 share) = 90 - 50 = +40
            // Carol: 60 paid - (30 + 20) = 60 - 50 = +10
            // Alice: 0 - 50 = -50
            const expenses = [
                { id: 'exp1', paidById: 'user2', amount: 90 },
                { id: 'exp2', paidById: 'user3', amount: 60 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const debts = getMyDebts(threeUsers, expenses, settlements, 'user1');

            // Alice owes 50 total, matched to the two creditors (40 to Bob, 10 to Carol).
            expect(debts['user2']).toBe(40);
            expect(debts['user3']).toBe(10);
            const total = Object.values(debts).reduce((a, b) => a + b, 0);
            expect(total).toBe(50);
        });

        it('should only report what the current user owes, not other debtors', () => {
            const fourUsers = [
                { id: 'user1', name: 'Alice' },
                { id: 'user2', name: 'Bob' },
                { id: 'user3', name: 'Carol' },
                { id: 'user4', name: 'Dave' }
            ];
            // Dave paid 400, equal split across 4 -> each share 100.
            // Dave: +300, everyone else: -100.
            const expenses = [
                { id: 'exp1', paidById: 'user4', amount: 400 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const debts = getMyDebts(fourUsers, expenses, settlements, 'user2');

            // Bob (a debtor) owes 100 to the sole creditor Dave.
            expect(debts['user4']).toBe(100);
            // No debt recorded toward fellow debtors.
            expect(debts['user1']).toBeUndefined();
            expect(debts['user3']).toBeUndefined();
        });

        it('should return empty when the current user is settled (multi-party)', () => {
            const threeUsers = [
                { id: 'user1', name: 'Alice' },
                { id: 'user2', name: 'Bob' },
                { id: 'user3', name: 'Carol' }
            ];
            // Alice paid 90 split equally (30 each): Alice +60, Bob -30, Carol -30.
            // Alice is a creditor, owes nothing.
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 90 }
            ];
            const settlements: { fromUserId: string; toUserId: string; amount: number }[] = [];
            const debts = getMyDebts(threeUsers, expenses, settlements, 'user1');

            expect(debts).toEqual({});
        });
    });

    describe('getLastSettlementDate', () => {
        it('should return the epoch for no settlements', () => {
            expect(getLastSettlementDate([]).getTime()).toBe(0);
        });

        it('should return the most recent settlement date', () => {
            const settlements = [
                { date: '2024-01-01T00:00:00.000Z' },
                { date: '2024-03-15T00:00:00.000Z' },
                { date: '2024-02-10T00:00:00.000Z' }
            ];
            const last = getLastSettlementDate(settlements);
            expect(last.toISOString()).toBe('2024-03-15T00:00:00.000Z');
        });

        it('should accept Date objects as well as strings', () => {
            const settlements = [
                { date: new Date('2024-05-01T00:00:00.000Z') },
                { date: new Date('2024-06-01T00:00:00.000Z') }
            ];
            const last = getLastSettlementDate(settlements);
            expect(last.toISOString()).toBe('2024-06-01T00:00:00.000Z');
        });
    });
});
