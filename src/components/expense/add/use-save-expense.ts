"use client";

import { useRef, type Dispatch } from "react";
import { useRouter } from "next/navigation";
import { setActiveGroup } from "@/app/actions/group";
import { formatCurrency } from "@/lib/currency";
import type { SplitMember } from "@/components/expense/split-editor";
import { splitPayload } from "./form-payload";
import {
    buildExpenseBody, preSaveCheck, receiptLines, tagDiff, todayISO, withParam,
    type AddSpace, type ExpenseFormInitial, type FormAction, type FormState, type SplitView,
} from "./expense-form-state";

/** Apply the tag diff; returns how many tag calls failed. */
async function syncTags(expenseId: string, before: string[], selected: string[]): Promise<number> {
    const { toAdd, toRemove } = tagDiff(before, selected);
    const results = await Promise.allSettled([
        ...toAdd.map((tagId) => fetch(`/api/expenses/${expenseId}/tags`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tagId }),
        })),
        ...toRemove.map((tagId) => fetch(`/api/expenses/${expenseId}/tags`, {
            method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tagId }),
        })),
    ]);
    return results.filter((r) => r.status === "rejected" || !r.value.ok).length;
}

/**
 * "Guardar": validate, upload the receipt photo, create/patch the expense, sync
 * its tags and navigate back. Guarded against double submits synchronously
 * (G-19); on failure the inline error shows and the button re-enables.
 */
export function useSaveExpense(o: {
    state: FormState;
    dispatch: Dispatch<FormAction>;
    initial?: ExpenseFormInitial;
    userId: string;
    space: AddSpace | null;
    isPersonal: boolean;
    isShared: boolean;
    members: SplitMember[];
    totalCents: number;
    split: SplitView;
    categoryLabel: string | null;
    returnTo: string | null;
    showToast: (m: string) => void;
}) {
    const router = useRouter();
    const savingRef = useRef(false); // synchronous double-submit guard (G-19)

    return async function save() {
        const { state, dispatch, initial, userId, space, isPersonal, isShared, members, totalCents, split, showToast } = o;
        const isEdit = !!initial;
        if (savingRef.current) return;
        dispatch({ type: "formError", error: null });
        const issue = preSaveCheck({
            totalCents, split, isShared, splitChoice: state.splitChoice, date: state.date, category: state.category,
        });
        if (issue) {
            if (issue.kind === "toast") showToast(issue.message);
            else dispatch({ type: "formError", error: issue.message, openMore: issue.openMore });
            return;
        }
        const title = state.description.trim() || o.categoryLabel || "Gasto";
        const category = state.category!;

        savingRef.current = true;
        dispatch({ type: "saveStarted" });
        try {
            let receiptUrl: string | null = state.storedReceiptUrl;
            if (state.receiptFile) {
                const fd = new FormData();
                fd.append("file", state.receiptFile);
                const up = await fetch("/api/upload", { method: "POST", body: fd });
                const upData = up.ok ? await up.json() : null;
                if (!upData?.success) throw new Error("No se pudo subir el ticket. Inténtalo de nuevo.");
                receiptUrl = upData.url;
            }

            const body = buildExpenseBody({
                initial,
                totalCents,
                title,
                category,
                receiptUrl,
                isRecurring: state.isRecurring,
                recurringInterval: state.recurringInterval,
                date: state.date,
                today: todayISO(),
                notes: state.notes,
                lines: receiptLines(state.receiptItems),
                isPersonal,
                groupId: space?.id ?? null,
                payerId: state.payerId,
                split: splitPayload({
                    mode: isEdit ? "edit" : "create",
                    isShared,
                    itemized: split.itemized,
                    choice: state.splitChoice,
                    custom: split.customResult,
                    members,
                    meId: userId,
                    totalCents,
                }),
            });

            const res = await fetch(initial ? `/api/expenses/${initial.expenseId}` : "/api/expenses", {
                method: initial ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || "No se pudo guardar el gasto. Inténtalo de nuevo.");
            }
            const data = await res.json();
            const expenseId: string | undefined = initial ? initial.expenseId : data.expenseId;
            const failedTags = expenseId ? await syncTags(expenseId, initial?.tagIds ?? [], state.selectedTagIds) : 0;

            if (initial) {
                if (failedTags > 0) showToast("Gasto guardado, pero no se pudieron actualizar las etiquetas");
                router.push(`/expense/${initial.expenseId}`);
                router.refresh();
                return;
            }

            // Saving makes that space the active one (prototype) — only after the
            // expense is safely stored, and best effort. Always re-set it: the
            // `activeGroupId` prop may be stale (another tab switched it — G-02).
            if (!isPersonal && space) {
                await setActiveGroup(space.id).catch(() => null);
            }
            showToast(failedTags > 0
                ? "Gasto guardado, pero no se pudieron añadir las etiquetas"
                : `Gasto guardado · ${formatCurrency(totalCents)}`);
            const dest = o.returnTo ?? (isPersonal ? "/dashboard?scope=personal" : "/dashboard");
            router.push(withParam(dest, "saved", String(totalCents)));
            router.refresh();
        } catch (err) {
            console.error(err);
            savingRef.current = false;
            dispatch({ type: "saveFailed", error: err instanceof Error && err.message ? err.message : "Error de conexión. Inténtalo de nuevo." });
        }
    };
}
