import { prisma } from "@/lib/db";
import { getActiveGroup } from "@/lib/membership";
import { getListsForScope, getListWithItems, listVersionOf, type ListSummary } from "@/lib/list-read";
import { MembershipStatus } from "@/generated/prisma/enums";
import type { ListWriteScope } from "@/lib/list-crud";
import type { ShoppingItem } from "@/components/shopping/shopping-item-row";

export interface HubList {
    id: string;
    name: string;
    /** Owning group for a Común list, null for a personal one. */
    groupId: string | null;
    pendingCount: number;
}

export interface HubSelected {
    id: string;
    name: string;
    groupId: string | null;
    items: ShoppingItem[];
    /** Change stamp (see listVersionStamp): the poll refreshes only when it moves. */
    version: string;
}

export interface ListsHubData {
    /** Group whose Común lists are shown (null → personal only). */
    groupId: string | null;
    /**
     * Lifecycle of that group. Lists stay editable while SETTLING (planning is
     * not spending); ARCHIVED makes its Común lists read-only.
     */
    groupStatus: string | null;
    groupLists: HubList[];
    personalLists: HubList[];
    selected: HubSelected | null;
}

const toHub = (groupId: string | null) => (l: ListSummary): HubList => ({
    id: l.id,
    name: l.name,
    groupId,
    pendingCount: l.itemCount - l.checkedCount,
});

/**
 * Resolve the scope of a list for `userId`: a group list requires an ACTIVE
 * membership of its owning group, a personal list must be owned by the caller.
 * Returns null when missing or not accessible.
 */
async function resolveListScope(userId: string, listId: string): Promise<ListWriteScope | null> {
    const raw = await prisma.shoppingList.findUnique({
        where: { id: listId },
        select: { groupId: true, ownerId: true },
    });
    if (!raw) return null;
    if (raw.groupId) {
        const membership = await prisma.membership.findUnique({
            where: { groupId_userId: { groupId: raw.groupId, userId } },
        });
        if (!membership || membership.status !== MembershipStatus.ACTIVE) return null;
        return { kind: "group", groupId: raw.groupId };
    }
    return raw.ownerId === userId ? { kind: "owner", ownerId: userId } : null;
}

/**
 * Data for the Listas screen: chips for every Común list of the space plus the
 * caller's personal lists, and the selected list with its items. Without a
 * `listId` the first list (Común first) is selected. Returns null when `listId`
 * is given but not accessible (the page redirects to /lists).
 */
export async function loadListsHub(userId: string, listId?: string): Promise<ListsHubData | null> {
    let selectedScope: ListWriteScope | null = null;
    if (listId) {
        selectedScope = await resolveListScope(userId, listId);
        if (!selectedScope) return null;
    }

    // A group list opened by URL shows its own group's lists (it may not be the
    // active space); otherwise the active space's lists.
    const groupId = selectedScope?.kind === "group" ? selectedScope.groupId : await getActiveGroup(userId);

    const [groupSummaries, personalSummaries, group] = await Promise.all([
        groupId ? getListsForScope({ kind: "group", groupId }) : Promise.resolve([]),
        getListsForScope({ kind: "owner", ownerId: userId }),
        groupId ? prisma.couple.findUnique({ where: { id: groupId }, select: { status: true } }) : Promise.resolve(null),
    ]);
    const groupLists = groupSummaries.map(toHub(groupId));
    const personalLists = personalSummaries.map(toHub(null));

    if (!selectedScope) {
        const first = groupLists[0] ?? personalLists[0];
        if (first) {
            listId = first.id;
            selectedScope = first.groupId ? { kind: "group", groupId: first.groupId } : { kind: "owner", ownerId: userId };
        }
    }

    let selected: HubSelected | null = null;
    if (listId && selectedScope) {
        const list = await getListWithItems(selectedScope, listId);
        if (!list) return null;
        selected = {
            id: list.id,
            name: list.name,
            groupId: list.groupId,
            version: listVersionOf(list),
            items: list.items.map((i) => ({
                id: i.id,
                name: i.name,
                quantity: i.quantity,
                unit: i.unit,
                note: i.note,
                aisle: i.aisle,
                checked: i.checked,
            })),
        };
    }

    return { groupId, groupStatus: group?.status ?? null, groupLists, personalLists, selected };
}
