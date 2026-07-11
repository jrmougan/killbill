import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getActiveGroup } from "@/lib/membership";
import { redirect } from "next/navigation";
import { TagsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    // Fase 1: tags can be group-scoped (coupleId) OR personal (ownerId). A user
    // always sees their personal tags — the group-less "wall" is gone (personal
    // mode is operative).
    const groupId = await getActiveGroup(userId);

    const tags = await prisma.tag.findMany({
        where: groupId
            ? { OR: [{ coupleId: groupId }, { ownerId: userId }] }
            : { ownerId: userId },
        orderBy: { name: "asc" },
    });

    const tagData = tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        // A personal tag has an ownerId and no group scope.
        personal: t.coupleId === null && t.ownerId === userId,
    }));

    return <TagsClient initialTags={tagData} hasGroup={Boolean(groupId)} />;
}
