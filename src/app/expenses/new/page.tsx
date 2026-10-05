/**
 * Añadir gasto (EQUIL `is.add`) — full-screen numpad flow.
 *
 * ## Prefill query contract (used by Listas, dashboard, /personal…)
 *
 * | param      | value                                   | effect                                                        |
 * |------------|-----------------------------------------|---------------------------------------------------------------|
 * | `title`    | free text (≤ 120 chars)                 | Prefills "Concepto".                                          |
 * | `category` | category key (e.g. `shopping`)          | Preselects that chip if it exists in the chosen space's effective set; otherwise ignored. |
 * | `space`    | group id, or `personal`                 | Preselects WHERE the expense goes. Unknown / non-writable ids fall back to the active space. |
 * | `returnTo` | relative path starting with `/`         | Where the close X and a successful save go (default `/dashboard`). Absolute / `//` URLs are ignored. |
 * | `scan=1`   | flag                                    | Opens the receipt scanner on arrival (best effort: if the browser blocks the picker, the scan button is highlighted). |
 * | `type=personal` | legacy alias                       | Same as `space=personal`.                                     |
 *
 * After saving, the app navigates to `returnTo` (or `/dashboard`, or
 * `/dashboard?scope=personal` for a personal expense) with `saved=<cents>`
 * appended so the destination may show "Gasto guardado · 43,85 €".
 *
 * Example: `/expenses/new?title=Mercadona&category=shopping&space=personal&returnTo=/lists/abc&scan=1`
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getActiveGroup, getGroupMembers, getUserGroups } from "@/lib/membership";
import { AddExpenseClient, type AddSpace } from "@/components/expense/add/add-expense-client";
import { PERSONAL_SPACE } from "@/components/expenses/space-meta";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Only same-origin relative paths are honoured (no open redirect). */
function safeReturnTo(raw: string | undefined): string | null {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
    return raw;
}

export default async function NewExpensePage({ searchParams }: { searchParams: SearchParams }) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    const userId = session.userId as string;
    const isGuest = session.kind === "guest";
    const sp = await searchParams;

    // Every space the caller can write into (ACTIVE status — SETTLING/ARCHIVED
    // block new expenses) with its ordered members (order matters for the
    // remainder cent, see getGroupMembers).
    const [groups, activeGroupId] = await Promise.all([getUserGroups(userId), getActiveGroup(userId)]);
    const writable = groups.filter((g) => g.status === "ACTIVE");
    const spaces: AddSpace[] = await Promise.all(
        writable.map(async (g) => ({
            id: g.id,
            name: g.name || "Espacio",
            type: g.type,
            members: (await getGroupMembers(g.id)).map((m) => ({ id: m.id, name: m.name, avatar: m.avatar })),
        })),
    );

    const requested = one(sp.space) ?? (one(sp.type) === "personal" ? PERSONAL_SPACE : undefined);
    const allowPersonal = !isGuest;
    let initialSpace: string;
    if (requested === PERSONAL_SPACE && allowPersonal) initialSpace = PERSONAL_SPACE;
    else if (requested && spaces.some((s) => s.id === requested)) initialSpace = requested;
    else if (activeGroupId && spaces.some((s) => s.id === activeGroupId)) initialSpace = activeGroupId;
    else initialSpace = spaces[0]?.id ?? PERSONAL_SPACE;

    return (
        <AddExpenseClient
            userId={userId}
            spaces={spaces}
            allowPersonal={allowPersonal}
            activeGroupId={activeGroupId}
            initialSpace={initialSpace}
            initialTitle={(one(sp.title) ?? "").slice(0, 120)}
            initialCategory={one(sp.category) ?? null}
            returnTo={safeReturnTo(one(sp.returnTo))}
            autoScan={one(sp.scan) === "1"}
        />
    );
}
