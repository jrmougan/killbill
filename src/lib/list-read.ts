import { prisma } from "./db";
import type { ListWriteScope } from "./list-crud";

/** A list summary for the index view: counts + the total of its checked, priced items. */
export interface ListSummary {
    id: string;
    name: string;
    description: string | null;
    sortOrder: number;
    itemCount: number;
    checkedCount: number;
    /** Sum (cents) of checked items that carry a price. */
    totalCents: number;
}

function scopeWhere(scope: ListWriteScope): { groupId: string } | { ownerId: string } {
    return scope.kind === "group" ? { groupId: scope.groupId } : { ownerId: scope.ownerId };
}

/** All lists of a scope with lightweight per-list stats, ordered by sortOrder then age. */
export async function getListsForScope(scope: ListWriteScope): Promise<ListSummary[]> {
    const lists = await prisma.shoppingList.findMany({
        where: scopeWhere(scope),
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: { items: { select: { checked: true, priceCents: true } } },
    });
    return lists.map((l) => {
        const checked = l.items.filter((i) => i.checked);
        const totalCents = checked.reduce((s, i) => s + (i.priceCents ?? 0), 0);
        return {
            id: l.id,
            name: l.name,
            description: l.description,
            sortOrder: l.sortOrder,
            itemCount: l.items.length,
            checkedCount: checked.length,
            totalCents,
        };
    });
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
