/**
 * State of the numpad expense form ("Añadir gasto" / "Editar gasto") as a
 * single reducer, plus the pure derivations the screen renders from it (split
 * preview, save payload, pre-save validation). No React, no I/O: every side
 * effect (fetch, blob URLs, navigation) stays in the hooks/components.
 */
import { formatCurrency } from "@/lib/currency";
import { checkExpenseDay } from "@/lib/expense-input";
import type { ReceiptItem } from "@/types";
import { computeSplit, seedSplitValue, type SplitMember, type SplitResult, type SplitValue } from "@/components/expense/split-editor";
import { PERSONAL_SPACE } from "@/components/expenses/space-meta";
import { withUid, type EditableReceiptItem } from "./receipt-items-editor";
import { applyAmountKey, amountToCents, centsToAmount, normalizeAmountText, type AmountKey } from "./amount-input";
import {
    balanceDelta, initialSplitState, previewLine, quickShares, quickSplitOptions, type QuickSplit,
} from "./quick-split";
import { receiptLinesCents, type SplitPayload } from "./form-payload";

export type AddMember = { id: string; name: string; avatar: string | null };
export type AddSpace = { id: string; name: string; type: string; members: AddMember[] };
export type FormTag = { id: string; name: string; color: string; coupleId?: string | null; ownerId?: string | null };
/** A space the caller belongs to but that does not accept new expenses (G-09). */
export type BlockedSpace = { id: string; name: string; status: "SETTLING" | "ARCHIVED" };

export type RecurringInterval = "weekly" | "monthly" | "yearly";
export type SplitChoice = QuickSplit | "custom";
export type SplitStrategyKey = "EQUAL" | "CUSTOM" | "EXCLUSIVE" | "ITEMIZED";

/** Persisted state of the expense being edited (edit mode). */
export type ExpenseFormInitial = {
    expenseId: string;
    amountCents: number;
    description: string;
    category: string;
    /** YYYY-MM-DD (Europe/Madrid calendar day). */
    date: string;
    notes: string;
    tagIds: string[];
    isRecurring: boolean;
    recurringInterval: RecurringInterval;
    paidById: string;
    splitStrategy: SplitStrategyKey | null;
    splits: { userId: string; amount: number }[];
    receiptItems: ReceiptItem[];
    receiptUrl: string | null;
    /** Display meta of `category` (kept as a chip even if no longer effective). */
    categoryMeta?: { key: string; label: string; emoji: string };
};

/** Today (YYYY-MM-DD) in the app timezone — identical on the server and the client (no hydration drift). */
const TODAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
export const todayISO = () => TODAY_FMT.format(new Date());

export const TAG_PRESET_COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#06b6d4", "#84cc16"];

export type FormState = {
    // Where
    spaceId: string;
    // What
    amount: string;
    amountError: string | null;
    description: string;
    category: string | null;
    /**
     * The category the USER picked (or was prefilled): survives switching to a
     * space that lacks it and back (G-14); OCR never overrides it (G-15).
     */
    preferredCategory: string | null;
    categoryTouched: boolean;
    // Who
    payerId: string;
    splitChoice: SplitChoice;
    splitValue: SplitValue;
    // Más opciones
    moreOpen: boolean;
    date: string;
    notes: string;
    tags: FormTag[];
    selectedTagIds: string[];
    /** Inline "Nueva etiqueta" draft (kept while the sheet is closed and reopened). */
    newTag: { open: boolean; name: string; color: string };
    isRecurring: boolean;
    recurringInterval: RecurringInterval;
    // Receipt / OCR
    mode: "form" | "scan";
    scanHint: boolean;
    scanned: boolean;
    ocrError: string | null;
    receiptFile: File | null;
    receiptPreview: string | null;
    storedReceiptUrl: string | null;
    receiptItems: EditableReceiptItem[];
    // Submit
    saving: boolean;
    formError: string | null;
};

/** Members of a destination (none for the personal space). */
export function spaceMembers(spaces: AddSpace[], spaceId: string): AddMember[] {
    if (spaceId === PERSONAL_SPACE) return [];
    return spaces.find((s) => s.id === spaceId)?.members ?? [];
}

export function initFormState(o: {
    userId: string;
    spaces: AddSpace[];
    initialSpace: string;
    initialTitle?: string;
    initialCategory?: string | null;
    tags?: FormTag[];
    initial?: ExpenseFormInitial;
    today: string;
}): FormState {
    const { initial, userId } = o;
    const members = spaceMembers(o.spaces, o.initialSpace);
    // Computed once: the edit form's space never changes.
    const split = initial
        ? initialSplitState(initial.splitStrategy, initial.splits, members, userId, initial.amountCents)
        : { choice: "equal" as SplitChoice, value: seedSplitValue("equal", members, 0) };
    return {
        spaceId: o.initialSpace,
        amount: initial ? centsToAmount(initial.amountCents) : "",
        amountError: null,
        description: initial?.description ?? o.initialTitle ?? "",
        category: initial?.category ?? null,
        preferredCategory: initial?.category ?? o.initialCategory ?? null,
        categoryTouched: !!initial || !!o.initialCategory,
        payerId: initial?.paidById ?? userId,
        splitChoice: split.choice,
        splitValue: split.value,
        moreOpen: false,
        date: initial?.date ?? o.today,
        notes: initial?.notes ?? "",
        tags: o.tags ?? [],
        selectedTagIds: initial?.tagIds ?? [],
        newTag: { open: false, name: "", color: TAG_PRESET_COLORS[0] },
        isRecurring: initial?.isRecurring ?? false,
        recurringInterval: initial?.recurringInterval ?? "monthly",
        mode: "form",
        scanHint: false,
        scanned: false,
        ocrError: null,
        receiptFile: null,
        receiptPreview: initial?.receiptUrl ?? null,
        storedReceiptUrl: initial?.receiptUrl ?? null,
        receiptItems: (initial?.receiptItems ?? []).map(withUid),
        saving: false,
        formError: null,
    };
}

export type FormAction =
    | { type: "spaceChanged"; spaceId: string; userId: string; members: SplitMember[] }
    | { type: "amountKey"; key: AmountKey }
    | { type: "amountTyped"; raw: string }
    | { type: "amountSet"; amount: string }
    | { type: "descriptionChanged"; value: string }
    | { type: "categoryPicked"; key: string }
    | { type: "categoriesChanged"; keys: string[] }
    | { type: "payerChanged"; payerId: string }
    | { type: "splitChoiceChanged"; choice: SplitChoice }
    | { type: "customSplitEdited"; value: SplitValue }
    | { type: "moreOpened"; splitValue?: SplitValue | null }
    | { type: "moreClosed" }
    | { type: "dateChanged"; date: string }
    | { type: "notesChanged"; notes: string }
    | { type: "tagsLoaded"; tags: FormTag[] }
    | { type: "tagToggled"; id: string }
    | { type: "newTagDraft"; draft: Partial<FormState["newTag"]> }
    | { type: "tagCreated"; tag: FormTag }
    | { type: "recurringToggled" }
    | { type: "intervalChanged"; interval: RecurringInterval }
    | { type: "itemsChanged"; items: EditableReceiptItem[] }
    | { type: "scanHintShown" }
    | { type: "fileChosen"; file: File; preview: string }
    | { type: "scanStarted" }
    | { type: "scanFailed"; error: string }
    | {
        type: "scanSucceeded";
        items: EditableReceiptItem[];
        total: number | null;
        store: string | null;
        /** Already checked against the effective categories by the caller. */
        category: string | null;
    }
    | { type: "receiptDiscarded" }
    | { type: "scanCancelled" }
    | { type: "formError"; error: string | null; openMore?: boolean }
    | { type: "saveStarted" }
    | { type: "saveFailed"; error: string };

/** Receipt lines are the source of truth for the total once present. */
function withItems(state: FormState, items: EditableReceiptItem[]): FormState {
    return items.length > 0
        ? { ...state, receiptItems: items, amount: centsToAmount(receiptLinesCents(items)) }
        : { ...state, receiptItems: items };
}

function withoutReceipt(state: FormState): FormState {
    return { ...state, receiptFile: null, storedReceiptUrl: null, receiptPreview: null, scanned: false };
}

export function formReducer(state: FormState, action: FormAction): FormState {
    switch (action.type) {
        case "spaceChanged": {
            if (action.spaceId === state.spaceId) return state;
            return {
                ...state,
                spaceId: action.spaceId,
                payerId: action.userId,
                splitChoice: "equal",
                splitValue: seedSplitValue("equal", action.members, amountToCents(state.amount)),
                selectedTagIds: [],
            };
        }
        case "amountKey":
            return { ...state, amountError: null, amount: applyAmountKey(state.amount, action.key) };
        case "amountTyped": {
            const r = normalizeAmountText(action.raw);
            // Never keep a different amount than the one typed (G-05).
            return r.ok ? { ...state, amountError: null, amount: r.amount } : { ...state, amountError: r.error };
        }
        case "amountSet":
            return { ...state, amount: action.amount };
        case "descriptionChanged":
            return { ...state, description: action.value };
        case "categoryPicked":
            return { ...state, category: action.key, preferredCategory: action.key, categoryTouched: true };
        case "categoriesChanged": {
            if (action.keys.length === 0) return state;
            const keys = new Set(action.keys);
            const pref = state.preferredCategory;
            const category = pref && keys.has(pref)
                ? pref
                : state.category && keys.has(state.category) ? state.category : action.keys[0];
            return category === state.category ? state : { ...state, category };
        }
        case "payerChanged":
            return { ...state, payerId: action.payerId };
        case "splitChoiceChanged":
            return { ...state, splitChoice: action.choice };
        case "customSplitEdited":
            return { ...state, splitValue: action.value, splitChoice: "custom" };
        case "moreOpened":
            return { ...state, moreOpen: true, ...(action.splitValue ? { splitValue: action.splitValue } : {}) };
        case "moreClosed":
            return { ...state, moreOpen: false };
        case "dateChanged":
            return { ...state, date: action.date };
        case "notesChanged":
            return { ...state, notes: action.notes.slice(0, 500) };
        case "tagsLoaded":
            return { ...state, tags: action.tags };
        case "tagToggled": {
            const { id } = action;
            const on = state.selectedTagIds.includes(id);
            return { ...state, selectedTagIds: on ? state.selectedTagIds.filter((x) => x !== id) : [...state.selectedTagIds, id] };
        }
        case "newTagDraft":
            return { ...state, newTag: { ...state.newTag, ...action.draft } };
        case "tagCreated":
            return {
                ...state,
                tags: [...state.tags, action.tag],
                selectedTagIds: [...state.selectedTagIds, action.tag.id],
                newTag: { ...state.newTag, open: false, name: "" },
            };
        case "recurringToggled":
            return { ...state, isRecurring: !state.isRecurring };
        case "intervalChanged":
            return { ...state, recurringInterval: action.interval };
        case "itemsChanged":
            return withItems(state, action.items);
        case "scanHintShown":
            return { ...state, scanHint: true };
        case "fileChosen":
            return { ...state, scanHint: false, receiptFile: action.file, receiptPreview: action.preview };
        case "scanStarted":
            return { ...state, mode: "scan", ocrError: null };
        case "scanFailed":
            return { ...state, mode: "form", ocrError: action.error };
        case "scanSucceeded": {
            let next = state;
            if (action.items.length > 0) next = withItems(next, action.items);
            else if (action.total !== null) next = { ...next, amount: centsToAmount(Math.round(action.total * 100)) };
            if (action.store && next.description.trim() === "") next = { ...next, description: action.store };
            // Like the concept: the OCR only fills the category if the user hasn't chosen one (G-15).
            if (!next.categoryTouched && action.category) next = { ...next, category: action.category };
            return { ...next, scanned: true, mode: "form" };
        }
        case "receiptDiscarded":
            return withoutReceipt(state);
        case "scanCancelled":
            return withoutReceipt({ ...state, mode: "form" });
        case "formError":
            if (action.error === state.formError && !action.openMore) return state;
            return { ...state, formError: action.error, ...(action.openMore ? { moreOpen: true } : {}) };
        case "saveStarted":
            return { ...state, saving: true };
        case "saveFailed":
            return { ...state, saving: false, formError: action.error };
    }
}

/** Next quick split when tapping the "Reparto" tile (custom restarts the cycle). */
export function nextQuickSplit(order: QuickSplit[], current: SplitChoice): QuickSplit {
    const i = current === "custom" ? -1 : order.indexOf(current);
    return order[(i + 1) % order.length];
}

/**
 * Mirror the quick choice into the custom editor so "custom" starts from what
 * the user sees when opening "Más opciones". Null → keep the current value.
 */
export function mirrorQuickSplit(
    choice: SplitChoice,
    members: SplitMember[],
    meId: string,
    totalCents: number,
    shares: Record<string, number>,
): SplitValue | null {
    if (choice === "custom") return null;
    const others = members.filter((m) => m.id !== meId);
    if (choice === "equal") return seedSplitValue("equal", members, totalCents);
    if (choice === "mine") return seedSplitValue("exclusive", members, totalCents, meId);
    if (others.length === 1) return seedSplitValue("exclusive", members, totalCents, others[0].id);
    const v = seedSplitValue("amounts", members, totalCents);
    for (const m of members) v.amounts[m.id] = centsToAmount(shares[m.id] ?? 0).replace(/^$/, "0");
    return v;
}

export type SplitView = {
    /** Receipt lines assigned per person (2-member space) override the split. */
    itemized: boolean;
    linesCents: number;
    linesMismatch: boolean;
    customResult: SplitResult;
    shares: Record<string, number>;
    preview: string;
    splitLabel: string;
    splitOptions: { value: QuickSplit; label: string }[];
};

/** Everything the Pagó/Reparto tiles and the save payload derive from the state. */
export function deriveSplit(o: {
    state: Pick<FormState, "receiptItems" | "splitChoice" | "splitValue" | "payerId">;
    members: SplitMember[];
    userId: string;
    isShared: boolean;
    partnerId: string | null;
    totalCents: number;
}): SplitView {
    const { state, members, userId, isShared, partnerId, totalCents } = o;
    const { receiptItems, splitChoice, splitValue, payerId } = state;
    const itemized = isShared && !!partnerId && receiptItems.some((it) => it.assignedTo);
    const linesCents = receiptLinesCents(receiptItems);
    const linesMismatch = receiptItems.length > 0 && totalCents > 0 && linesCents !== totalCents;
    const itemMyCents = Math.round(
        receiptItems.reduce((acc, it) => acc + (it.assignedTo == null ? it.total / 2 : it.assignedTo === userId ? it.total : 0), 0) * 100,
    );
    const splitOptions = isShared ? quickSplitOptions(members, userId) : [];
    const customResult = computeSplit(splitValue, members, totalCents);
    const shares: Record<string, number> = itemized && partnerId
        ? { [userId]: itemMyCents, [partnerId]: linesCents - itemMyCents }
        : splitChoice === "custom"
            ? customResult.shares
            : quickShares(splitChoice, members, userId, totalCents);
    const delta = balanceDelta(payerId, userId, shares, totalCents);
    const preview = isShared && !(itemized && linesMismatch) && (splitChoice !== "custom" || customResult.valid || itemized)
        ? previewLine({ deltaCents: delta, totalCents, members, meId: userId, payerId })
        : "";
    const splitLabel = itemized
        ? "Por productos"
        : splitChoice === "custom"
            ? "Personalizado"
            : splitOptions.find((o) => o.value === splitChoice)?.label ?? "";
    return { itemized, linesCents, linesMismatch, customResult, shares, preview, splitLabel, splitOptions };
}

/**
 * Validation run when pressing "Guardar", in order. `toast` is the empty-amount
 * nudge; `error` goes to the inline alert (`openMore` reveals the culprit).
 */
export type PreSaveIssue = { kind: "toast"; message: string } | { kind: "error"; message: string; openMore?: boolean };

export function preSaveCheck(o: {
    totalCents: number;
    split: Pick<SplitView, "itemized" | "linesMismatch" | "linesCents" | "customResult">;
    isShared: boolean;
    splitChoice: SplitChoice;
    date: string;
    category: string | null;
}): PreSaveIssue | null {
    const { totalCents, split, isShared, splitChoice } = o;
    if (totalCents <= 0) return { kind: "toast", message: "Introduce un importe" };
    if (split.itemized && split.linesMismatch) {
        return {
            kind: "error",
            message: `El importe (${formatCurrency(totalCents)}) no coincide con la suma del desglose (${formatCurrency(split.linesCents)}). Ajusta los productos o usa el total del ticket.`,
        };
    }
    if (isShared && !split.itemized && splitChoice === "custom" && !split.customResult.valid) {
        return { kind: "error", message: split.customResult.reason || "Revisa el reparto del gasto.", openMore: true };
    }
    const dateCheck = checkExpenseDay(o.date);
    if (!dateCheck.ok) return { kind: "error", message: dateCheck.error, openMore: true };
    if (!o.category) return { kind: "error", message: "Elige una categoría." };
    return null;
}

export type ReceiptLine = { description: string; quantity: number; price: number; total: number; assignedTo: string | null };

export function receiptLines(items: EditableReceiptItem[]): ReceiptLine[] {
    return items.map(({ description: d, quantity, price, total, assignedTo }) => ({
        description: d, quantity, price, total, assignedTo: assignedTo ?? null,
    }));
}

/** Body of POST /api/expenses (create) or PATCH /api/expenses/[id] (edit). */
export function buildExpenseBody(o: {
    initial?: ExpenseFormInitial;
    totalCents: number;
    title: string;
    category: string;
    receiptUrl: string | null;
    isRecurring: boolean;
    recurringInterval: RecurringInterval;
    date: string;
    today: string;
    notes: string;
    lines: ReceiptLine[];
    isPersonal: boolean;
    groupId: string | null;
    payerId: string;
    split: SplitPayload;
}): Record<string, unknown> {
    const { initial } = o;
    const body: Record<string, unknown> = {
        amount: o.totalCents / 100,
        description: o.title,
        category: o.category,
        receiptUrl: o.receiptUrl,
        isRecurring: o.isRecurring,
        recurringInterval: o.isRecurring ? o.recurringInterval : undefined,
    };
    if (initial) {
        if (o.date !== initial.date) body.date = o.date;
        if (o.category === initial.category) delete body.category;
        body.notes = o.notes.trim() || null;
        // Always send the lines so removing them all clears the breakdown.
        if (o.lines.length > 0 || (initial.receiptItems.length ?? 0) > 0) body.receiptItems = o.lines;
        if (!o.isPersonal) body.paidById = o.payerId;
        Object.assign(body, o.split);
    } else {
        if (o.date !== o.today) body.date = o.date;
        body.notes = o.notes.trim() || undefined;
        body.receiptData = o.lines.length > 0 ? o.lines : undefined;
        if (o.isPersonal) {
            body.visibility = "PERSONAL";
        } else {
            // G-02: the destination travels explicitly; the API authorizes it.
            body.groupId = o.groupId;
            body.paidById = o.payerId;
            Object.assign(body, o.split);
        }
    }
    return body;
}

/** Tag ids to add/remove so the expense ends with `selected`. */
export function tagDiff(before: string[], selected: string[]): { toAdd: string[]; toRemove: string[] } {
    return {
        toAdd: selected.filter((id) => !before.includes(id)),
        toRemove: before.filter((id) => !selected.includes(id)),
    };
}

export function withParam(path: string, key: string, value: string) {
    const [base, hash = ""] = path.split("#");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ""}`;
}
