"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, RotateCw, ScanLine, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { EqCta, EqToast, useEqToast } from "@/components/ui/eq";
import { formatCurrency } from "@/lib/currency";
import { safeReturnTo } from "@/lib/safe-return";
import type { CategoryContext } from "@/lib/category-context";
import { useCategoryList } from "@/components/category/use-category-list";
import { PERSONAL_SPACE } from "@/components/expenses/space-meta";
import { Numpad } from "./numpad";
import { ScanScreen } from "./scan-screen";
import { amountToCents, centsToAmount, type AmountKey } from "./amount-input";
import {
    deriveSplit, formReducer, initFormState, mirrorQuickSplit, nextQuickSplit, spaceMembers, todayISO,
    type AddSpace, type BlockedSpace, type ExpenseFormInitial, type FormTag,
} from "./expense-form-state";
import { AmountField, CategoryChips, PayerSplitTiles, SpaceBar } from "./expense-form-sections";
import { ExpenseMoreOptions } from "./expense-more-options";
import { useAmountKeyboard } from "./use-amount-keyboard";
import { useReceiptScan } from "./use-receipt-scan";
import { useSaveExpense } from "./use-save-expense";

export type { AddMember, AddSpace, BlockedSpace, ExpenseFormInitial, FormTag } from "./expense-form-state";

/** True when the previous history entry is this app (so "back" stays in-app). */
function hasInAppHistory(): boolean {
    try {
        return window.history.length > 1 && !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
        return false;
    }
}

/** Create-mode entry point (`/expenses/new`). */
export function AddExpenseClient(props: Omit<ExpenseFormProps, "initial">) {
    return <ExpenseForm {...props} />;
}

type ExpenseFormProps = {
    userId: string;
    spaces: AddSpace[];
    allowPersonal: boolean;
    activeGroupId: string | null;
    initialSpace: string;
    initialTitle?: string;
    initialCategory?: string | null;
    returnTo?: string | null;
    autoScan?: boolean;
    /** Tags of every offered scope (spaces + personal), loaded server-side. */
    tags?: FormTag[];
    /** Spaces that exist but can't take new expenses (shown as a note). */
    blockedSpaces?: BlockedSpace[];
    /** Edit mode: the expense being edited (its space is fixed). */
    initial?: ExpenseFormInitial;
};

/**
 * The EQUIL numpad expense form (`is.add`), shared by "Añadir gasto" and
 * "Editar gasto" (G-11/T-07): amount numpad, concept, category chips,
 * Pagó/Reparto tiles with a live balance preview, OCR, and "Más opciones"
 * (date, custom split, receipt lines, tags, recurrence, notes).
 *
 * All form state lives in one reducer (`expense-form-state.ts`); OCR, the
 * physical keyboard and saving are hooks; the sections are presentational.
 */
export function ExpenseForm({
    userId,
    spaces,
    allowPersonal,
    activeGroupId,
    initialSpace,
    initialTitle = "",
    initialCategory = null,
    returnTo: returnToProp = null,
    autoScan = false,
    tags: initialTags,
    blockedSpaces = [],
    initial,
}: ExpenseFormProps) {
    const router = useRouter();
    const [toast, showToast] = useEqToast(2000);
    const isEdit = !!initial;
    // Re-sanitised client-side too: never navigate to another origin (G-01).
    const returnTo = safeReturnTo(returnToProp);

    const [state, dispatch] = useReducer(
        formReducer,
        { userId, spaces, initialSpace, initialTitle, initialCategory, tags: initialTags, initial },
        (o) => initFormState({ ...o, today: todayISO() }),
    );
    const { spaceId, amount, amountError, category, payerId, splitChoice, moreOpen, date, notes, receiptItems, mode } = state;

    // ---------- Where / who ----------
    const space = spaces.find((s) => s.id === spaceId) ?? null;
    const isPersonal = spaceId === PERSONAL_SPACE || !space;
    const members = useMemo(() => (isPersonal ? [] : space?.members ?? []), [isPersonal, space]);
    const isShared = !isPersonal && members.length > 1;
    const partner = members.length === 2 ? members.find((m) => m.id !== userId) ?? null : null;
    const totalCents = amountToCents(amount);

    // ---------- Categories ----------
    // The effective set (system ∪ space/personal custom) of the chosen
    // destination — never hardcoded.
    const categoryContext: CategoryContext = useMemo(
        () => (isPersonal || !space ? { kind: "personal" } : { kind: "shared", groupId: space.id }),
        [isPersonal, space],
    );
    const { categories: effectiveCategories, loading: categoriesLoading } = useCategoryList(categoryContext);
    // Edit: keep the expense's own category selectable even if it is no longer
    // in the effective set (it is only sent back when changed).
    const categories = useMemo(() => {
        const meta = initial?.categoryMeta;
        if (!meta || effectiveCategories.length === 0 || effectiveCategories.some((c) => c.key === meta.key)) return effectiveCategories;
        return [...effectiveCategories, { key: meta.key, label: meta.label, emoji: meta.emoji }];
    }, [effectiveCategories, initial?.categoryMeta]);
    const categoryKeys = useMemo(() => categories.map((c) => c.key), [categories]);
    useEffect(() => {
        dispatch({ type: "categoriesChanged", keys: categoryKeys });
    }, [categoryKeys]);
    const categoryMeta = categories.find((c) => c.key === category) ?? null;

    // ---------- Tags ----------
    // An expense can only carry tags of its own scope.
    useEffect(() => {
        if (initialTags) return;
        fetch("/api/tags")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.tags) dispatch({ type: "tagsLoaded", tags: d.tags }); })
            .catch((e) => console.error("Failed to fetch tags", e));
    }, [initialTags]);
    const visibleTags = state.tags.filter((t) => (isPersonal ? !t.coupleId : t.coupleId === spaceId));
    // /api/tags creates group tags in the ACTIVE space only.
    const canCreateTag = isPersonal || spaceId === activeGroupId;

    const createTag = async () => {
        const name = state.newTag.name.trim();
        if (!name) return;
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, color: state.newTag.color, ...(isPersonal ? { personal: true } : {}) }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.tag) {
                dispatch({ type: "formError", error: data?.error || "No se pudo crear la etiqueta." });
                return;
            }
            dispatch({ type: "tagCreated", tag: data.tag });
        } catch (err) {
            console.error("Failed to create tag", err);
            dispatch({ type: "formError", error: "No se pudo crear la etiqueta." });
        }
    };

    const changeSpace = (id: string) => {
        if (isEdit || id === spaceId) return;
        dispatch({ type: "spaceChanged", spaceId: id, userId, members: spaceMembers(spaces, id) });
    };

    // ---------- Amount entry (numpad + physical keyboard + paste) ----------
    const pressKey = useCallback((k: AmountKey) => dispatch({ type: "amountKey", key: k }), []);
    useAmountKeyboard(mode === "form" && !moreOpen, pressKey);

    // ---------- Split ----------
    const split = deriveSplit({ state, members, userId, isShared, partnerId: partner?.id ?? null, totalCents });
    const { itemized, linesCents, linesMismatch } = split;

    // A stale error disappears as soon as the user changes what caused it (G-13).
    useEffect(() => {
        dispatch({ type: "formError", error: null });
    }, [state.splitValue, splitChoice, totalCents, payerId, receiptItems, category, date, spaceId]);

    const cycleSplit = () => {
        if (itemized) { dispatch({ type: "moreOpened" }); return; }
        dispatch({ type: "splitChoiceChanged", choice: nextQuickSplit(split.splitOptions.map((o) => o.value), splitChoice) });
    };

    // Mirror the quick choice into the editor so "custom" starts from what the user sees.
    const openMore = () => dispatch({
        type: "moreOpened",
        splitValue: isShared ? mirrorQuickSplit(splitChoice, members, userId, totalCents, split.shares) : null,
    });

    // ---------- Receipt / OCR ----------
    const { fileInputRef, runOcr, onFile, discardReceipt, cancelScan, openScanner } = useReceiptScan({
        dispatch, receiptPreview: state.receiptPreview, categoryKeys, autoScan,
    });

    // ---------- Close ----------
    const fallbackHref = isEdit
        ? `/expense/${initial!.expenseId}`
        : initialSpace === PERSONAL_SPACE ? "/dashboard?scope=personal" : "/dashboard";
    const close = () => {
        if (returnTo) router.push(returnTo);
        else if (hasInAppHistory()) router.back();
        else router.push(fallbackHref);
    };

    // ---------- Save ----------
    const save = useSaveExpense({
        state, dispatch, initial, userId, space, isPersonal, isShared, members, totalCents, split,
        categoryLabel: categoryMeta?.label ?? null, returnTo, showToast,
    });

    const today = todayISO();
    const hasAdvanced = state.selectedTagIds.length > 0 || state.isRecurring || notes.trim() !== "" || receiptItems.length > 0
        || date !== (initial?.date ?? today) || splitChoice === "custom" || !!state.receiptFile || !!state.storedReceiptUrl;
    const dateLabel = date === today
        ? "Hoy"
        : new Date(`${date}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const { formError, ocrError, receiptFile } = state;
    const shownError = formError ?? amountError ?? ocrError;

    return (
        <div className="flex flex-col min-h-[100dvh] w-full">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onFile}
                data-testid="receipt-input"
            />

            <SpaceBar
                isEdit={isEdit}
                spaces={spaces}
                spaceId={spaceId}
                isPersonal={isPersonal}
                allowPersonal={allowPersonal}
                blockedSpaces={blockedSpaces}
                onClose={close}
                onChange={changeSpace}
            />

            {mode === "scan" ? (
                <ScanScreen preview={state.receiptPreview} onCancel={cancelScan} />
            ) : (
                <>
                    <div className="flex flex-col items-center gap-3 px-5 pt-[22px] pb-2.5 [@media(max-height:640px)]:gap-2 [@media(max-height:640px)]:pt-2">
                        {state.scanned && (
                            <span className="eq-in flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-[5px] text-xs font-semibold text-primary">
                                <Sparkles className="h-[13px] w-[13px]" /> Ticket leído · revisa y guarda
                            </span>
                        )}
                        <AmountField amount={amount} invalid={!!amountError} onType={(raw) => dispatch({ type: "amountTyped", raw })} />
                        <input
                            data-testid="expense-description"
                            aria-label="Concepto"
                            value={state.description}
                            onChange={(e) => dispatch({ type: "descriptionChanged", value: e.target.value })}
                            placeholder="Concepto (opcional)"
                            maxLength={120}
                            className="h-[46px] w-full rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-[color:var(--accent-border)]"
                        />
                        <CategoryChips
                            categories={categories}
                            loading={categoriesLoading}
                            selected={category}
                            onPick={(key) => dispatch({ type: "categoryPicked", key })}
                        />
                        {isShared && (
                            <PayerSplitTiles
                                members={members}
                                userId={userId}
                                payerId={payerId}
                                splitLabel={split.splitLabel}
                                onPayer={(id) => dispatch({ type: "payerChanged", payerId: id })}
                                onCycleSplit={cycleSplit}
                            />
                        )}
                        <span aria-live="polite" data-testid="expense-preview" className="min-h-4 text-[12.5px] text-muted-foreground">{split.preview}</span>
                        {linesMismatch && (
                            <div data-testid="lines-mismatch" className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] bg-[var(--track)] px-3 py-2 text-[12.5px] text-muted-foreground">
                                <span className="flex-1">
                                    El desglose suma {formatCurrency(linesCents)}{itemized ? " y reparte por productos" : ""}.
                                </span>
                                <button type="button" onClick={() => dispatch({ type: "amountSet", amount: centsToAmount(linesCents) })} className="font-semibold text-primary">
                                    Usar {formatCurrency(linesCents)}
                                </button>
                            </div>
                        )}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={openMore}
                                data-testid="expense-more"
                                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                            >
                                <SlidersHorizontal className="h-3.5 w-3.5" /> Más opciones
                                {hasAdvanced && <span className="h-1.5 w-1.5 rounded-full bg-primary"><span className="sr-only">(con cambios)</span></span>}
                            </button>
                            {date !== today && (
                                <span data-testid="expense-date-label" className="text-[12.5px] text-muted-foreground">· {dateLabel}</span>
                            )}
                        </div>
                        {shownError && (
                            <div role="alert" className="flex w-full items-center gap-2 rounded-[14px] bg-[var(--negative-tint)] px-3 py-2.5 text-[13px] text-destructive">
                                <AlertCircle className="h-4 w-4 flex-none" />
                                <span className="flex-1">{shownError}</span>
                                {!formError && !amountError && receiptFile && (
                                    <button type="button" onClick={() => runOcr(receiptFile)} className="inline-flex items-center gap-1 font-semibold">
                                        <RotateCw className="h-3.5 w-3.5" /> Reintentar
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="mt-auto">
                        <Numpad onKey={pressKey} />
                    </div>

                    <div className="flex gap-2.5 px-5 pt-3 pb-[30px] [@media(max-height:640px)]:pt-2 [@media(max-height:640px)]:pb-4">
                        <button
                            type="button"
                            onClick={openScanner}
                            aria-label="Escanear recibo"
                            className={cn(
                                "h-14 w-14 flex-none rounded-[18px] border bg-card flex items-center justify-center transition-colors",
                                state.scanHint ? "border-primary text-primary ring-4 ring-[var(--accent-tint)]" : "border-[color:var(--line)]",
                            )}
                        >
                            <ScanLine className="h-6 w-6" />
                        </button>
                        <EqCta
                            data-testid="expense-submit"
                            className="flex-1"
                            disabled={totalCents <= 0 || state.saving || !category}
                            onClick={save}
                        >
                            {state.saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
                        </EqCta>
                    </div>
                </>
            )}

            {moreOpen && (
                <ExpenseMoreOptions
                    state={state}
                    dispatch={dispatch}
                    today={today}
                    maxDate={initial && initial.date > today ? initial.date : today}
                    userId={userId}
                    members={members}
                    partner={partner}
                    isShared={isShared}
                    isCouple={space?.type === "COUPLE"}
                    itemized={itemized}
                    isPersonal={isPersonal}
                    totalCents={totalCents}
                    visibleTags={visibleTags}
                    canCreateTag={canCreateTag}
                    onCreateTag={createTag}
                    onDiscardReceipt={discardReceipt}
                />
            )}

            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}
