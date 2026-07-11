import { prisma } from './db';
import {
    CATEGORY_META_SELECT,
    mergeCategories,
    type CategoryMeta,
    type CategoryRow,
} from './category-read';

/**
 * Ownership context for category resolution/reads. XOR by convention (Tag/Budget
 * pattern): a shared expense/budget carries `groupId`; a personal one (INDIVIDUAL
 * mode, no Couple row) carries `ownerId`. Neither → system-only.
 */
export interface CategoryScope {
    groupId?: string | null;
    ownerId?: string | null;
}

/**
 * Resolve the relational Category id for a category key (Phase 2b dual-write).
 *
 * Tri-layer lookup:
 *   1. group-custom `(groupId, key)` when a `groupId` is given (shared context);
 *   2. else personal-custom `(ownerId, key)` when an `ownerId` is given
 *      (INDIVIDUAL context);
 *   3. else the system row `(groupId=null, ownerId=null, key)`.
 *
 * `findFirst` on purpose: MySQL does not enforce UNIQUE over NULL discriminants,
 * so the seed/resolution paths never rely on the composite uniques matching NULL.
 */
export async function resolveCategoryId(key: string, scope?: CategoryScope): Promise<string | null> {
    const groupId = scope?.groupId ?? null;
    const ownerId = scope?.ownerId ?? null;

    if (groupId) {
        const custom = await prisma.category.findFirst({
            where: { groupId, key },
            select: { id: true },
        });
        if (custom) return custom.id;
    } else if (ownerId) {
        const custom = await prisma.category.findFirst({
            where: { ownerId, key },
            select: { id: true },
        });
        if (custom) return custom.id;
    }

    const system = await prisma.category.findFirst({
        where: { groupId: null, ownerId: null, key },
        select: { id: true },
    });
    return system?.id ?? null;
}

/**
 * Effective category set for a context (system ∪ context-custom, custom shadowing
 * system by key, ordered by (sortOrder, key)). Reusable by API routes and server
 * components; the merge is a pure helper in category-read.ts.
 */
export async function getEffectiveCategories(scope?: CategoryScope): Promise<CategoryMeta[]> {
    const groupId = scope?.groupId ?? null;
    const ownerId = scope?.ownerId ?? null;

    const system = (await prisma.category.findMany({
        where: { groupId: null, ownerId: null },
        select: CATEGORY_META_SELECT,
    })) as CategoryRow[];

    let custom: CategoryRow[] = [];
    if (groupId) {
        custom = (await prisma.category.findMany({
            where: { groupId },
            select: CATEGORY_META_SELECT,
        })) as CategoryRow[];
    } else if (ownerId) {
        custom = (await prisma.category.findMany({
            where: { ownerId },
            select: CATEGORY_META_SELECT,
        })) as CategoryRow[];
    }

    return mergeCategories(system, custom);
}
