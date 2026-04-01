import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TagsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { couple: true },
    });

    if (!user?.couple) redirect("/dashboard");

    const tags = await prisma.tag.findMany({
        where: { coupleId: user.couple.id },
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
