import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getActiveGroup } from "@/lib/membership";
import { formatCurrency } from "@/lib/currency";
import { spaceTypeMeta } from "@/lib/space-ui";
import { ephemeralSpacesEnabled } from "@/lib/flags";
import { getPersonalMonthTotal, getSpaceSummaries, type SpaceSummary } from "@/lib/space-summaries";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APP_TZ, balanceTone, firstName, rowBalance } from "@/lib/home-format";
import { monthRange } from "@/lib/month-range";
import { EqLabel } from "@/components/ui/eq";
import { SpacesList, type SpaceRowData } from "@/components/space/spaces-list";
import { SpaceActionTiles } from "@/components/space/space-action-tiles";
import { SpaceInviteCard } from "@/components/space/space-invite-card";
import { inviteConfigFor } from "@/components/space/invite-eligibility";
import { PERSONAL_KEY } from "@/components/space/space-keys";
import { SpaceStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

function rowSub(s: SpaceSummary): string {
    if (s.status === SpaceStatus.ARCHIVED) return `${spaceTypeMeta(s.type).label} · Archivado`;
    const kind = spaceTypeMeta(s.type).label;
    if (s.others.length === 0) return `${kind} · solo tú por ahora`;
    if (s.others.length === 1) return `${kind} · tú y ${firstName(s.others[0])}`;
    const until = s.expiresAt
        ? ` · hasta el ${new Intl.DateTimeFormat("es-ES", { timeZone: APP_TZ, day: "numeric", month: "short" }).format(s.expiresAt).replace(".", "")}`
        : "";
    return `${kind} · ${s.others.length + 1} personas${until}`;
}

function toRow(s: SpaceSummary): SpaceRowData {
    const solo = s.others.length === 0;
    return {
        key: s.id,
        emoji: spaceTypeMeta(s.type).emoji,
        name: s.name ?? spaceTypeMeta(s.type).label,
        sub: rowSub(s),
        bal: solo ? "" : rowBalance(s.balanceCents),
        tone: balanceTone(s.balanceCents),
        manageHref: `/spaces/${s.id}`,
        archived: s.status === SpaceStatus.ARCHIVED,
    };
}

/**
 * Espacios (prototype `is.espacios`): every space the user belongs to plus the
 * personal context, with the caller's balance in each. Query contract:
 *  - `?active=personal` marks the personal context as the active row (Inicio
 *    passes it when it is showing the personal context);
 *  - `?join=1` opens the "Unirme con enlace" form directly.
 */
export default async function SpacesPage({
    searchParams,
}: {
    searchParams: Promise<{ active?: string; join?: string }>;
}) {
    const session = await getSession();
    if (!session?.userId) redirect("/login");
    // A guest is caged to its space: no spaces hub.
    if (session.kind === "guest") redirect("/dashboard");
    const userId = session.userId as string;
    const params = await searchParams;

    const month = monthRange();
    const [summaries, personalMonthCents, activeGroupId] = await Promise.all([
        getSpaceSummaries(userId, month),
        getPersonalMonthTotal(userId, month),
        getActiveGroup(userId),
    ]);

    const activeKey = params.active === PERSONAL_KEY || !activeGroupId ? PERSONAL_KEY : activeGroupId;
    const live = summaries.filter((s) => s.status !== SpaceStatus.ARCHIVED);
    const archived = summaries.filter((s) => s.status === SpaceStatus.ARCHIVED);

    const rows: SpaceRowData[] = [
        ...live.map(toRow),
        {
            key: PERSONAL_KEY,
            emoji: "👤",
            name: "Personal",
            sub: `Solo tú · ${formatCurrency(personalMonthCents)} este mes`,
            bal: "",
            tone: "neutral",
        },
    ];

    const active = summaries.find((s) => s.id === activeKey) ?? null;
    const invite = active ? inviteConfigFor(active, ephemeralSpacesEnabled()) : null;

    return (
        <div className="min-h-screen pb-10 eq-in">
            {/* Back keeps the context Inicio came from (personal vs shared). */}
            <header className="px-5 pt-3 flex items-center gap-1">
                <Link
                    href={params.active === PERSONAL_KEY ? "/dashboard?scope=personal" : "/dashboard"}
                    aria-label="Volver a Inicio"
                    className="-ml-2.5 h-11 w-11 flex-none flex items-center justify-center"
                >
                    <ArrowLeft className="h-6 w-6" aria-hidden="true" />
                </Link>
                <h1 className="text-2xl font-bold tracking-[-0.02em] flex-1 min-w-0 truncate">Espacios</h1>
            </header>
            <div className="flex flex-col gap-2.5 px-5 pt-5">
                <SpacesList rows={rows} activeKey={activeKey} />

                <div className="mt-2">
                    <SpaceActionTiles defaultJoinOpen={params.join === "1"} />
                </div>

                {active && invite && (
                    <SpaceInviteCard
                        className="mt-2.5"
                        spaceId={active.id}
                        spaceName={active.name ?? spaceTypeMeta(active.type).label}
                        kind={invite.kind}
                        maxUses={invite.maxUses}
                    />
                )}

                {archived.length > 0 && (
                    <section aria-labelledby="archived-title" className="mt-4 flex flex-col gap-2.5">
                        <EqLabel id="archived-title">Archivados</EqLabel>
                        <SpacesList rows={archived.map(toRow)} activeKey={activeKey} />
                    </section>
                )}
            </div>
        </div>
    );
}
