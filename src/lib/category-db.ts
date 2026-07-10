import { prisma } from './db';

/**
 * Resolve the relational Category id for a category key (Phase 2b dual-write).
 * Returns the group-custom category if one exists for `groupId`, else the system
 * (global, groupId = null) category, else null. Callers keep writing the enum
 * `category` column too; categoryId is a mirror until the read-switch/contract.
 */
export async function resolveCategoryId(key: string, groupId?: string | null): Promise<string | null> {
    if (groupId) {
        const custom = await prisma.category.findFirst({
            where: { groupId, key },
            select: { id: true },
        });
        if (custom) return custom.id;
    }
    const system = await prisma.category.findFirst({
        where: { groupId: null, key },
        select: { id: true },
    });
    return system?.id ?? null;
}
