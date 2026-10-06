/**
 * Per-tab memory of the invite link minted for a space, so "Enviar" keeps
 * sharing the SAME link after a reload instead of minting a new one each time
 * (IE-16). The plaintext token is only ever known right after creation (the DB
 * keeps its hash), so it lives in `sessionStorage` — scoped to this tab of the
 * owner's browser and dropped when the tab closes. Before reusing it the caller
 * re-checks the server list (`GET /api/spaces/[id]/invites`) and forgets it if it
 * was revoked, used up or expired.
 */

export type RememberedInvite = {
    inviteId: string;
    url: string;
    kind: "MEMBER" | "GUEST";
    expiresAt: string;
};

export type InviteRow = {
    id: string;
    tokenPrefix: string;
    kind: string;
    maxUses: number;
    usedCount: number;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
};

const key = (spaceId: string, kind: string) => `eq-invite:${spaceId}:${kind}`;

function storage(): Storage | null {
    try {
        return typeof window === "undefined" ? null : window.sessionStorage;
    } catch {
        return null;
    }
}

export function rememberInvite(spaceId: string, inv: RememberedInvite): void {
    try {
        storage()?.setItem(key(spaceId, inv.kind), JSON.stringify(inv));
    } catch {
        /* storage full/blocked: we just won't reuse it */
    }
}

export function recallInvite(spaceId: string, kind: string): RememberedInvite | null {
    try {
        const raw = storage()?.getItem(key(spaceId, kind));
        if (!raw) return null;
        const inv = JSON.parse(raw) as RememberedInvite;
        if (!inv?.inviteId || !inv.url || new Date(inv.expiresAt).getTime() <= Date.now()) return null;
        return inv;
    } catch {
        return null;
    }
}

export function forgetInvite(spaceId: string, kind: string): void {
    try {
        storage()?.removeItem(key(spaceId, kind));
    } catch {
        /* ignore */
    }
}

/** Still usable: not revoked, not expired, uses left. */
export function isInviteLive(inv: Pick<InviteRow, "revokedAt" | "expiresAt" | "usedCount" | "maxUses">, now = Date.now()): boolean {
    return !inv.revokedAt && new Date(inv.expiresAt).getTime() > now && inv.usedCount < inv.maxUses;
}

/** Fetch the space's invite list (OWNER/ADMIN). Null on any failure. */
export async function fetchInvites(spaceId: string): Promise<InviteRow[] | null> {
    try {
        const res = await fetch(`/api/spaces/${spaceId}/invites`);
        const data = await res.json().catch(() => null);
        return res.ok && Array.isArray(data?.invites) ? (data.invites as InviteRow[]) : null;
    } catch {
        return null;
    }
}
