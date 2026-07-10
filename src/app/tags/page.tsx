import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup } from "@/lib/membership";
import { NoGroupState } from "@/components/ui/no-group-state";
import { redirect } from "next/navigation";
import { TagsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Phase 5 (WS1): resolve the group via the Membership layer.
    const groupId = await getActiveGroup(userId);
    if (!groupId) return <NoGroupState title="Etiquetas del grupo" />;

    const tags = await prisma.tag.findMany({
        where: { coupleId: groupId },
        orderBy: { name: "asc" },
    });

    const tagData = tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        coupleId: t.coupleId,
    }));

    return <TagsClient initialTags={tagData} />;
}
