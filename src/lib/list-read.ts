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
