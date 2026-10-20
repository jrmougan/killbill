import { prisma } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { EditSettleClient } from "./client";

export const dynamic = 'force-dynamic';

interface EditSettlePageProps {
    params: Promise<{ id: string }>;
}

export default async function EditSettlePage({ params }: EditSettlePageProps) {
    const { id } = await params;
    const ctx = await getSessionCtx();
    if (!ctx) redirect("/login");

    const settlement = await prisma.settlement.findUnique({
        where: { id },
        include: { toUser: { select: { name: true } } },
    });
    if (!settlement) notFound();

    const auth = await requireSpaceAccess(ctx, settlement.coupleId, { allowArchived: true, allowGuest: true });
    if (!auth.ok) notFound();

    // Only the payer may edit, and only while it is still PENDING (the API
    // enforces the same; here we just avoid showing a form that would 403/409).
    if (settlement.fromUserId !== ctx.userId || settlement.status !== "PENDING" || auth.space.status === "ARCHIVED") {
        redirect(`/settle/${id}`);
    }

    // What I owe the receiver now (this PENDING payment is not in the ledger
    // yet): the cap under the amount, same as the /settle review sheet.
    const debtCents = resolveMyDebts(await getGroupBalances(settlement.coupleId), ctx.userId)[settlement.toUserId] ?? 0;

    return (
        <EditSettleClient
            settlementId={id}
            initialCents={settlement.amount}
            initialMethod={settlement.method}
            toName={settlement.toUser.name}
            maxCents={debtCents > 0 ? debtCents : undefined}
        />
    );
}
