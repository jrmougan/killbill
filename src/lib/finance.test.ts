import { describe, it, expect } from 'vitest';
import { calculateBalances, getMyDebts } from './finance';

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
            const settlements: any[] = [];
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
            const settlements: any[] = [];
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
            const settlements: any[] = [];
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
            const settlements: any[] = [];
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
            const settlements: any[] = [];
            const debts = getMyDebts(users, expenses, settlements, 'user1');

            // Alice (user1) owes Bob (user2) 50€
            expect(debts['user2']).toBe(50);
        });

        it('should return empty object if I am owed money', () => {
            const expenses = [
                { id: 'exp1', paidById: 'user1', amount: 100 }
            ];
            const settlements: any[] = [];
            const debts = getMyDebts(users, expenses, settlements, 'user1');

            expect(debts).toEqual({});
        });
    });
});
