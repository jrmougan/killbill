"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, ChevronDown, Info, Plus, RotateCw, ScanLine, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EqChip, EqCta, EqToast, useEqToast } from "@/components/ui/eq";
import { setActiveGroup } from "@/app/actions/group";
import { formatCurrency } from "@/lib/currency";
import { safeReturnTo } from "@/lib/safe-return";
import { MIN_EXPENSE_DATE, checkExpenseDay } from "@/lib/expense-input";
import type { CategoryContext } from "@/lib/category-context";
import type { ReceiptItem } from "@/types";
import { useCategoryList } from "@/components/category/use-category-list";
import { SplitEditor, computeSplit, seedSplitValue, type SplitValue } from "@/components/expense/split-editor";
import { PERSONAL_SPACE, spaceEmoji } from "@/components/expenses/space-meta";
import { Numpad } from "./numpad";
import { ScanScreen } from "./scan-screen";
import { MoreOptionsSheet, OptionSection } from "./more-options-sheet";
import { ReceiptItemsEditor, withUid, type EditableReceiptItem } from "./receipt-items-editor";
import { applyAmountKey, amountToCents, centsToAmount, normalizeAmountText, type AmountKey } from "./amount-input";
import {
    balanceDelta, initialSplitState, previewLine, quickShares, quickSplitOptions, type QuickSplit,
} from "./quick-split";
import { receiptLinesCents, splitPayload } from "./form-payload";

export type AddMember = { id: string; name: string; avatar: string | null };
export type AddSpace = { id: string; name: string; type: string; members: AddMember[] };
export type FormTag = { id: string; name: string; color: string; coupleId?: string | null; ownerId?: string | null };
/** A space the caller belongs to but that does not accept new expenses (G-09). */
export type BlockedSpace = { id: string; name: string; status: "SETTLING" | "ARCHIVED" };

type RecurringInterval = "weekly" | "monthly" | "yearly";
type SplitChoice = QuickSplit | "custom";
type SplitStrategyKey = "EQUAL" | "CUSTOM" | "EXCLUSIVE" | "ITEMIZED";

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

const TAG_PRESET_COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#06b6d4", "#84cc16"];
const INTERVALS: { value: RecurringInterval; label: string }[] = [
    { value: "weekly", label: "Semanal" },
    { value: "monthly", label: "Mensual" },
    { value: "yearly", label: "Anual" },
];

/** Today (YYYY-MM-DD) in the app timezone — identical on the server and the client (no hydration drift). */
const TODAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const todayISO = () => TODAY_FMT.format(new Date());

function withParam(path: string, key: string, value: string) {
    const [base, hash = ""] = path.split("#");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ""}`;
}

/** True when the previous history entry is this app (so "back" stays in-app). */
function hasInAppHistory(): boolean {
    try {
        return window.history.length > 1 && !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
        return false;
    }
}

const STATUS_LABEL: Record<BlockedSpace["status"], string> = { SETTLING: "se está liquidando", ARCHIVED: "está archivado" };

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

    // ---------- Where ----------
    const [spaceId, setSpaceId] = useState(initialSpace);
    const space = spaces.find((s) => s.id === spaceId) ?? null;
    const isPersonal = spaceId === PERSONAL_SPACE || !space;
    const members = useMemo(() => (isPersonal ? [] : space?.members ?? []), [isPersonal, space]);
    const isShared = !isPersonal && members.length > 1;
    const partner = members.length === 2 ? members.find((m) => m.id !== userId) ?? null : null;

    // ---------- What ----------
    const [amount, setAmount] = useState(() => (initial ? centsToAmount(initial.amountCents) : ""));
    const [amountError, setAmountError] = useState<string | null>(null);
    const [description, setDescription] = useState(initial?.description ?? initialTitle);
    const [category, setCategory] = useState<string | null>(initial?.category ?? null);
    // The category the USER picked (or was prefilled): survives switching to a
    // space that lacks it and back (G-14); OCR never overrides it (G-15).
    const preferredCategory = useRef<string | null>(initial?.category ?? initialCategory);
    const categoryTouched = useRef<boolean>(!!initial || !!initialCategory);
    const totalCents = amountToCents(amount);

    // ---------- Who ----------
    // Computed once: the edit form's space never changes.
    const [initialSplit] = useState(() => initial
        ? initialSplitState(initial.splitStrategy, initial.splits, members, userId, initial.amountCents)
        : { choice: "equal" as SplitChoice, value: seedSplitValue("equal", members, 0) });
    const [payerId, setPayerId] = useState(initial?.paidById ?? userId);
    const [splitChoice, setSplitChoice] = useState<SplitChoice>(initialSplit.choice);
    const [splitValue, setSplitValue] = useState<SplitValue>(initialSplit.value);

    // ---------- Más opciones ----------
    const [moreOpen, setMoreOpen] = useState(false);
    const [date, setDate] = useState(initial?.date ?? todayISO);
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [tags, setTags] = useState<FormTag[]>(initialTags ?? []);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initial?.tagIds ?? []);
    const [newTagOpen, setNewTagOpen] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);
    const [isRecurring, setIsRecurring] = useState(initial?.isRecurring ?? false);
    const [recurringInterval, setRecurringInterval] = useState<RecurringInterval>(initial?.recurringInterval ?? "monthly");

    // ---------- Receipt / OCR ----------
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ocrAbort = useRef<AbortController | null>(null);
    const [mode, setMode] = useState<"form" | "scan">("form");
    const [scanHint, setScanHint] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<string | null>(initial?.receiptUrl ?? null);
    const [storedReceiptUrl, setStoredReceiptUrl] = useState<string | null>(initial?.receiptUrl ?? null);
    const [receiptItems, setReceiptItems] = useState<EditableReceiptItem[]>(() => (initial?.receiptItems ?? []).map(withUid));

    // ---------- Submit ----------
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false); // synchronous double-submit guard (G-19)
    const [formError, setFormError] = useState<string | null>(null);

    // Categories: the effective set (system ∪ space/personal custom) of the
    // chosen destination — never hardcoded.
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
    useEffect(() => {
        if (categories.length === 0) return;
        const keys = new Set(categories.map((c) => c.key));
        setCategory((cur) => {
            const pref = preferredCategory.current;
            if (pref && keys.has(pref)) return pref;
            if (cur && keys.has(cur)) return cur;
            return categories[0].key;
        });
    }, [categories]);
    const categoryMeta = categories.find((c) => c.key === category) ?? null;
    const pickCategory = (key: string) => {
        preferredCategory.current = key;
        categoryTouched.current = true;
        setCategory(key);
    };

    // Tags: an expense can only carry tags of its own scope.
    useEffect(() => {
        if (initialTags) return;
        fetch("/api/tags")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.tags) setTags(d.tags); })
            .catch((e) => console.error("Failed to fetch tags", e));
    }, [initialTags]);
    const visibleTags = tags.filter((t) => (isPersonal ? !t.coupleId : t.coupleId === spaceId));
    // /api/tags creates group tags in the ACTIVE space only.
    const canCreateTag = isPersonal || spaceId === activeGroupId;

    const changeSpace = (id: string) => {
        if (isEdit || id === spaceId) return;
        const next = spaces.find((s) => s.id === id);
        setSpaceId(id);
        setPayerId(userId);
        setSplitChoice("equal");
        setSplitValue(seedSplitValue("equal", next?.members ?? [], totalCents));
        setSelectedTagIds([]);
    };

    // ---------- Amount entry (numpad + physical keyboard + paste) ----------
    const pressKey = useCallback((k: AmountKey) => {
        setAmountError(null);
        setAmount((prev) => applyAmountKey(prev, k));
    }, []);

    const typeAmount = (raw: string) => {
        const r = normalizeAmountText(raw);
        if (r.ok) {
            setAmountError(null);
            setAmount(r.amount);
        } else {
            // Never keep a different amount than the one typed (G-05).
            setAmountError(r.error);
        }
    };

    useEffect(() => {
        if (mode !== "form" || moreOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
            if (/^[0-9]$/.test(e.key)) pressKey(e.key as AmountKey);
            else if (e.key === "," || e.key === ".") pressKey(",");
            else if (e.key === "Backspace") pressKey("del");
            else return;
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mode, moreOpen, pressKey]);

    // Receipt lines are the source of truth for the total once present.
    const updateItems = (items: EditableReceiptItem[]) => {
        setReceiptItems(items);
        if (items.length > 0) setAmount(centsToAmount(receiptLinesCents(items)));
    };

    // ---------- Split ----------
    // Receipt lines assigned per person (2-member space) override the split.
    const itemized = isShared && !!partner && receiptItems.some((it) => it.assignedTo);
    const linesCents = receiptLinesCents(receiptItems);
    const linesMismatch = receiptItems.length > 0 && totalCents > 0 && linesCents !== totalCents;
    const itemMyCents = Math.round(
        receiptItems.reduce((acc, it) => acc + (it.assignedTo == null ? it.total / 2 : it.assignedTo === userId ? it.total : 0), 0) * 100,
    );
    const splitOptions = isShared ? quickSplitOptions(members, userId) : [];
    const customResult = computeSplit(splitValue, members, totalCents);
    const shares: Record<string, number> = itemized && partner
        ? { [userId]: itemMyCents, [partner.id]: linesCents - itemMyCents }
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

    // A stale error disappears as soon as the user changes what caused it (G-13).
    useEffect(() => {
        setFormError(null);
    }, [splitValue, splitChoice, totalCents, payerId, receiptItems, category, date, spaceId]);

    const cycleSplit = () => {
        if (itemized) { setMoreOpen(true); return; }
        const order: QuickSplit[] = splitOptions.map((o) => o.value);
        const i = splitChoice === "custom" ? -1 : order.indexOf(splitChoice);
        setSplitChoice(order[(i + 1) % order.length]);
    };

    const openMore = () => {
        // Mirror the quick choice into the editor so "custom" starts from what the user sees.
        if (splitChoice !== "custom" && isShared) {
            const others = members.filter((m) => m.id !== userId);
            if (splitChoice === "equal") setSplitValue(seedSplitValue("equal", members, totalCents));
            else if (splitChoice === "mine") setSplitValue(seedSplitValue("exclusive", members, totalCents, userId));
            else if (others.length === 1) setSplitValue(seedSplitValue("exclusive", members, totalCents, others[0].id));
            else {
                const v = seedSplitValue("amounts", members, totalCents);
                for (const m of members) v.amounts[m.id] = centsToAmount(shares[m.id] ?? 0).replace(/^$/, "0");
                setSplitValue(v);
            }
        }
        setMoreOpen(true);
    };

    // ---------- OCR ----------
    const runOcr = async (file: File) => {
        setMode("scan");
        setOcrError(null);
        const ctrl = new AbortController();
        ocrAbort.current = ctrl;
        try {
            const fd = new FormData();
            fd.append("image", file);
            const res = await fetch("/api/ocr", { method: "POST", body: fd, signal: ctrl.signal });
            const data = res.ok ? await res.json() : null;
            if (ctrl.signal.aborted) return;
            if (!data?.success) {
                setOcrError(res.ok
                    ? "No se reconoció el ticket. Prueba otra foto o rellénalo a mano."
                    : "No se pudo leer el ticket. Puedes reintentar o rellenarlo a mano.");
                setMode("form");
                return;
            }
            const items: EditableReceiptItem[] = Array.isArray(data.items) ? data.items.map(withUid) : [];
            if (items.length > 0) updateItems(items);
            else if (typeof data.total === "number") setAmount(centsToAmount(Math.round(data.total * 100)));
            if (data.store) setDescription((prev) => (prev.trim() === "" ? data.store : prev));
            // Like the concept: the OCR only fills the category if the user hasn't chosen one (G-15).
            if (!categoryTouched.current && typeof data.category === "string" && categories.some((c) => c.key === data.category)) {
                setCategory(data.category);
            }
            setScanned(true);
            setMode("form");
        } catch (err) {
            if (ctrl.signal.aborted) return;
            console.error("OCR error", err);
            setOcrError("Error al procesar la imagen. Comprueba tu conexión y reintenta.");
            setMode("form");
        }
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setScanHint(false);
        setReceiptFile(file);
        setReceiptPreview((old) => { if (old?.startsWith("blob:")) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
        void runOcr(file);
    };

    const discardReceipt = () => {
        setReceiptFile(null);
        setStoredReceiptUrl(null);
        setReceiptPreview((old) => { if (old?.startsWith("blob:")) URL.revokeObjectURL(old); return null; });
        setScanned(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const cancelScan = () => {
        ocrAbort.current?.abort();
        setMode("form");
        discardReceipt();
    };

    const openScanner = () => fileInputRef.current?.click();

    useEffect(() => {
        if (!autoScan) return;
        // Browsers may refuse a picker without a user gesture: keep a visual hint.
        setScanHint(true);
        try { fileInputRef.current?.click(); } catch { /* blocked: the hint stays */ }
    }, [autoScan]);

    // ---------- Close ----------
    const fallbackHref = isEdit
        ? `/expense/${initial!.expenseId}`
        : initialSpace === PERSONAL_SPACE ? "/dashboard?scope=personal" : "/dashboard";
    const close = () => {
        if (returnTo) router.push(returnTo);
        else if (hasInAppHistory()) router.back();
        else router.push(fallbackHref);
    };

    // ---------- Tags ----------
    const toggleTag = (id: string) =>
        setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const createTag = async () => {
        if (!newTagName.trim()) return;
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newTagName.trim(), color: newTagColor, ...(isPersonal ? { personal: true } : {}) }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.tag) {
                setFormError(data?.error || "No se pudo crear la etiqueta.");
                return;
            }
            setTags((prev) => [...prev, data.tag]);
            setSelectedTagIds((prev) => [...prev, data.tag.id]);
            setNewTagName("");
            setNewTagOpen(false);
        } catch (err) {
            console.error("Failed to create tag", err);
            setFormError("No se pudo crear la etiqueta.");
        }
    };

    /** Apply the tag diff; returns the names of tags that failed. */
    const syncTags = async (expenseId: string): Promise<number> => {
        const before = initial?.tagIds ?? [];
        const toAdd = selectedTagIds.filter((id) => !before.includes(id));
        const toRemove = before.filter((id) => !selectedTagIds.includes(id));
        const results = await Promise.allSettled([
            ...toAdd.map((tagId) => fetch(`/api/expenses/${expenseId}/tags`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tagId }),
            })),
            ...toRemove.map((tagId) => fetch(`/api/expenses/${expenseId}/tags`, {
                method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tagId }),
            })),
        ]);
        return results.filter((r) => r.status === "rejected" || !r.value.ok).length;
    };

    // ---------- Save ----------
    const save = async () => {
        if (savingRef.current) return;
        setFormError(null);
        if (totalCents <= 0) {
            showToast("Introduce un importe");
            return;
        }
        if (itemized && linesMismatch) {
            setFormError(`El importe (${formatCurrency(totalCents)}) no coincide con la suma del desglose (${formatCurrency(linesCents)}). Ajusta los productos o usa el total del ticket.`);
            return;
        }
        if (isShared && !itemized && splitChoice === "custom" && !customResult.valid) {
            setFormError(customResult.reason || "Revisa el reparto del gasto.");
            setMoreOpen(true);
            return;
        }
        const dateCheck = checkExpenseDay(date);
        if (!dateCheck.ok) {
            setFormError(dateCheck.error);
            setMoreOpen(true);
            return;
        }
        const title = description.trim() || categoryMeta?.label || "Gasto";
        if (!category) {
            setFormError("Elige una categoría.");
            return;
        }

        savingRef.current = true;
        setSaving(true);
        try {
            let receiptUrl: string | null = storedReceiptUrl;
            if (receiptFile) {
                const fd = new FormData();
                fd.append("file", receiptFile);
                const up = await fetch("/api/upload", { method: "POST", body: fd });
                const upData = up.ok ? await up.json() : null;
                if (!upData?.success) throw new Error("No se pudo subir el ticket. Inténtalo de nuevo.");
                receiptUrl = upData.url;
            }

            const lines = receiptItems.map(({ description: d, quantity, price, total, assignedTo }) => ({
                description: d, quantity, price, total, assignedTo: assignedTo ?? null,
            }));
            const split = splitPayload({
                mode: isEdit ? "edit" : "create",
                isShared, itemized, choice: splitChoice, custom: customResult, members, meId: userId, totalCents,
            });

            const body: Record<string, unknown> = {
                amount: totalCents / 100,
                description: title,
                category,
                receiptUrl,
                isRecurring,
                recurringInterval: isRecurring ? recurringInterval : undefined,
            };
            if (isEdit) {
                if (date !== initial!.date) body.date = date;
                if (category === initial!.category) delete body.category;
                body.notes = notes.trim() || null;
                // Always send the lines so removing them all clears the breakdown.
                if (lines.length > 0 || (initial?.receiptItems.length ?? 0) > 0) body.receiptItems = lines;
                if (!isPersonal) body.paidById = payerId;
                Object.assign(body, split);
            } else {
                if (date !== todayISO()) body.date = date;
                body.notes = notes.trim() || undefined;
                body.receiptData = lines.length > 0 ? lines : undefined;
                if (isPersonal) {
                    body.visibility = "PERSONAL";
                } else {
                    // G-02: the destination travels explicitly; the API authorizes it.
                    body.groupId = space!.id;
                    body.paidById = payerId;
                    Object.assign(body, split);
                }
            }

            const res = await fetch(isEdit ? `/api/expenses/${initial!.expenseId}` : "/api/expenses", {
                method: isEdit ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.error || "No se pudo guardar el gasto. Inténtalo de nuevo.");
            }
            const data = await res.json();
            const expenseId: string | undefined = isEdit ? initial!.expenseId : data.expenseId;
            const failedTags = expenseId ? await syncTags(expenseId) : 0;

            if (isEdit) {
                if (failedTags > 0) showToast("Gasto guardado, pero no se pudieron actualizar las etiquetas");
                router.push(`/expense/${initial!.expenseId}`);
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
            const dest = returnTo ?? (isPersonal ? "/dashboard?scope=personal" : "/dashboard");
            router.push(withParam(dest, "saved", String(totalCents)));
            router.refresh();
        } catch (err) {
            console.error(err);
            setFormError(err instanceof Error && err.message ? err.message : "Error de conexión. Inténtalo de nuevo.");
            savingRef.current = false;
            setSaving(false);
        }
    };

    const today = todayISO();
    const hasAdvanced = selectedTagIds.length > 0 || isRecurring || notes.trim() !== "" || receiptItems.length > 0
        || date !== (initial?.date ?? today) || splitChoice === "custom" || !!receiptFile || !!storedReceiptUrl;
    const payerName = (id: string) => (id === userId ? "Tú" : members.find((m) => m.id === id)?.name ?? "Tú");
    const dateLabel = date === today
        ? "Hoy"
        : new Date(`${date}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    const shownError = formError ?? amountError ?? ocrError;
    const spaceChips = isEdit ? spaces.filter((s) => s.id === spaceId) : spaces;

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

            {/* Top bar: close + where the expense goes */}
            <div className="flex items-center gap-2.5 px-5 pt-3 pb-1">
                <button type="button" onClick={close} aria-label="Cerrar" data-testid="expense-close" className="h-6 w-6 flex-none">
                    <X className="h-6 w-6" />
                </button>
                <h1 className={isEdit ? "flex-none text-[17px] font-bold tracking-[-0.01em]" : "sr-only"}>
                    {isEdit ? "Editar gasto" : "Nuevo gasto"}
                </h1>
                <fieldset aria-label="Espacio del gasto" className="eq-scroll m-0 min-w-0 border-0 p-0 flex-1 flex gap-1.5 overflow-x-auto">
                    {spaceChips.map((s) => (
                        <EqChip
                            key={s.id}
                            tone="accent"
                            selected={s.id === spaceId}
                            onClick={() => changeSpace(s.id)}
                            disabled={isEdit}
                            className="py-1.5"
                            data-testid={`space-chip-${s.id}`}
                        >
                            {spaceEmoji(s.type)} {s.name}
                        </EqChip>
                    ))}
                    {allowPersonal && (!isEdit || isPersonal) && (
                        <EqChip tone="accent" selected={isPersonal} onClick={() => changeSpace(PERSONAL_SPACE)} disabled={isEdit} className="py-1.5" data-testid="space-chip-personal">
                            {spaceEmoji(null)} Personal
                        </EqChip>
                    )}
                </fieldset>
            </div>
            {!isEdit && blockedSpaces.length > 0 && (
                <p data-testid="blocked-spaces-note" className="mx-5 mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
                    <Info className="mt-px h-3.5 w-3.5 flex-none" aria-hidden />
                    <span>
                        {blockedSpaces.map((b) => `«${b.name}» ${STATUS_LABEL[b.status]}`).join(" · ")}
                        {blockedSpaces.length === 1 ? ": no admite gastos nuevos." : ": no admiten gastos nuevos."}
                    </span>
                </p>
            )}

            {mode === "scan" ? (
                <ScanScreen preview={receiptPreview} onCancel={cancelScan} />
            ) : (
                <>
                    <div className="flex flex-col items-center gap-3 px-5 pt-[22px] pb-2.5 [@media(max-height:640px)]:gap-2 [@media(max-height:640px)]:pt-2">
                        {scanned && (
                            <span className="eq-in flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-[5px] text-xs font-semibold text-primary">
                                <Sparkles className="h-[13px] w-[13px]" /> Ticket leído · revisa y guarda
                            </span>
                        )}
                        <label className="flex max-w-full items-baseline justify-center text-[clamp(38px,13vw,56px)] font-bold leading-none tracking-[-0.03em] [@media(max-height:640px)]:text-[40px]">
                            <span className="sr-only">Importe en euros</span>
                            {/* Auto-width input: an invisible twin sizes the grid cell, and
                                the input itself takes no intrinsic width so short
                                amounts stay centred (G-10). */}
                            <span className="inline-grid min-w-0">
                                <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre">{amount || "0"}</span>
                                <input
                                    data-testid="expense-amount"
                                    inputMode="none"
                                    autoComplete="off"
                                    value={amount}
                                    placeholder="0"
                                    size={1}
                                    aria-invalid={!!amountError}
                                    onChange={(e) => typeAmount(e.target.value)}
                                    className="col-start-1 row-start-1 w-0 min-w-full bg-transparent p-0 text-right text-foreground caret-primary outline-none placeholder:text-[color:var(--ink-3)]"
                                />
                            </span>
                            <span className="text-[color:var(--ink-3)]">&nbsp;€</span>
                        </label>
                        <input
                            data-testid="expense-description"
                            aria-label="Concepto"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Concepto (opcional)"
                            maxLength={120}
                            className="h-[46px] w-full rounded-[14px] border border-[color:var(--line)] bg-card px-3.5 text-[15px] outline-none focus:border-[color:var(--accent-border)]"
                        />
                        <fieldset aria-label="Categoría" className="eq-scroll m-0 min-w-0 border-0 p-0 flex w-full gap-1.5 overflow-x-auto text-[13px] font-semibold">
                            {categoriesLoading && categories.length === 0 && (
                                <span className="py-[7px] text-muted-foreground">Cargando categorías…</span>
                            )}
                            {categories.map((c) => {
                                const on = c.key === category;
                                return (
                                    <button
                                        key={c.key}
                                        type="button"
                                        aria-pressed={on}
                                        data-testid={`category-chip-${c.key}`}
                                        onClick={() => pickCategory(c.key)}
                                        className={cn(
                                            "flex-none whitespace-nowrap rounded-[10px] border px-[11px] py-[7px] transition-colors",
                                            on ? "bg-[var(--accent-tint)] text-primary border-primary" : "bg-card border-[color:var(--line)]",
                                        )}
                                    >
                                        {c.emoji} {c.label}
                                    </button>
                                );
                            })}
                        </fieldset>
                        {isShared && (
                            <div className="grid w-full grid-cols-2 gap-2">
                                <label className="relative block rounded-[14px] border border-[color:var(--line)] bg-card px-3 py-[9px] cursor-pointer">
                                    <span className="block text-[11px] text-muted-foreground">Pagó</span>
                                    <span className="flex items-center justify-between text-sm font-semibold">
                                        <span className="truncate">{payerName(payerId)}</span>
                                        <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                                    </span>
                                    <select
                                        aria-label="Pagó"
                                        data-testid="expense-payer"
                                        value={payerId}
                                        onChange={(e) => setPayerId(e.target.value)}
                                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                    >
                                        {members.map((m) => (
                                            <option key={m.id} value={m.id}>{m.id === userId ? "Tú" : m.name}</option>
                                        ))}
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    onClick={cycleSplit}
                                    data-testid="expense-split"
                                    aria-label={`Reparto: ${splitLabel}. Cambiar`}
                                    className="rounded-[14px] border border-[color:var(--line)] bg-card px-3 py-[9px] text-left"
                                >
                                    <span className="block text-[11px] text-muted-foreground">Reparto</span>
                                    <span className="flex items-center justify-between gap-1 text-sm font-semibold whitespace-nowrap">
                                        <span className="truncate">{splitLabel}</span>
                                        <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                                    </span>
                                </button>
                            </div>
                        )}
                        <span aria-live="polite" data-testid="expense-preview" className="min-h-4 text-[12.5px] text-muted-foreground">{preview}</span>
                        {linesMismatch && (
                            <div data-testid="lines-mismatch" className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] bg-[var(--track)] px-3 py-2 text-[12.5px] text-muted-foreground">
                                <span className="flex-1">
                                    El desglose suma {formatCurrency(linesCents)}{itemized ? " y reparte por productos" : ""}.
                                </span>
                                <button type="button" onClick={() => setAmount(centsToAmount(linesCents))} className="font-semibold text-primary">
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
                                scanHint ? "border-primary text-primary ring-4 ring-[var(--accent-tint)]" : "border-[color:var(--line)]",
                            )}
                        >
                            <ScanLine className="h-6 w-6" />
                        </button>
                        <EqCta
                            data-testid="expense-submit"
                            className="flex-1"
                            disabled={totalCents <= 0 || saving || !category}
                            onClick={save}
                        >
                            {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar"}
                        </EqCta>
                    </div>
                </>
            )}

            {moreOpen && (
                <MoreOptionsSheet onClose={() => setMoreOpen(false)}>
                    <OptionSection label="Fecha" htmlFor="expense-date">
                        <input
                            id="expense-date"
                            data-testid="expense-date"
                            type="date"
                            value={date}
                            min={MIN_EXPENSE_DATE}
                            max={initial && initial.date > today ? initial.date : today}
                            onChange={(e) => setDate(e.target.value || today)}
                            className="w-full bg-transparent text-[15px] font-medium outline-none"
                        />
                    </OptionSection>

                    {isShared && !itemized && (
                        <OptionSection
                            label="Reparto personalizado"
                            aside={splitChoice === "custom" && (
                                <button type="button" onClick={() => setSplitChoice("equal")} className="text-xs font-semibold text-primary">Volver a rápido</button>
                            )}
                        >
                            <SplitEditor
                                members={members}
                                currentUserId={userId}
                                totalCents={totalCents}
                                value={splitValue}
                                onChange={(v) => { setSplitValue(v); setSplitChoice("custom"); }}
                                isCouple={space?.type === "COUPLE"}
                            />
                        </OptionSection>
                    )}

                    <OptionSection label="Desglose de ticket">
                        <ReceiptItemsEditor
                            items={receiptItems}
                            onChange={updateItems}
                            userId={userId}
                            partner={partner ? { id: partner.id, name: partner.name } : null}
                            assignable={isShared && !!partner}
                            emptyHint={isShared && !partner
                                ? "Escanea un ticket o añade productos. El reparto por producto solo está disponible en espacios de dos personas."
                                : undefined}
                        />
                    </OptionSection>

                    {receiptPreview && (
                        <OptionSection label="Ticket" aside={<button type="button" onClick={discardReceipt} className="text-xs font-semibold text-destructive">Quitar</button>}>
                            {/* oxlint-disable-next-line nextjs/no-img-element -- local object URL / uploaded receipt of unknown size */}
                            <img src={receiptPreview} alt="Ticket adjunto" className="max-h-60 w-full rounded-[10px] object-contain" />
                        </OptionSection>
                    )}

                    <OptionSection label="Etiquetas">
                        <div className="flex flex-wrap gap-2">
                            {visibleTags.map((tag) => {
                                const on = selectedTagIds.includes(tag.id);
                                return (
                                    <button
                                        key={tag.id}
                                        type="button"
                                        onClick={() => toggleTag(tag.id)}
                                        aria-pressed={on}
                                        className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "text-white" : "border-[color:var(--line)] bg-card text-muted-foreground")}
                                        style={on ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                                    >
                                        {tag.name}
                                    </button>
                                );
                            })}
                            {visibleTags.length === 0 && !newTagOpen && (
                                <span className="text-[13px] text-muted-foreground">
                                    {isPersonal ? "Sin etiquetas personales." : "Sin etiquetas en este espacio."}
                                </span>
                            )}
                        </div>
                        {canCreateTag ? (newTagOpen ? (
                            <div className="mt-3 space-y-2.5">
                                <input
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createTag(); } }}
                                    placeholder="Nombre de la etiqueta"
                                    aria-label="Nombre de la etiqueta"
                                    maxLength={40}
                                    className="h-10 w-full rounded-[10px] border border-[color:var(--line)] bg-card px-3 text-sm outline-none focus:border-[color:var(--accent-border)]"
                                />
                                <div className="flex flex-wrap gap-2">
                                    {TAG_PRESET_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            type="button"
                                            aria-label={`Color ${c}`}
                                            aria-pressed={newTagColor === c}
                                            onClick={() => setNewTagColor(c)}
                                            className={cn("h-7 w-7 rounded-full border-2", newTagColor === c ? "border-foreground" : "border-transparent")}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                                <div className="flex gap-3">
                                    <button type="button" onClick={createTag} disabled={!newTagName.trim()} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary disabled:opacity-40">
                                        <Check className="h-3.5 w-3.5" /> Crear
                                    </button>
                                    <button type="button" onClick={() => { setNewTagOpen(false); setNewTagName(""); }} className="text-[13px] font-semibold text-muted-foreground">Cancelar</button>
                                </div>
                            </div>
                        ) : (
                            <button type="button" onClick={() => setNewTagOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                                <Plus className="h-4 w-4" /> Nueva etiqueta
                            </button>
                        )) : (
                            <p className="mt-3 text-[12px] text-muted-foreground">Las etiquetas nuevas se crean desde el espacio activo.</p>
                        )}
                    </OptionSection>

                    <OptionSection
                        label="Recurrente"
                        aside={
                            <button
                                type="button"
                                role="switch"
                                aria-checked={isRecurring}
                                aria-label="¿Es un gasto recurrente?"
                                onClick={() => setIsRecurring((p) => !p)}
                                className={cn("relative h-6 w-11 rounded-full transition-colors", isRecurring ? "bg-primary" : "bg-[var(--track)]")}
                            >
                                <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform", isRecurring && "translate-x-5")} />
                            </button>
                        }
                    >
                        {isRecurring ? (
                            <div className="flex gap-1.5">
                                {INTERVALS.map((it) => (
                                    <EqChip key={it.value} tone="accent" selected={recurringInterval === it.value} onClick={() => setRecurringInterval(it.value)}>
                                        {it.label}
                                    </EqChip>
                                ))}
                            </div>
                        ) : (
                            <p className="text-[13px] text-muted-foreground">Se repetirá automáticamente cada semana, mes o año, contando desde la fecha del gasto.</p>
                        )}
                    </OptionSection>

                    <OptionSection label="Notas" htmlFor="expense-notes">
                        <textarea
                            id="expense-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                            placeholder="Añade una nota opcional…"
                            rows={3}
                            className="w-full resize-none bg-transparent text-sm outline-none"
                        />
                        <span className="block text-right text-[10px] text-muted-foreground">{notes.length}/500</span>
                    </OptionSection>
                </MoreOptionsSheet>
            )}

            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}
