import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { assertStatusTransition, SpacePolicyError } from "@/lib/space-policy";
import { SpaceStatus } from "@/generated/prisma/enums";

/**
 * Close the space for settling (Fase 1): move ACTIVE -> SETTLING and create the
 * PENDING settlements the caller should pay, computed from the canonical
 * ledger balances via finance.resolveMyDebts. The creditor confirms each one
 * via /api/settle/[id]/status; the space stays SETTLING (blocks new expenses,
 * allows settling) until archived/reopened.
 *
 * Suggestions are for the CALLER only (they can only create settlements as the
 * payer). Idempotent: an equal PENDING settlement to the same creditor is not
 * duplicated on re-run.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    // OWNER/ADMIN drive the space-wide lifecycle change. allowArchived:true so a
    // space already in SETTLING can re-run to refresh suggestions.
    const auth = await requireSpaceAccess(ctx, id, {
        roles: ["OWNER", "ADMIN"],
        allowArchived: true,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const currentStatus = auth.space.status as SpaceStatus;
    if (currentStatus === SpaceStatus.ARCHIVED) {
        return NextResponse.json(
            { error: "El espacio está archivado (solo lectura)", code: "SPACE_NOT_WRITABLE" },
            { status: 409 },
        );
    }

    // Transition to SETTLING only if not already there.
    const willTransition = currentStatus === SpaceStatus.ACTIVE;
    if (willTransition) {
        try {
            assertStatusTransition(currentStatus, SpaceStatus.SETTLING);
        } catch (e) {
            if (e instanceof SpacePolicyError) {
                return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
            }
            throw e;
        }
    }

    // Compute what the caller owes from the ledger-sourced balances.
    const balances = await getGroupBalances(id);
    const myDebts = resolveMyDebts(balances, auth.userId); // { creditorId: cents }

    const created = await prisma.$transaction(async (tx) => {
        if (willTransition) {
            await tx.couple.update({ where: { id }, data: { status: SpaceStatus.SETTLING } });
        }

        const rows: { toUserId: string; amount: number }[] = [];
        for (const [toUserId, amount] of Object.entries(myDebts)) {
            if (amount <= 0) continue;
            // Skip if an equal PENDING settlement to this creditor already exists
            // (idempotent re-run).
            const existing = await tx.settlement.findFirst({
                where: {
                    coupleId: id,
                    fromUserId: auth.userId,
                    toUserId,
                    amount,
                    status: "PENDING",
                },
                select: { id: true },
            });
            if (existing) continue;
            await tx.settlement.create({
                data: {
                    coupleId: id,
                    fromUserId: auth.userId,
                    toUserId,
                    amount,
                    method: "CASH",
                    status: "PENDING",
                },
            });
            rows.push({ toUserId, amount });
        }
        return rows;
    });

    return NextResponse.json({
        success: true,
        status: SpaceStatus.SETTLING,
        suggested: created,
    });
}
