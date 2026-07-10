/**
 * Phase 4 pre-flight for 20260708220000_phase4_check_constraints. READ-ONLY.
 *
 * Counts rows that would violate each CHECK constraint the migration adds.
 * MySQL/MariaDB validate existing rows when a CHECK is added, so the ALTERs
 * fail outright if any row violates — the operator runs this FIRST to know.
 *
 * Enforced predicates (exit non-zero if ANY row violates):
 *   Expense.amount       > 0        (chk_expense_amount_positive)
 *   Expense.minorUnit    >= 0       (chk_expense_minorunit_nonneg)
 *   Settlement.amount    >= 0       (chk_settlement_amount_nonneg)  -- 0 is a
 *                                    legit "checkpoint" settlement, hence >= 0
 *   Settlement.minorUnit >= 0       (chk_settlement_minorunit_nonneg)
 *   Budget.amount        > 0        (chk_budget_amount_positive)
 *   Budget.minorUnit     >= 0       (chk_budget_minorunit_nonneg)
 *
 * INFORMATIONAL ONLY (no constraint shipped, does NOT affect the exit code):
 *   Split.amount < 0 — a negative split is reachable via the ITEMIZED
 *   diff-adjust in src/lib/splits.ts (splits[0].amount += diff), so the
 *   migration deliberately omits a Split CHECK. A non-zero count here is
 *   still data worth investigating (see scripts/fix-exclusive-splits.ts).
 *
 * Run:  npx tsx scripts/validate-check-constraints.ts
 */
import { prisma } from '../src/lib/db';

interface CheckResult {
    constraint: string;
    predicate: string;
    violations: number;
}

async function main() {
    const checks: CheckResult[] = [
        {
            constraint: 'chk_expense_amount_positive',
            predicate: 'Expense.amount > 0',
            violations: await prisma.expense.count({ where: { amount: { lte: 0 } } }),
        },
        {
            constraint: 'chk_expense_minorunit_nonneg',
            predicate: 'Expense.minorUnit >= 0',
            violations: await prisma.expense.count({ where: { minorUnit: { lt: 0 } } }),
        },
        {
            constraint: 'chk_settlement_amount_nonneg',
            predicate: 'Settlement.amount >= 0',
            violations: await prisma.settlement.count({ where: { amount: { lt: 0 } } }),
        },
        {
            constraint: 'chk_settlement_minorunit_nonneg',
            predicate: 'Settlement.minorUnit >= 0',
            violations: await prisma.settlement.count({ where: { minorUnit: { lt: 0 } } }),
        },
        {
            constraint: 'chk_budget_amount_positive',
            predicate: 'Budget.amount > 0',
            violations: await prisma.budget.count({ where: { amount: { lte: 0 } } }),
        },
        {
            constraint: 'chk_budget_minorunit_nonneg',
            predicate: 'Budget.minorUnit >= 0',
            violations: await prisma.budget.count({ where: { minorUnit: { lt: 0 } } }),
        },
    ];

    let failed = false;
    for (const c of checks) {
        const status = c.violations === 0 ? 'OK  ' : 'FAIL';
        console.log(`${status}  ${c.constraint.padEnd(36)} ${c.predicate.padEnd(28)} violations=${c.violations}`);
        if (c.violations > 0) failed = true;
    }

    // Informational: no CHECK is shipped for Split (negative reachable via the
    // ITEMIZED diff-adjust; zero is legitimate). Reported for visibility only.
    const negativeSplits = await prisma.split.count({ where: { amount: { lt: 0 } } });
    const zeroSplits = await prisma.split.count({ where: { amount: 0 } });
    console.log(`INFO  (no constraint)                     Split.amount < 0             count=${negativeSplits}`);
    console.log(`INFO  (no constraint)                     Split.amount = 0 (legit)     count=${zeroSplits}`);
    if (negativeSplits > 0) {
        console.log('INFO  negative splits exist — investigate (scripts/fix-exclusive-splits.ts) but this does not block the migration.');
    }

    if (failed) {
        console.error('\nVALIDATION FAILED — do NOT apply 20260708220000_phase4_check_constraints until violating rows are repaired.');
        process.exit(1);
    }
    console.log('\nAll enforced predicates satisfied — safe to apply 20260708220000_phase4_check_constraints.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
