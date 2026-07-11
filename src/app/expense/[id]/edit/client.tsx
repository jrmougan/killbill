"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ArrowLeft, Check, Heart, User, Camera, Loader2, X, Plus, Trash2,
    Calculator, FileText, Tag, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReceiptItem } from "@/types";
import { CategoryPicker } from "@/components/category/category-picker";
import type { CategoryBadgeMeta } from "@/components/category/category-badge";
import { type CategoryContext, type CategoryListItem } from "@/lib/category-context";
import { RESERVED_SYSTEM_KEYS } from "@/lib/category-keys";
import { formatEuros } from "@/lib/currency";
import {
    SplitEditor,
    computeSplit,
    splitValueFromExisting,
    type SplitValue,
} from "@/components/expense/split-editor";

type SplitMode = "shared" | "solo" | "custom";
type RecurringInterval = "weekly" | "monthly" | "yearly";

// ReceiptItem with a stable client-side id used as the React key for editable rows
type EditableReceiptItem = ReceiptItem & { _uid: string };

let receiptItemUidCounter = 0;
const nextReceiptItemUid = () => `item-${++receiptItemUidCounter}`;

const withUid = (item: ReceiptItem): EditableReceiptItem => ({ ...item, _uid: nextReceiptItemUid() });

interface TagItem {
    id: string;
    name: string;
    color: string;
}

const TAG_PRESET_COLORS = [
    "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
    "#3b82f6", "#ef4444", "#06b6d4", "#84cc16",
];

interface EditExpenseClientProps {
    expenseId: string;
    userId: string;
    partner: { id: string; name: string } | null;
    members: { id: string; name: string }[];
    initialPaidById: string;
    initialAmount: number;
    initialDescription: string;
    initialCategory: string;
    initialSplitMode: SplitMode;
    initialMyPercent: number;
    initialSplitStrategy: "EQUAL" | "CUSTOM" | "EXCLUSIVE" | "ITEMIZED" | null;
    initialSplits: { userId: string; amount: number }[];
    spaceType: string | null;
    initialReceiptItems: ReceiptItem[];
    initialReceiptUrl: string | null;
    initialNotes: string;
    initialIsRecurring: boolean;
    initialRecurringInterval: RecurringInterval;
    initialTagIds: string[];
    allTags: TagItem[];
    isPersonal?: boolean;
    groupId: string | null;
    initialCategoryMeta: CategoryBadgeMeta;
}

export function EditExpenseClient({
    expenseId,
    userId,
    partner,
    members,
    initialPaidById,
    initialAmount,
    initialDescription,
    initialCategory,
    initialSplitStrategy,
    initialSplits,
    spaceType,
    initialReceiptItems,
    initialReceiptUrl,
    initialNotes,
    initialIsRecurring,
    initialRecurringInterval,
    initialTagIds,
    allTags,
    isPersonal = false,
    groupId,
    initialCategoryMeta,
}: EditExpenseClientProps) {
    const router = useRouter();

    const [amount, setAmount] = useState(initialAmount.toFixed(2));
    const [description, setDescription] = useState(initialDescription);
    const [category, setCategory] = useState(initialCategory);
    const [loading, setLoading] = useState(false);

    // Category context: personal expenses (or a space-less one) resolve in the
    // owner scope; shared ones in the group scope.
    const categoryContext: CategoryContext =
        !isPersonal && groupId ? { kind: "shared", groupId } : { kind: "personal" };

    // Effective category keys for OCR re-scan validation. Seeded with the system
    // keys + the current one so the guard works before the picker loads.
    const [effectiveKeys, setEffectiveKeys] = useState<Set<string>>(
        () => new Set<string>([...RESERVED_SYSTEM_KEYS, initialCategory]),
    );
    const handleCategoriesLoaded = (cats: CategoryListItem[]) =>
        setEffectiveKeys(new Set([...cats.map((c) => c.key), initialCategory]));

    // Payer (N-way): who fronted the money. Editable for shared expenses.
    const [paidById, setPaidById] = useState<string>(initialPaidById);
    // N-way split via the shared SplitEditor (Fase 1), hydrated from the persisted
    // strategy + materialized split rows. Replaces splitMode/myPercent/splitWithPartner.
    const [splitValue, setSplitValue] = useState<SplitValue>(() =>
        splitValueFromExisting(initialSplitStrategy, initialSplits, members, Math.round(initialAmount * 100)),
    );

    // Items breakdown
    const [receiptItems, setReceiptItems] = useState<EditableReceiptItem[]>(() =>
        initialReceiptItems.map((item) => withUid(item))
    );

    // Receipt image
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [receiptPreview, setReceiptPreview] = useState<string | null>(initialReceiptUrl);
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [receiptUrl, setReceiptUrl] = useState<string | null>(initialReceiptUrl);
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [ocrProgress, setOcrProgress] = useState(0);

    // Notes
    const [notes, setNotes] = useState(initialNotes);

    // Tags
    const [tags, setTags] = useState<TagItem[]>(allTags);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds);
    const [tagsExpanded, setTagsExpanded] = useState(false);
    const [showNewTagForm, setShowNewTagForm] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);

    // Recurring
    const [isRecurring, setIsRecurring] = useState(initialIsRecurring);
    const [recurringInterval, setRecurringInterval] = useState<RecurringInterval>(initialRecurringInterval);
    const [recurringExpanded, setRecurringExpanded] = useState(initialIsRecurring);

    // 2-member groups keep the "me vs partner" split modes; larger groups (family)
    // edit as an N-way equal split (F5). The backend recalc is N-way already.
    const isTwoMember = members.length === 2;
    const amountNum = parseFloat(amount) || 0;
    const amountCentsLive = Math.round(amountNum * 100);

    const itemSplitMyAmount = receiptItems.reduce((acc, item) => {
        if (item.assignedTo === null) return acc + item.total / 2;
        if (item.assignedTo === userId) return acc + item.total;
        return acc;
    }, 0);
    const itemSplitPartnerAmount = receiptItems.reduce((acc, item) => {
        if (item.assignedTo === null) return acc + item.total / 2;
        if (item.assignedTo === partner?.id) return acc + item.total;
        return acc;
    }, 0);
    // Receipt item assignments (2-member only) override the split, as before.
    const hasItemAssignments = isTwoMember && receiptItems.some((i) => i.assignedTo !== null);
    const splitResult = computeSplit(splitValue, members, amountCentsLive);

    // Sync amount from items
    useEffect(() => {
        if (receiptItems.length > 0) {
            const total = receiptItems.reduce((sum, item) => sum + item.total, 0);
            setAmount(total.toFixed(2));
        }
    }, [receiptItems]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setReceiptFile(file);
        setReceiptPreview(URL.createObjectURL(file));
        await runOCR(file);
    };

    const runOCR = async (file: File) => {
        setIsOcrRunning(true);
        setOcrProgress(10);
        try {
            const formData = new FormData();
            formData.append("image", file);
            setOcrProgress(30);
            const response = await fetch("/api/ocr", { method: "POST", body: formData });
            setOcrProgress(80);
            const data = await response.json();
            if (data.success) {
                if (data.total) setAmount(data.total.toFixed(2));
                if (data.store) setDescription(data.store);
                // Only accept an OCR category that exists in this context's effective set.
                if (data.category && effectiveKeys.has(data.category)) setCategory(data.category);
                if (data.items && data.items.length > 0) setReceiptItems(data.items.map((item: ReceiptItem) => withUid(item)));
            } else {
                alert("No se pudo procesar el ticket. Intenta con otra foto.");
            }
            setOcrProgress(100);
        } catch {
            alert("Error al procesar la imagen");
        } finally {
            setIsOcrRunning(false);
        }
    };

    const addItem = () => {
        setReceiptItems([...receiptItems, withUid({ description: "", quantity: 1, price: 0, total: 0, assignedTo: null })]);
    };

    const updateItem = (index: number, field: keyof ReceiptItem, value: string | number | null) => {
        const newItems = [...receiptItems];
        const item = { ...newItems[index], [field]: value };
        if (field === "quantity" || field === "price") {
            item.total = Number((item.quantity * item.price).toFixed(2));
        }
        newItems[index] = item;
        setReceiptItems(newItems);
    };

    const removeItem = (index: number) => {
        setReceiptItems(receiptItems.filter((_, i) => i !== index));
    };

    const setItemAssignment = (index: number, value: string | null) => {
        const newItems = [...receiptItems];
        newItems[index] = { ...newItems[index], assignedTo: value };
        setReceiptItems(newItems);
    };

    const toggleTag = (tagId: string) => {
        setSelectedTagIds((prev) =>
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        );
    };

    const handleCreateTag = async () => {
        if (!newTagName.trim()) return;
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
            });
            const data = await res.json();
            if (data.tag) {
                setTags((prev) => [...prev, data.tag]);
                setSelectedTagIds((prev) => [...prev, data.tag.id]);
                setNewTagName("");
                setNewTagColor(TAG_PRESET_COLORS[0]);
                setShowNewTagForm(false);
            }
        } catch {
            console.error("Failed to create tag");
        }
    };

    const syncTags = async () => {
        const toAdd = selectedTagIds.filter((id) => !initialTagIds.includes(id));
        const toRemove = initialTagIds.filter((id) => !selectedTagIds.includes(id));
        await Promise.all([
            ...toAdd.map((tagId) =>
                fetch(`/api/expenses/${expenseId}/tags`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tagId }),
                })
            ),
            ...toRemove.map((tagId) =>
                fetch(`/api/expenses/${expenseId}/tags`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tagId }),
                })
            ),
        ]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isPersonal && !hasItemAssignments && !splitResult.valid) {
            alert(splitResult.reason || "Revisa el reparto del gasto");
            return;
        }

        setLoading(true);
        try {
            // Upload receipt if changed
            let uploadedUrl = receiptUrl;
            if (receiptFile && !uploadedUrl) {
                const formData = new FormData();
                formData.append("file", receiptFile);
                const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
                const uploadData = await uploadRes.json();
                if (uploadData.success) uploadedUrl = uploadData.url;
            }

            const amountCents = Math.round(amountNum * 100);

            const bodyPayload: Record<string, unknown> = {
                description,
                amount: amountNum,
                category,
                receiptItems: receiptItems.length > 0
                    ? receiptItems.map(({ description, quantity, price, total, assignedTo }) => ({
                        description, quantity, price, total, assignedTo,
                    }))
                    : undefined,
                notes: notes.trim() || null,
                // Persist the receipt image: the resolved URL (a freshly-uploaded one,
                // the existing one, or null when the user removed it via the ✕).
                receiptUrl: uploadedUrl,
                isRecurring,
                recurringInterval: isRecurring ? recurringInterval : undefined,
            };

            // Payer change (N-way): shared expenses carry an editable payer.
            if (!isPersonal) {
                bodyPayload.paidById = paidById;

                if (hasItemAssignments && partner) {
                    // Receipt item assignments (2-member) override the split.
                    const myCents = Math.round(itemSplitMyAmount * 100);
                    bodyPayload.customSplits = [
                        { userId, amount: myCents },
                        { userId: partner.id, amount: amountCents - myCents },
                    ];
                } else {
                    // N-way split from the SplitEditor. Always send explicit
                    // customSplits (from splitResult.shares) so no group ever
                    // collapses — the PATCH persists these exact per-member cents.
                    bodyPayload.customSplits = members.map((m) => ({
                        userId: m.id,
                        amount: splitResult.shares[m.id] ?? 0,
                    }));
                }
            }

            const res = await fetch(`/api/expenses/${expenseId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload),
            });

            if (res.ok) {
                await syncTags();
                router.push(`/expense/${expenseId}`);
                router.refresh();
            } else {
                alert("Error al guardar los cambios");
            }
        } catch (err) {
            console.error(err);
            alert("Error de conexión");
        } finally {
            setLoading(false);
        }
    };

    const recurringIntervalLabel: Record<RecurringInterval, string> = {
        weekly: "semana",
        monthly: "mes",
        yearly: "año",
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href={`/expense/${expenseId}`}>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-secondary">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold text-foreground">Editar Gasto</h1>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 space-y-8 mt-4">

                {/* 1. Receipt preview / re-scan */}
                <div className="space-y-4">
                    {!receiptPreview ? (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full aspect-video rounded-2xl border-2 border-dashed border-[color:var(--line-strong)] bg-card flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-secondary transition-all group"
                        >
                            <div className="h-12 w-12 rounded-full bg-[var(--accent-tint)] flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Camera className="h-6 w-6 text-primary" />
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-sm text-foreground">Añadir / Re-escanear Ticket</p>
                                <p className="text-xs text-muted-foreground">El OCR actualizará el desglose automáticamente</p>
                            </div>
                        </button>
                    ) : (
                        <div className="relative rounded-2xl overflow-hidden border border-[color:var(--line)] aspect-video bg-secondary">
                            {/* oxlint-disable-next-line nextjs/no-img-element -- user-uploaded receipt image of unknown dimensions; next/image would change layout/runtime */}
                            <img src={receiptPreview} alt="Ticket" className="w-full h-full object-contain" />
                            <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute top-2 right-2 h-8 w-8 rounded-full"
                                onClick={() => {
                                    setReceiptFile(null);
                                    setReceiptPreview(null);
                                    setReceiptUrl(null);
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                                }}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                            {isOcrRunning && (
                                <div className="absolute inset-0 bg-[color:var(--ink)]/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
                                    <Loader2 className="h-10 w-10 text-white animate-spin" />
                                    <div className="text-center">
                                        <p className="font-bold text-white">Leyendo ticket...</p>
                                        <p className="text-xs font-mono text-white/80">{ocrProgress}%</p>
                                    </div>
                                    <div className="w-48 h-1 bg-white/20 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${ocrProgress}%` }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                </div>

                {/* 2. Category */}
                <div className="space-y-4">
                    <span className="block text-sm font-medium ml-1 text-foreground">Categoría</span>
                    <CategoryPicker
                        context={categoryContext}
                        value={category}
                        onChange={setCategory}
                        forcedCurrent={initialCategoryMeta}
                        onLoaded={handleCategoriesLoaded}
                    />
                </div>

                {/* 3. Amount */}
                <div className="space-y-2 text-center py-2">
                    <label htmlFor="expense-amount" className="text-[11px] text-muted-foreground uppercase tracking-[0.08em] font-bold">Importe</label>
                    <div className="relative inline-block w-full max-w-[200px]">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-mono font-semibold text-muted-foreground">€</span>
                        <input
                            id="expense-amount"
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-center text-5xl font-mono font-semibold tracking-[-0.02em] text-foreground focus:outline-none placeholder:text-[color:var(--ink-3)] p-2 appearance-none"
                            required
                            step="0.01"
                        />
                    </div>
                </div>

                {/* 4. Description */}
                <div className="space-y-2">
                    <label htmlFor="expense-description" className="text-sm font-medium ml-1 text-foreground">Concepto</label>
                    <Input
                        id="expense-description"
                        placeholder="Ej: Compra Mercadona"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required
                    />
                </div>

                {/* 5. Items breakdown */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold ml-1 flex items-center gap-2 text-foreground">
                            <Calculator className="h-4 w-4 text-primary" />
                            Desglose de Ticket
                        </h3>
                        <Button type="button" variant="secondary" size="sm" onClick={addItem} className="h-7">
                            <Plus className="h-3 w-3 mr-1" /> Item
                        </Button>
                    </div>

                    <div className="rounded-xl border border-[color:var(--line)] overflow-hidden bg-card">
                        {receiptItems.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                                Añade items manualmente o re-escanea el ticket
                            </div>
                        ) : (
                            <div className="divide-y divide-[color:var(--line-2)]">
                                {receiptItems.map((item, idx) => (
                                    <div
                                        key={item._uid}
                                        className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 items-center hover:bg-secondary transition-colors"
                                    >
                                        <input
                                            className="bg-transparent text-sm w-full focus:outline-none font-medium min-w-0 px-1 text-foreground placeholder:text-[color:var(--ink-3)]"
                                            value={item.description}
                                            onChange={(e) => updateItem(idx, "description", e.target.value)}
                                            placeholder="Producto..."
                                        />
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <input
                                                type="number"
                                                className="bg-transparent text-[10px] w-6 text-right focus:outline-none font-mono text-muted-foreground"
                                                value={item.quantity}
                                                onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                                            />
                                            <span className="text-[10px] text-muted-foreground">x</span>
                                            <input
                                                type="number"
                                                className="bg-transparent text-[10px] w-10 text-right focus:outline-none font-mono text-muted-foreground"
                                                value={item.price}
                                                onChange={(e) => updateItem(idx, "price", parseFloat(e.target.value) || 0)}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div className="font-mono font-semibold tracking-[-0.02em] text-[11px] w-14 text-right flex-shrink-0 text-foreground">
                                            {item.total.toFixed(2)}
                                        </div>
                                        {isTwoMember && partner && (
                                            <div className="flex items-center flex-shrink-0 rounded-lg overflow-hidden border border-[color:var(--line)] text-[9px] font-bold">
                                                <button type="button" onClick={() => setItemAssignment(idx, null)}
                                                    className={cn("px-1.5 py-1 transition-colors", item.assignedTo === null ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary")}
                                                    title="Compartido (50/50)">½</button>
                                                <button type="button" onClick={() => setItemAssignment(idx, userId)}
                                                    className={cn("px-1.5 py-1 border-l border-[color:var(--line)] transition-colors", item.assignedTo === userId ? "bg-[var(--accent-tint)] text-primary" : "text-muted-foreground hover:bg-secondary")}
                                                    title="Solo mío">Yo</button>
                                                <button type="button" onClick={() => setItemAssignment(idx, partner.id)}
                                                    className={cn("px-1.5 py-1 border-l border-[color:var(--line)] transition-colors", item.assignedTo === partner.id ? "bg-[var(--positive-tint)] text-[color:var(--positive)]" : "text-muted-foreground hover:bg-secondary")}
                                                    title={`Solo ${partner.name}`}>{partner.name.charAt(0).toUpperCase()}</button>
                                            </div>
                                        )}
                                        <button type="button" onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive p-1 flex-shrink-0">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {receiptItems.length > 0 && hasItemAssignments && (
                        <div className="text-xs px-2 py-2 bg-secondary rounded-lg space-y-1">
                            <div className="flex justify-between font-semibold">
                                <span className="text-primary">Tu parte:</span>
                                <span className="text-primary font-mono">{formatEuros(itemSplitMyAmount)}</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-[color:var(--positive)]">{partner?.name ?? "Pareja"}:</span>
                                <span className="text-[color:var(--positive)] font-mono">{formatEuros(itemSplitPartnerAmount)}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* 5b. Payer — only for shared expenses (N-way) */}
                {!isPersonal && members.length > 0 && (
                    <div className="space-y-2">
                        <span className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">¿Quién pagó?</span>
                        <div className="flex flex-wrap gap-2">
                            {members.map((m) => {
                                const sel = paidById === m.id;
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setPaidById(m.id)}
                                        aria-pressed={sel}
                                        className={cn(
                                            "px-3 py-2 rounded-xl text-sm font-medium border transition-all active:scale-[0.98]",
                                            sel ? "bg-primary text-white border-primary shadow" : "bg-card border-[color:var(--line)] text-muted-foreground hover:bg-secondary"
                                        )}
                                    >
                                        {m.id === userId ? "Yo" : m.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 6. Split — only for shared expenses; the shared N-way SplitEditor.
                    Hidden when 2-member receipt item assignments take over the split. */}
                {isPersonal ? (
                    <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-card border border-[color:var(--line)] text-sm text-muted-foreground">
                        <User className="h-4 w-4 text-primary" />
                        Gasto personal — privado, sin reparto
                    </div>
                ) : hasItemAssignments ? (
                    <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-card border border-[color:var(--line)] text-sm text-muted-foreground">
                        <Heart className="h-4 w-4 text-primary" />
                        El reparto lo definen los productos asignados arriba
                    </div>
                ) : (
                    <SplitEditor
                        members={members.map((m) => ({ id: m.id, name: m.name }))}
                        currentUserId={userId}
                        totalCents={amountCentsLive}
                        value={splitValue}
                        onChange={setSplitValue}
                        isCouple={spaceType === "COUPLE"}
                    />
                )}

                {/* 7. Notes */}
                <div className="space-y-2">
                    <label htmlFor="expense-notes" className="text-sm font-medium ml-1 flex items-center gap-2 text-foreground">
                        <FileText className="h-4 w-4 text-primary" />
                        Notas
                        <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                    </label>
                    <div className="relative">
                        <textarea
                            id="expense-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                            placeholder="Añade una nota opcional..."
                            rows={3}
                            className="w-full bg-card border border-[color:var(--line)] rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-[color:var(--accent-border)] resize-none placeholder:text-[color:var(--ink-3)] transition-colors"
                        />
                        <span className={cn("absolute bottom-2 right-3 text-[10px] font-mono", notes.length >= 480 ? "text-primary" : "text-[color:var(--ink-3)]")}>
                            {notes.length}/500
                        </span>
                    </div>
                </div>

                {/* 8. Tags */}
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setTagsExpanded((p) => !p)}
                        className="w-full flex items-center justify-between text-sm font-medium p-3 rounded-xl bg-card border border-[color:var(--line)] text-foreground hover:bg-secondary transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-primary" />
                            Etiquetas
                            {selectedTagIds.length > 0 && (
                                <span className="text-xs bg-[var(--accent-tint)] text-primary px-1.5 py-0.5 rounded-full font-bold font-mono">{selectedTagIds.length}</span>
                            )}
                        </span>
                        {tagsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>

                    {tagsExpanded && (
                        <div className="space-y-3 animate-in fade-in duration-200 bg-secondary rounded-xl p-4">
                            {tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {tags.map((tag) => {
                                        const isSelected = selectedTagIds.includes(tag.id);
                                        return (
                                            <button
                                                key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                                                className={cn("px-3 py-1 rounded-full text-xs font-semibold border transition-all", isSelected ? "border-transparent text-white scale-105" : "border-[color:var(--line)] text-muted-foreground bg-card hover:bg-secondary")}
                                                style={isSelected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
                                            >{tag.name}</button>
                                        );
                                    })}
                                </div>
                            )}
                            {!showNewTagForm ? (
                                <button type="button" onClick={() => setShowNewTagForm(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                    <Plus className="h-3.5 w-3.5" /> Nueva etiqueta
                                </button>
                            ) : (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    <input
                                        type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                                        placeholder="Nombre de la etiqueta"
                                        className="w-full bg-card border border-[color:var(--line)] rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[color:var(--accent-border)] placeholder:text-[color:var(--ink-3)]"
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); } }}
                                    />
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {TAG_PRESET_COLORS.map((color) => (
                                            <button key={color} type="button" onClick={() => setNewTagColor(color)}
                                                aria-label={`Color ${color}`}
                                                className={cn("h-6 w-6 rounded-full border-2 transition-transform", newTagColor === color ? "border-foreground scale-110" : "border-transparent")}
                                                style={{ backgroundColor: color }} />
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button type="button" size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()} className="h-7 text-xs">
                                            <Check className="h-3 w-3 mr-1" /> Crear
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewTagForm(false); setNewTagName(""); }} className="h-7 text-xs">
                                            Cancelar
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 9. Recurring */}
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setRecurringExpanded((p) => !p)}
                        className="w-full flex items-center justify-between text-sm font-medium p-3 rounded-xl bg-card border border-[color:var(--line)] text-foreground hover:bg-secondary transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 text-primary" />
                            Recurrente
                            {isRecurring && (
                                <span className="text-xs bg-[var(--accent-tint)] text-primary px-1.5 py-0.5 rounded-full font-bold capitalize">
                                    {{ weekly: "Semanal", monthly: "Mensual", yearly: "Anual" }[recurringInterval]}
                                </span>
                            )}
                        </span>
                        {recurringExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>

                    {recurringExpanded && (
                        <div className="space-y-4 animate-in fade-in duration-200 bg-secondary rounded-xl p-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-foreground">¿Es un gasto recurrente?</span>
                                <button
                                    type="button"
                                    onClick={() => setIsRecurring((p) => !p)}
                                    role="switch"
                                    aria-checked={isRecurring}
                                    aria-label="Activar gasto recurrente"
                                    className={cn("relative h-6 w-11 rounded-full transition-colors", isRecurring ? "bg-primary" : "bg-[color:var(--ink-3)]")}
                                >
                                    <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", isRecurring && "translate-x-5")} />
                                </button>
                            </div>
                            {isRecurring && (
                                <div className="grid grid-cols-3 gap-2 animate-in fade-in duration-200">
                                    {(["weekly", "monthly", "yearly"] as RecurringInterval[]).map((interval) => {
                                        const labels = { weekly: "Semanal", monthly: "Mensual", yearly: "Anual" };
                                        const icons = { weekly: "📅", monthly: "🗓️", yearly: "🔄" };
                                        return (
                                            <button
                                                key={interval} type="button" onClick={() => setRecurringInterval(interval)}
                                                className={cn("py-3 rounded-xl border text-center transition-all text-sm font-medium",
                                                    recurringInterval === interval ? "bg-[var(--accent-tint)] border-[color:var(--accent-border)] text-primary" : "border-[color:var(--line)] bg-card text-muted-foreground hover:bg-secondary")}
                                            >
                                                <span className="block text-lg mb-1">{icons[interval]}</span>
                                                {labels[interval]}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {isRecurring && (
                                <p className="text-xs text-muted-foreground text-center">
                                    Se creará automáticamente cada {recurringIntervalLabel[recurringInterval]}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="pt-4">
                    <Button
                        type="submit"
                        size="lg"
                        className="w-full text-base h-16 shadow-[0_12px_28px_-8px_rgba(189,93,58,0.35)] font-bold"
                        isLoading={loading}
                    >
                        Guardar Cambios <Check className="ml-2 h-5 w-5" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
