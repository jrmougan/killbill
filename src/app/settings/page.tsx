import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getUserGroups, getActiveGroup } from "@/lib/membership";
import { redirect } from "next/navigation";
import { SettingsClient } from "./settings-client";
import { Metadata } from "next";
import { isPersonalParam } from "./personal-scope";

export const metadata: Metadata = {
    title: "Ajustes · EQUIL - Finanzas Compartidas",
    description: "Configura tu perfil y tu grupo en EQUIL.",
};

export default async function SettingsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, avatar: true, isAdmin: true },
    });
    if (!user) redirect("/login");

    // F4 (multi-group): resolve ALL the user's ACTIVE groups + the active one.
    const [groups, activeGroupId] = await Promise.all([
        getUserGroups(userId),
        getActiveGroup(userId),
    ]);

    return (
        <SettingsClient
            user={{
                id: user.id,
                name: user.name,
                email: user.email || "",
                avatar: user.avatar || "👤",
                isAdmin: user.isAdmin,
            }}
            groups={groups.map(g => ({
                id: g.id,
                name: g.name ?? "Mi grupo",
                memberCount: g.memberCount,
                isActive: g.id === activeGroupId,
                type: g.type,
                status: g.status,
            }))}
            activeGroupId={activeGroupId}
            personalParam={isPersonalParam(await searchParams)}
        />
    );
}
