import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ListsHub } from "@/components/shopping/lists-hub";
import { loadListsHub } from "./load";

export const dynamic = "force-dynamic";

/** Listas tab: opens straight onto the first list (Común first). */
export default async function ListsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const data = await loadListsHub(session.userId as string);
    if (!data) redirect("/dashboard");
    return <ListsHub {...data} />;
}
