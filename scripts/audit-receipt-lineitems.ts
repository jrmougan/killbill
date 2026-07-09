/**
 * Phase 4 (task "receipt-full") pre-flight — receiptData JSON vs ReceiptLineItem
 * parity audit. READ-ONLY by default; `--fix` rebuilds divergent rows from the
 * JSON (the JSON stays authoritative until its gated DROP).
 *
 * Run BEFORE deploying the receipt read-switch (detail/edit pages, analytics,
 * SHARE + PATCH stored-receipt re-split). Must be GREEN (exit 0) first.
 *
 * HARD GATES (exit 1 on any hit):
 *   G1  COVERAGE — every expense with a non-empty receiptData JSON array has
 *       at least one ReceiptLineItem row (the task's mandated pre-flight:
 *       COUNT(non-empty receiptData AND 0 line items) == 0).
 *   G2  SPLIT PARITY — for every expense with receipt JSON, the OLD stored-read
 *       split (calculateSplitAmounts over the euro-float JSON) equals the NEW
 *       stored-read split (cents-native algorithm over the ReceiptLineItem
 *       rows), member-for-member, cent-for-cent. Members are resolved exactly
 *       as the routes do: getGroupMembers(expense.coupleId) for SHARED, and
 *       getGroupMembers(owner.coupleId) for PERSONAL (what a future SHARE
 *       promotion would use). Expenses whose member set is <2 are skipped —
 *       both paths degenerate identically there.
 *   G2b STRATEGY PARITY — hasExclusiveReceiptItems(JSON) must equal
 *       "rows have a non-null assignedToId" (drives ITEMIZED vs EQUAL).
 *
 * WARNINGS (reported; rewritten by --fix; exit 1 only with --strict):
 *   W1  ROW DRIFT — rows differ from buildReceiptLineItems(JSON, validIds)
 *       (description/quantity/unitPrice/lineTotal/position/assignedToId).
 *       Known expected case: PERSONAL expenses created while the POST route
 *       validated assignees against an EMPTY member set — their rows carry
 *       assignedToId = null although the JSON assigns items. That nulling is
 *       exactly what breaks G2/G2b for share-candidates, so run `--fix`
 *       (rebuilds rows from JSON) and re-run to green.
 *
 * The cents-native split mirror below MUST stay in lockstep with
 * calculateSplitAmountsFromLines in src/lib/splits.ts (the unit parity suite in
 * src/lib/splits.test.ts pins the real function; this local copy keeps the
 * pre-flight runnable independently of the app edit landing).
 *
 * Run:  npx tsx scripts/audit-receipt-lineitems.ts [--fix] [--strict]
 */
import { prisma } from '../src/lib/db';
import { getGroupMembers } from '../src/lib/membership';
import { calculateSplitAmounts, hasExclusiveReceiptItems, type ReceiptItemForSplit } from '../src/lib/splits';
import { buildReceiptLineItems, type ReceiptLineInput } from '../src/lib/receipt';

const FIX = process.argv.includes('--fix');
const STRICT = process.argv.includes('--strict');

interface LineForSplit {
    lineTotal: number;
    assignedToId: string | null;
}

/** Mirror of splits.ts calculateSplitAmountsFromLines (cents-native core). */
function splitFromLines(
    amountCents: number,
    lines: LineForSplit[] | null | undefined,
    members: { id: string }[],
): { userId: string; amount: number }[] {
    const hasExclusive = lines?.some((l) => l.assignedToId) ?? false;
    if (!hasExclusive || !lines || members.length < 2) {
        const base = Math.floor(amountCents / members.length);
        const remainder = amountCents - base * members.length;
        return members.map((m, i) => ({ userId: m.id, amount: base + (i < remainder ? 1 : 0) }));
    }
    let commonTotal = 0;
    const exclusiveByUser: Record<string, number> = {};
    for (const line of lines) {
        if (line.assignedToId) {
            exclusiveByUser[line.assignedToId] = (exclusiveByUser[line.assignedToId] || 0) + line.lineTotal;
        } else {
            commonTotal += line.lineTotal;
        }
    }
    const n = members.length;
    const commonBase = Math.floor(commonTotal / n);
    const commonRemainder = commonTotal - commonBase * n;
    const splits = members.map((m, i) => ({
        userId: m.id,
        amount: commonBase + (i < commonRemainder ? 1 : 0) + (exclusiveByUser[m.id] || 0),
    }));
    const sum = splits.reduce((acc, s) => acc + s.amount, 0);
    const diff = amountCents - sum;
    if (diff !== 0) splits[0].amount += diff;
    return splits;
}

function sameRow(a: ReceiptLineInput, b: ReceiptLineInput): boolean {
    return (
        a.description === b.description &&
        a.quantity === b.quantity &&
        a.unitPrice === b.unitPrice &&
        a.lineTotal === b.lineTotal &&
        a.position === b.position &&
        a.assignedToId === b.assignedToId
    );
}

async function main() {
    // JSON-null filtering is awkward in Prisma; the table is small (~150 rows
    // with receipts in live data), so fetch all and skip non-array JSON below.
    const expenses = await prisma.expense.findMany({
        select: {
            id: true,
            amount: true,
            visibility: true,
            coupleId: true,
            ownerId: true,
            receiptData: true,
            lineItems: { orderBy: { position: 'asc' } },
        },
    });

    // Member sets are cached per group so 146 expenses don't refetch per row.
    const membersByGroup = new Map<string, { id: string }[]>();
    async function membersOf(groupId: string): Promise<{ id: string }[]> {
        let m = membersByGroup.get(groupId);
        if (!m) {
            m = (await getGroupMembers(groupId)).map((u) => ({ id: u.id }));
            membersByGroup.set(groupId, m);
        }
        return m;
    }
    const ownerCoupleCache = new Map<string, string | null>();
    async function ownerCoupleId(ownerId: string | null): Promise<string | null> {
        if (!ownerId) return null;
        if (!ownerCoupleCache.has(ownerId)) {
            const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { coupleId: true } });
            ownerCoupleCache.set(ownerId, owner?.coupleId ?? null);
        }
        return ownerCoupleCache.get(ownerId) ?? null;
    }

    let audited = 0;
    let coverageGaps = 0; // G1
    let splitMismatches = 0; // G2
    let strategyMismatches = 0; // G2b
    let rowDrift = 0; // W1
    let fixed = 0;

    for (const e of expenses) {
        const json = e.receiptData;
        if (!Array.isArray(json) || json.length === 0) continue; // null / {} / [] — nothing to read
        audited++;

        // G1 — coverage
        if (e.lineItems.length === 0) {
            coverageGaps++;
            console.error(`G1 COVERAGE expense=${e.id} receiptData has ${json.length} items but 0 ReceiptLineItem rows`);
            // --fix below rebuilds rows for this expense too (expected == rebuilt rows).
        }

        // Resolve the member set exactly like the read-switched routes do.
        const groupId = e.visibility === 'SHARED' ? e.coupleId : await ownerCoupleId(e.ownerId);
        const members = groupId ? await membersOf(groupId) : [];
        const validIds = new Set(members.map((m) => m.id));

        const expected = buildReceiptLineItems(json, validIds);

        // W1 — row drift vs the canonical JSON->rows mapping
        const actual: ReceiptLineInput[] = e.lineItems.map((r, i) => ({
            description: r.description,
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            lineTotal: r.lineTotal,
            // Compare against the re-normalised position index, matching expected.
            position: i,
            assignedToId: r.assignedToId,
        }));
        const drifted =
            expected.length !== actual.length || expected.some((row, i) => !sameRow(row, actual[i]));
        if (drifted && e.lineItems.length > 0) {
            rowDrift++;
            console.warn(`W1 ROW-DRIFT expense=${e.id} rows differ from buildReceiptLineItems(receiptData)`);
        }

        // G2/G2b — split + strategy parity (only meaningful with >=2 members;
        // with <2 both paths take the same degenerate branch).
        if (members.length >= 2) {
            const oldSplits = calculateSplitAmounts(e.amount, json as unknown as ReceiptItemForSplit[], members);
            const rows: LineForSplit[] = e.lineItems.map((r) => ({ lineTotal: r.lineTotal, assignedToId: r.assignedToId }));
            const newSplits = splitFromLines(e.amount, rows, members);
            const same =
                oldSplits.length === newSplits.length &&
                oldSplits.every((s, i) => s.userId === newSplits[i].userId && s.amount === newSplits[i].amount);
            if (!same) {
                splitMismatches++;
                console.error(
                    `G2 SPLIT-PARITY expense=${e.id} old=${JSON.stringify(oldSplits)} new=${JSON.stringify(newSplits)}`,
                );
            }
            const oldItemized = hasExclusiveReceiptItems(json);
            const newItemized = rows.some((r) => r.assignedToId);
            if (oldItemized !== newItemized) {
                strategyMismatches++;
                console.error(`G2b STRATEGY expense=${e.id} json-itemized=${oldItemized} rows-itemized=${newItemized}`);
            }
        }

        // --fix: rebuild rows from the JSON (delete + create, atomic per expense).
        if (FIX && (drifted || e.lineItems.length === 0)) {
            await prisma.$transaction(async (tx) => {
                await tx.receiptLineItem.deleteMany({ where: { expenseId: e.id } });
                if (expected.length > 0) {
                    await tx.receiptLineItem.createMany({
                        data: expected.map((l) => ({ ...l, expenseId: e.id })),
                    });
                }
            });
            fixed++;
            console.log(`FIXED expense=${e.id} rows rebuilt from receiptData (${expected.length} rows)`);
        }
    }

    const hardFails = coverageGaps + splitMismatches + strategyMismatches;
    const ok = FIX ? true : hardFails === 0 && (!STRICT || rowDrift === 0);
    console.log(
        `Receipt audit ${ok ? 'PASS' : 'FAIL'}: ${audited} expenses with receipt JSON audited — ` +
        `${coverageGaps} coverage gaps, ${splitMismatches} split mismatches, ` +
        `${strategyMismatches} strategy mismatches, ${rowDrift} row drifts` +
        (FIX ? `, ${fixed} fixed (RE-RUN WITHOUT --fix TO VERIFY GREEN)` : '') + '.',
    );
    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error('Receipt audit failed:', err);
    process.exit(1);
});
