import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ListsHub } from "@/components/shopping/lists-hub";
import { loadListsHub } from "../load";

export const dynamic = "force-dynamic";

/** A specific list selected in the Listas screen (deep-linkable). */
export default async function ListDetailPage({ params }: { params: Promise<{ listId: string }> }) {
    const { listId } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const data = await loadListsHub(session.userId as string, listId);
    if (!data?.selected) redirect("/lists");
    return <ListsHub {...data} />;
}
