import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { resolveCategoryId, getEffectiveCategories } from '@/lib/category-db';
import type { Prisma } from '@/generated/prisma/client';

const MAX_ROWS = 2000;

interface ImportRow {
    dateISO: string;      // YYYY-MM-DD
    amountCents: number;  // positive
    description: string;
    category?: string;    // category key; falls back to the batch default
}

/** Stable content fingerprint so re-importing the same statement never duplicates. */
function fingerprint(userId: string, r: ImportRow): string {
    return createHash('sha256')
        .update(`${userId}|${r.dateISO}|${r.amountCents}|${r.description.trim().toLowerCase()}`)
        .digest('hex');
}

/**
 * Bank CSV import (decouple F2): create a batch of PERSONAL expenses from
 * client-parsed + mapped rows. Idempotent via Expense.importFingerprint — rows
 * whose fingerprint already exists (or repeat within the batch) are skipped.
 */
export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = session.userId as string;

    let body: { rows?: ImportRow[]; defaultCategory?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const rows = body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
        return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }
    if (rows.length > MAX_ROWS) {
        return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS})` }, { status: 400 });
    }

    // Effective personal category set (system ∪ this user's personal-custom). Import
    // creates PERSONAL expenses, so the valid keys are the ownerId-scoped merge; an
    // unknown key is rejected (no silent 'other', mirroring the expenses API).
    const effective = await getEffectiveCategories({ ownerId: userId });
    const validKeys = new Set(effective.map((c) => c.key));

    const defaultCategory =
        typeof body.defaultCategory === 'string' && body.defaultCategory.trim().length > 0
            ? body.defaultCategory.trim()
            : 'other';
    if (!validKeys.has(defaultCategory)) {
        return NextResponse.json({ error: `Categoría desconocida: ${defaultCategory}` }, { status: 400 });
    }

    // Validate every row up-front; a bad row fails the whole import (all-or-nothing
    // is clearer for the user than a partial import).
    for (const r of rows) {
        if (typeof r?.dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.dateISO)) {
            return NextResponse.json({ error: `Invalid date: ${r?.dateISO}` }, { status: 400 });
        }
        if (!Number.isInteger(r.amountCents) || r.amountCents <= 0) {
            return NextResponse.json({ error: `Invalid amount for "${r?.description}"` }, { status: 400 });
        }
        if (typeof r.description !== 'string' || r.description.trim().length === 0) {
            return NextResponse.json({ error: 'A row has an empty description' }, { status: 400 });
        }
        if (r.category !== undefined && (typeof r.category !== 'string' || !validKeys.has(r.category))) {
            return NextResponse.json({ error: `Categoría desconocida: ${r.category}` }, { status: 400 });
        }
    }

    // Resolve category ids once, scoped by ownerId so a personal-custom key wins
    // over the system row before the fallback.
    const categoryCache = new Map<string, string | null>();
    async function categoryIdFor(key: string): Promise<string | null> {
        const k = key || defaultCategory;
        if (!categoryCache.has(k)) categoryCache.set(k, await resolveCategoryId(k, { ownerId: userId }));
        return categoryCache.get(k) ?? null;
    }

    // Dedup: skip fingerprints already stored for this owner, and repeats within
    // the batch. createMany({ skipDuplicates }) is the final race guard.
    const fingerprints = rows.map((r) => fingerprint(userId, r));
    const existing = await prisma.expense.findMany({
        where: { ownerId: userId, importFingerprint: { in: fingerprints } },
        select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));

    const data: Prisma.ExpenseCreateManyInput[] = [];
    for (let i = 0; i < rows.length; i++) {
        const fp = fingerprints[i];
        if (seen.has(fp)) continue; // already imported or duplicated in this batch
        seen.add(fp);
        const r = rows[i];
        data.push({
            description: r.description.trim(),
            amount: r.amountCents,
            date: new Date(`${r.dateISO}T12:00:00`), // local noon avoids tz day-shift
            categoryId: await categoryIdFor(r.category ?? defaultCategory),
            paidById: userId,
            ownerId: userId,
            visibility: 'PERSONAL',
            coupleId: null,
            importFingerprint: fp,
        });
    }

    if (data.length === 0) {
        return NextResponse.json({ created: 0, skipped: rows.length });
    }

    try {
        const result = await prisma.expense.createMany({ data, skipDuplicates: true });
        return NextResponse.json({ created: result.count, skipped: rows.length - result.count });
    } catch (error) {
        console.error('CSV import failed:', error);
        return NextResponse.json({ error: 'Error al importar' }, { status: 500 });
    }
}
