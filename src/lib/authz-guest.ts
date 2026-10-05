/**
 * Guest confinement rules for the proxy (pure, edge-safe, DB-free).
 *
 * A GUEST session (JWT `kind:'guest'`) is caged to ONE ephemeral space. The
 * per-request authorization of each resource still lives in the route handlers
 * (`requireSpaceAccess`, which also revalidates the guest membership against the
 * DB); this module is the coarse, DENY-BY-DEFAULT outer fence applied by
 * `src/proxy.ts` before any handler runs:
 *
 * - Pages: only the guest surface (Inicio, gastos, saldar, crear cuenta) plus the
 *   public pages. Everything else redirects to /dashboard.
 * - API: only the endpoints the guest pages actually call, method-aware. Every
 *   other `/api/**` answers 403 — so a new route stays closed to guests until it
 *   is added here on purpose.
 */

export type GuestDecision = "allow" | "redirect" | "forbid";

/** True when `pathname` is `prefix` itself or a sub-path of it (segment-aware). */
export function underPath(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Pages a guest may open (segment-aware prefixes). */
const GUEST_PAGE_PREFIXES = ["/dashboard", "/expenses", "/expense", "/settle", "/guest"];
/** Guest pages carved out of the prefixes above (personal-only surfaces). */
const GUEST_PAGE_DENY = ["/expenses/import"];
/** Public pages reachable with any session (or none). */
const PUBLIC_PAGE_PREFIXES = ["/login", "/register", "/i", "/uploads"];

/**
 * API allowlist for guests: [pattern, allowed methods]. Patterns are matched
 * against the whole pathname; `[^/]+` stands for one dynamic segment. Derived
 * from the fetches made by the guest pages (dashboard, add/edit expense, expense
 * detail, settle flows, guest upgrade, invite consent) — keep it minimal.
 */
const GUEST_API_RULES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    // Session
    [/^\/api\/auth\/logout$/, ["POST"]],
    // Invite consent / recovery link / upgrade to a full account
    [/^\/api\/invites\/claim$/, ["POST"]],
    [/^\/api\/invites\/[^/]+\/preview$/, ["GET"]],
    [/^\/api\/guest\/upgrade$/, ["POST"]],
    // Expenses of the guest's space (handlers authorize against the expense's group)
    [/^\/api\/expenses$/, ["GET", "POST"]],
    [/^\/api\/expenses\/[^/]+$/, ["PATCH", "DELETE"]],
    [/^\/api\/expenses\/[^/]+\/receipt-lines$/, ["GET"]],
    [/^\/api\/expenses\/[^/]+\/tags$/, ["POST", "DELETE"]],
    // Receipt capture used by "Añadir gasto"
    [/^\/api\/upload$/, ["POST"]],
    [/^\/api\/ocr$/, ["POST"]],
    // Read the space's tags (creating/deleting tags is a member action)
    [/^\/api\/tags$/, ["GET"]],
    // Settle flows ("Ya he pagado", edit/confirm a pending payment)
    [/^\/api\/settle$/, ["POST"]],
    [/^\/api\/settle\/[^/]+$/, ["PATCH"]],
    [/^\/api\/settle\/[^/]+\/status$/, ["PATCH"]],
    // Read-only space data (handlers cage the guest to its own groupId)
    [/^\/api\/spaces\/[^/]+\/balance$/, ["GET"]],
    [/^\/api\/spaces\/[^/]+\/categories$/, ["GET"]],
    // Test-only routes are self-gated by TEST_ROUTES_ENABLED.
    [/^\/api\/test\/[^/]+$/, ["POST"]],
];

/** Whether a guest may call `method pathname` on the API. */
export function isGuestApiAllowed(pathname: string, method: string): boolean {
    const m = method.toUpperCase();
    return GUEST_API_RULES.some(([re, methods]) => re.test(pathname) && methods.includes(m));
}

/** Whether a guest may open the page at `pathname`. */
export function isGuestPageAllowed(pathname: string): boolean {
    if (pathname === "/") return true;
    if (PUBLIC_PAGE_PREFIXES.some((p) => underPath(pathname, p))) return true;
    if (GUEST_PAGE_DENY.some((p) => underPath(pathname, p))) return false;
    return GUEST_PAGE_PREFIXES.some((p) => underPath(pathname, p));
}

/**
 * Decision for a request made with a GUEST session:
 * - "allow": let it through (the handler/page still authorizes the resource);
 * - "forbid": API call outside the allowlist → 403 JSON;
 * - "redirect": page outside the guest surface → /dashboard.
 */
export function guestRouteDecision(pathname: string, method: string): GuestDecision {
    if (underPath(pathname, "/api")) {
        return isGuestApiAllowed(pathname, method) ? "allow" : "forbid";
    }
    return isGuestPageAllowed(pathname) ? "allow" : "redirect";
}
