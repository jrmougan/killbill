import { NextResponse } from "next/server";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { assertStatusTransition } from "@/lib/space-policy";
import { SpaceStatus } from "@/generated/prisma/enums";
import { SettlementError } from "@/lib/settlement-rules";
import { withSpaceLock } from "@/lib/settlement-service";
import { conflict, requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";

const ARCHIVED_MESSAGE = "El espacio está archivado (solo lectura)";

/**
 * Close the space for settling (Fase 1): move ACTIVE -> SETTLING and create the
 * PENDING settlements the caller should pay, computed from the canonical
 * ledger balances via finance.resolveMyDebts. The creditor confirms each one
 * via /api/settle/[id]/status; the space stays SETTLING (blocks new expenses,
 * allows settling) until archived/reopened.
 *
 * Suggestions are for the CALLER only (they can only create settlements as the
 * payer). Idempotent: an equal PENDING settlement to the same creditor is not
 * duplicated on re-run. No body is read.
 */
export const POST = route(
    { auth: "user", params: idParams, unauthorizedMessage: "Unauthorized" },
    async ({ ctx, params: { id } }) => {
        // OWNER/ADMIN drive the space-wide lifecycle change. allowArchived:true so a
        // space already in SETTLING can re-run to refresh suggestions.
        const auth = await requireSpace(ctx, id, { roles: ["OWNER", "ADMIN"], allowArchived: true });

        const currentStatus = auth.space.status as SpaceStatus;
        if (currentStatus === SpaceStatus.ARCHIVED) throw conflict(ARCHIVED_MESSAGE, "SPACE_NOT_WRITABLE");

        // Transition to SETTLING only if not already there (SpacePolicyError → its 400 + code).
        const willTransition = currentStatus === SpaceStatus.ACTIVE;
        if (willTransition) assertStatusTransition(currentStatus, SpaceStatus.SETTLING);

        // Under the space lock (same one every settlement mutation takes) so the
        // debts read here cannot race a concurrent confirm/"Ya he pagado".
        const created = await withSpaceLock(id, async (tx, lockedStatus) => {
            if (lockedStatus === SpaceStatus.ARCHIVED) {
                throw new SettlementError(409, "SPACE_NOT_WRITABLE", ARCHIVED_MESSAGE);
            }
            if (willTransition) {
                await tx.couple.update({ where: { id }, data: { status: SpaceStatus.SETTLING } });
            }

            // What the caller owes, from the ledger-sourced balances.
            const balances = await getGroupBalances(id, tx);
            const myDebts = resolveMyDebts(balances, auth.userId); // { creditorId: cents }

            const rows: { toUserId: string; amount: number }[] = [];
            for (const [toUserId, amount] of Object.entries(myDebts)) {
                if (amount <= 0) continue;
                // Skip if an equal PENDING settlement to this creditor already
                // exists (idempotent re-run).
                const existing = await tx.settlement.findFirst({
                    where: { coupleId: id, fromUserId: auth.userId, toUserId, amount, status: "PENDING" },
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
    },
);
