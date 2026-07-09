import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPrimaryGroup, getGroupMembers } from "@/lib/membership";
import { redirect } from "next/navigation";
import { SettingsClient } from "./settings-client";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Ajustes · EQUIL - Finanzas Compartidas",
    description: "Configura tu perfil y tu grupo en EQUIL.",
};

export default async function SettingsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) redirect("/login");

    // Phase 5 (WS1): resolve the group + members via the Membership layer.
    const groupId = await getPrimaryGroup(userId);
    const [couple, members] = groupId
        ? await Promise.all([
            prisma.couple.findUnique({ where: { id: groupId } }),
            getGroupMembers(groupId),
        ])
        : [null, []];

    return (
        <SettingsClient
            user={{
                id: user.id,
                name: user.name,
                email: user.email || "",
                avatar: user.avatar || "👤"
            }}
            couple={couple ? {
                id: couple.id,
                name: couple.name || "Nuestra Pareja",
                code: couple.code,
                members: members.map(m => ({
                    id: m.id,
                    name: m.name,
                    avatar: m.avatar || "👤"
                }))
            } : null}
        />
    );
}
