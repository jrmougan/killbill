import { prisma } from "./db";
import type { ListWriteScope } from "./list-crud";

/** A list summary for the index view: counts of items and how many are checked. */
export interface ListSummary {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
    itemCount: number;
    checkedCount: number;
}

function scopeWhere(scope: ListWriteScope): { groupId: string } | { ownerId: string } {
    return scope.kind === "group" ? { groupId: scope.groupId } : { ownerId: scope.ownerId };
}

/** All lists of a scope with lightweight per-list stats, ordered by sortOrder then age. */
export async function getListsForScope(scope: ListWriteScope): Promise<ListSummary[]> {
    const lists = await prisma.shoppingList.findMany({
        where: scopeWhere(scope),
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { items: { select: { checked: true } } },
    });
    return lists.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        sortOrder: l.sortOrder,
        itemCount: l.items.length,
        checkedCount: l.items.filter((i) => i.checked).length,
    }));
}

/**
 * Change stamp of a list: item count + newest item `updatedAt` + the list's own
 * `updatedAt` (rename). Any add / edit / toggle / delete / clear-checked moves
 * it, so the Listas poll only re-renders the screen when something changed.
 */
export function listVersionStamp(listUpdatedAt: Date, itemCount: number, maxItemUpdatedAt: Date | null): string {
    return `${itemCount}.${maxItemUpdatedAt?.getTime() ?? 0}.${listUpdatedAt.getTime()}`;
}

/** Same stamp computed from an already loaded list (no extra query). */
export function listVersionOf(list: { updatedAt: Date; items: { updatedAt: Date }[] }): string {
    const max = list.items.reduce<Date | null>((acc, i) => (!acc || i.updatedAt > acc ? i.updatedAt : acc), null);
    return listVersionStamp(list.updatedAt, list.items.length, max);
}

/**
 * Cheap version of a list for polling (2 indexed queries, no item rows), or
 * null if missing / out of scope. Authorization is the caller's (route) job.
 */
export async function getListVersion(scope: ListWriteScope, listId: string): Promise<string | null> {
    const list = await prisma.shoppingList.findFirst({
        where: { id: listId, ...scopeWhere(scope) },
        select: { updatedAt: true },
    });
    if (!list) return null;
    const agg = await prisma.shoppingListItem.aggregate({
        where: { listId },
        _count: { _all: true },
        _max: { updatedAt: true },
    });
    return listVersionStamp(list.updatedAt, agg._count._all, agg._max.updatedAt);
}

/** A single list with its items (ordered), or null if missing / out of scope. */
export async function getListWithItems(scope: ListWriteScope, listId: string) {
    const list = await prisma.shoppingList.findUnique({
        where: { id: listId },
        include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    if (!list) return null;
    const inScope = scope.kind === "group" ? list.groupId === scope.groupId : list.ownerId === scope.ownerId;
    if (!inScope) return null;
    return list;
}
