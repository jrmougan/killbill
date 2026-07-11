import { NextResponse } from "next/server";
import { getSessionCtx, requireSpaceAccess } from "@/lib/authz";
import { getGroupMembers } from "@/lib/membership";
import { getGroupBalances } from "@/lib/ledger-read";
import { resolveMyDebts } from "@/lib/finance";

/**
 * Expose a space's balances as an API (Fase 1). Balances previously lived only
 * in server components; guests and client UI need them over HTTP.
 *
 * Read-only: allowed for any ACTIVE member (incl. GUEST) and in any status
 * (SETTLING/ARCHIVED are still viewable — "recuerdo del viaje").
 */
export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const ctx = await getSessionCtx();

    const auth = await requireSpaceAccess(ctx, id, {
        allowGuest: true,
        allowArchived: true,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    const [members, balances] = await Promise.all([
        getGroupMembers(id),
        getGroupBalances(id),
    ]);

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
}
