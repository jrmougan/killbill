import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getActiveGroup } from "@/lib/membership";
import { getListsForScope, type ListSummary } from "@/lib/list-read";
import { ListsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ListsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const groupId = await getActiveGroup(userId);

    // Load both scopes up-front so the segmented toggle is instant. Personal lists
    // are always available; group lists only when the user has an active group.
    const [groupLists, personalLists]: [ListSummary[], ListSummary[]] = await Promise.all([
        groupId ? getListsForScope({ kind: "group", groupId }) : Promise.resolve([]),
        getListsForScope({ kind: "owner", ownerId: userId }),
    ]);

    return (
        <ListsClient
            groupId={groupId}
            initialGroupLists={groupLists}
            initialPersonalLists={personalLists}
        />
    );
}
