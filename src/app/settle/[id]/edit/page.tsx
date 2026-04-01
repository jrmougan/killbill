import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getMyDebts } from "@/lib/finance";
import { toEuros } from "@/lib/currency";
import { EditSettleClient } from "./client";

export const dynamic = 'force-dynamic';

interface EditSettlePageProps {
    params: { id: string };
}

export default async function EditSettlePage({ params }: EditSettlePageProps) {
    const { id } = await params;
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: {
            fromUser: true,
            toUser: true,
            expenses: {
                include: { splits: true }
            }
        }
    });

    if (!settlement) notFound();
    if (settlement.fromUserId !== userId) redirect(`/settle/${id}`);

    // No expense fetching needed for Running Balance mode.

    return (
        <EditSettleClient
            settlementId={id}
            initialAmount={toEuros(settlement.amount)}
            initialMethod={settlement.method as any}
            toUser={{
                id: settlement.toUserId,
                name: settlement.toUser.name,
                avatar: settlement.toUser.avatar || "👤"
            }}
        />
    );
}
