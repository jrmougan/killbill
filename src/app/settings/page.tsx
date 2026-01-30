import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SettingsClient } from "./settings-client";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "Ajustes | Billo",
    description: "Configura tu perfil y tu pareja en Billo.",
};

export default async function SettingsPage() {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            couple: {
                include: {
                    members: true
                }
            }
        }
    });

    if (!user) redirect("/login");

    return (
        <SettingsClient
            user={{
                id: user.id,
                name: user.name,
                email: user.email || "",
                avatar: user.avatar || "👤"
            }}
            couple={user.couple ? {
                id: user.couple.id,
                name: user.couple.name || "Nuestra Pareja",
                code: user.couple.code,
                members: user.couple.members.map(m => ({
                    id: m.id,
                    name: m.name,
                    avatar: m.avatar || "👤"
                }))
            } : null}
        />
    );
}
