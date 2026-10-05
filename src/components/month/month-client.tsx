"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { EqHeader, EqSegmented } from "@/components/ui/eq";
import type { MonthScope, MonthView } from "./format";
import type { BudgetEntry, MonthAnalysis, MonthCategory } from "./types";
import { BudgetView } from "./budget-view";
import { AnalysisView } from "./analysis-view";

export interface MonthClientProps {
    initialView: MonthView;
    scope: MonthScope;
    /** Active lens shown in the header meta ("💑 Casa" / "👤 Personal"). */
    space: { emoji: string; name: string };
    /** The other lens the meta toggles to (null when the user has no group). */
    alt: { name: string; scope: MonthScope } | null;
    monthName: string;
    prevMonthShort: string;
    daysLeft: number;
    categories: MonthCategory[];
    budgets: BudgetEntry[];
    analysis: MonthAnalysis;
}

const VIEWS: { value: MonthView; label: string }[] = [
    { value: "budget", label: "Presupuestos" },
    { value: "analysis", label: "Análisis" },
];

function monthHref(view: MonthView, scope: MonthScope): string {
    const qs = new URLSearchParams();
    if (view !== "budget") qs.set("view", view);
    if (scope === "personal") qs.set("scope", "personal");
    const s = qs.toString();
    return s ? `/month?${s}` : "/month";
}

export function MonthClient(props: MonthClientProps) {
    const { scope, space, alt } = props;
    const [view, setView] = useState<MonthView>(props.initialView);

    // Both views are server-rendered together, so switching is instant: only the
    // URL is synced (shareable ?view=…) without another server round-trip.
    const changeView = (v: MonthView) => {
        setView(v);
        window.history.replaceState(window.history.state, "", monthHref(v, scope));
    };

    const meta = alt ? (
        <Link
            href={monthHref(view, alt.scope)}
            aria-label={`Cambiar a ${alt.name}`}
            className="inline-flex items-center gap-1 rounded-full px-1 -mx-1 hover:text-foreground"
        >
            {space.emoji} {space.name}
            <ArrowLeftRight className="h-3 w-3" aria-hidden />
        </Link>
    ) : (
        `${space.emoji} ${space.name}`
    );

    return (
        <div className="flex flex-col flex-1 pb-28 eq-in">
            <div className="flex flex-col gap-3.5 pt-[max(env(safe-area-inset-top),12px)]">
                <EqHeader title={props.monthName} meta={meta} />
                <div className="px-5">
                    <EqSegmented value={view} options={VIEWS} onChange={changeView} />
                </div>
            </div>
            {/* Both panels stay mounted (hidden toggles) so budget edits survive a
                round-trip through Análisis. Keyed by scope: a lens switch remounts
                with the freshly server-rendered data. */}
            <div
                role="tabpanel"
                aria-label="Presupuestos"
                hidden={view !== "budget"}
                className="flex-col gap-[18px] px-5 pt-[18px] [&:not([hidden])]:flex"
            >
                <BudgetView
                    key={scope}
                    scope={scope}
                    daysLeft={props.daysLeft}
                    categories={props.categories}
                    initialBudgets={props.budgets}
                />
            </div>
            <div
                role="tabpanel"
                aria-label="Análisis"
                hidden={view !== "analysis"}
                className="flex-col gap-[18px] px-5 pt-[18px] [&:not([hidden])]:flex"
            >
                <AnalysisView
                    analysis={props.analysis}
                    categories={props.categories}
                    prevMonthShort={props.prevMonthShort}
                />
            </div>
        </div>
    );
}
