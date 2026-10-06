import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { resolveCategoryId, getEffectiveCategories } from '@/lib/category-db';
import type { Prisma } from '@/generated/prisma/client';
import { checkExpenseDay } from '@/lib/expense-input';
import { badRequest, route } from '@/lib/http';
import { jsonObject } from '@/lib/http/schemas';

const MAX_ROWS = 2000;
/** 999.999,99 € — same ceiling as POST /api/expenses. */
const MAX_AMOUNT_CENTS = 99_999_999;

interface ImportRow {
    dateISO: string;      // YYYY-MM-DD
    amountCents: number;  // positive
    description: string;
    category?: string;    // category key; falls back to the batch default
}

/**
 * One client-parsed row. Context-free checks with the historical messages
 * (which quote the row's description); whether `category` exists in the
 * effective set is checked by the handler.
 */
const ImportRowSchema = z.unknown().transform((raw, ctx): ImportRow => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const fail = (message: string) => {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
    };
    // Real calendar day in [2000-01-01, today + 1 year] (G-06: 31/02 is not 3/03).
    const day = typeof r.dateISO === 'string' ? checkExpenseDay(r.dateISO) : { ok: false as const, error: 'Fecha inválida' };
    if (!day.ok) return fail(`${day.error} ("${r.description ?? ''}")`);
    const { amountCents, description, category } = r;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_AMOUNT_CENTS) {
        return fail(`Importe no válido en "${r.description}"`);
    }
    if (typeof description !== 'string' || description.trim().length === 0) return fail('Hay un movimiento sin concepto');
    if (category !== undefined && typeof category !== 'string') return fail(`Categoría desconocida: ${category}`);
    return { dateISO: r.dateISO as string, amountCents, description, ...(category !== undefined ? { category } : {}) };
});

const NO_ROWS = 'No hay movimientos que importar';
const ImportBody = jsonObject({
    // A bad row fails the whole import (all-or-nothing is clearer for the user
    // than a partial import).
    rows: z.array(ImportRowSchema, { error: NO_ROWS })
        .min(1, NO_ROWS)
        .max(MAX_ROWS, `Demasiadas filas (máximo ${MAX_ROWS})`),
    defaultCategory: z.string().nullish(),
}, NO_ROWS);

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
export const POST = route(
    {
        auth: 'user',
        guestMessage: 'Los invitados no pueden importar movimientos',
        body: ImportBody,
        errorMessage: 'Error al importar',
        logLabel: 'CSV import failed:',
    },
    async ({ ctx, body }) => {
        const userId = ctx.userId;
        const { rows } = body;

        // Effective personal category set (system ∪ this user's personal-custom). Import
        // creates PERSONAL expenses, so the valid keys are the ownerId-scoped merge; an
        // unknown key is rejected (no silent 'other', mirroring the expenses API).
        const effective = await getEffectiveCategories({ ownerId: userId });
        const validKeys = new Set(effective.map((c) => c.key));

        const defaultCategory = body.defaultCategory?.trim() || 'other';
        if (!validKeys.has(defaultCategory)) throw badRequest(`Categoría desconocida: ${defaultCategory}`);
        const unknownRow = rows.find((r) => r.category !== undefined && !validKeys.has(r.category));
        if (unknownRow) throw badRequest(`Categoría desconocida: ${unknownRow.category}`);

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
                date: new Date(`${r.dateISO}T12:00:00.000Z`), // 12:00 UTC like POST /api/expenses: stable day in Madrid
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

        const result = await prisma.expense.createMany({ data, skipDuplicates: true });
        return NextResponse.json({ created: result.count, skipped: rows.length - result.count });
    },
);
