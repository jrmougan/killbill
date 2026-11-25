import { NextResponse } from "next/server";
import { getGroupMembers } from "@/lib/membership";
import { balancesForMembers, sumLedgerByGroup } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";
import { requireSpace, route } from "@/lib/http";
import { idParams } from "@/lib/http/schemas";

/**
 * Expose a space's balances as an API (Fase 1). Balances previously lived only
 * in server components; guests and client UI need them over HTTP.
 *
 * Read-only: allowed for any ACTIVE member (incl. GUEST) and in any status
 * (SETTLING/ARCHIVED are still viewable — "recuerdo del viaje").
 */
export const GET = route(
    { auth: "user-or-guest", params: idParams, unauthorizedMessage: "Unauthorized" },
    async ({ ctx, params: { id } }) => {
        const auth = await requireSpace(ctx, id, { allowGuest: true, allowArchived: true });

        // Roster read once (not again inside getGroupBalances); ledger summed in SQL.
        const [members, nets] = await Promise.all([getGroupMembers(id), sumLedgerByGroup([id])]);
        const balances = balancesForMembers(nets.get(id), members.map((m) => m.id));

        // What the caller owes (positive = I owe them), greedy-matched. Empty if the
        // caller is a creditor / settled.
        const myDebts = resolveMyDebts(balances, auth.userId);

        return NextResponse.json({
            spaceId: id,
            type: auth.space.type,
            status: auth.space.status,
            members: members.map((m) => ({ id: m.id, name: m.name })),
            balances,
            myDebts,
        });
    },
);
