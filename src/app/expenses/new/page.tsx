"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ArrowLeft, Check, Camera, Loader2, X, Plus, Trash2, Calculator, FileText,
    Tag, RefreshCw, ChevronDown, ChevronUp, AlertCircle, RotateCw, Delete, SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReceiptItem } from "@/types";
import { getAllCategories } from "@/lib/categories";
import { formatEuros } from "@/lib/currency";

type Step = "amount" | "details";
type ScanState = "idle" | "scanning" | "done";
type SplitChoice = "equal" | "me" | "partner" | "custom";
type PaidBy = "me" | "partner";
type RecurringInterval = "weekly" | "monthly" | "yearly";

// ReceiptItem with a stable client-side id used as the React key for editable rows
type EditableReceiptItem = ReceiptItem & { _uid: string };

let receiptItemUidCounter = 0;
const nextReceiptItemUid = () => `item-${++receiptItemUidCounter}`;
const withUid = (item: ReceiptItem): EditableReceiptItem => ({ ...item, _uid: nextReceiptItemUid() });

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface PendingOcr {
    total: number | null;
    store: string | null;
    category: string | null;
    items: ReceiptItem[];
}

const VALID_CATEGORY_IDS = new Set([
    "shopping", "food", "rent", "utilities", "transport", "entertainment", "health", "other",
]);

const TAG_PRESET_COLORS = [
    "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
    "#3b82f6", "#ef4444", "#06b6d4", "#84cc16",
];

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];

export default function NewExpensePage() {
    const router = useRouter();

    // Flow
    const [step, setStep] = useState<Step>("amount");

    // Core fields
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("food");
    const [categoryAutoDetected, setCategoryAutoDetected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    // Split / payer
    const [paidBy, setPaidBy] = useState<PaidBy>("me");
    const [split, setSplit] = useState<SplitChoice>("equal");
    const [myPercent, setMyPercent] = useState(50);
    const [members, setMembers] = useState<{ id: string; name: string; avatar: string | null }[]>([]);
    const [userId, setUserId] = useState<string | null>(null);

    // Advanced
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [notes, setNotes] = useState("");
    const [tags, setTags] = useState<Tag[]>([]);
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
    const [showNewTagForm, setShowNewTagForm] = useState(false);
    const [newTagName, setNewTagName] = useState("");
    const [newTagColor, setNewTagColor] = useState(TAG_PRESET_COLORS[0]);
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurringInterval, setRecurringInterval] = useState<RecurringInterval>("monthly");

    // Receipt / OCR
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
    const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
    const [receiptItems, setReceiptItems] = useState<EditableReceiptItem[]>([]);
    const [scanState, setScanState] = useState<ScanState>("idle");
    const [ocrProgress, setOcrProgress] = useState(0);
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [pendingOcr, setPendingOcr] = useState<PendingOcr | null>(null);

    const partner = members.find((m) => m.id !== userId);
    const partnerName = partner?.name || "pareja";
    const partnerPercent = 100 - myPercent;

    // es-ES users type the decimal separator as a comma; normalise before parsing
    const amountNum = parseFloat(amount.replace(",", ".")) || 0;
    const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= 999999.99;
    const previewAmountCents = Math.round(amountNum * 100);
    const previewMyCents = Math.round((previewAmountCents * myPercent) / 100);
    const myAmount = previewMyCents / 100;
    const partnerAmount = (previewAmountCents - previewMyCents) / 100;

    const hasItemAssignments = receiptItems.length > 0;
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

    useEffect(() => {
        fetch("/api/couple")
            .then((res) => res.json())
            .then((data) => {
                if (data.couple) setMembers(data.couple.members);
                if (data.userId) setUserId(data.userId);
            })
            .catch((err) => console.error("Failed to fetch couple", err));
    }, []);

    useEffect(() => {
        fetch("/api/tags")
            .then((res) => res.json())
            .then((data) => {
                if (data.tags) setTags(data.tags);
            })
            .catch((err) => console.error("Failed to fetch tags", err));
    }, []);

    // Receipt items are the source of truth for the total once present
    const syncAmountFromItems = (items: EditableReceiptItem[]) => {
        if (items.length > 0) {
            const total = items.reduce((sum, item) => sum + item.total, 0);
            setAmount(total.toFixed(2).replace(".", ","));
        }
    };

    // ---------- Amount keypad ----------
    const pressKey = (d: string) => {
        if (formError) setFormError(null);
        setAmount((prev) => {
            const v = prev.replace(".", ",");
            if (d === "⌫") return v.slice(0, -1);
            if (d === ",") {
                if (v.includes(",")) return v;
                return (v === "" ? "0" : v) + ",";
            }
            if (v.includes(",")) {
                const dec = v.split(",")[1] || "";
                if (dec.length >= 2) return v;
            }
            if (v === "0") return d;
            if (v.length >= 9 && !v.includes(",")) return v;
            return v + d;
        });
    };

    const goToDetails = () => {
        if (!amountValid) {
            setFormError("Introduce un importe válido mayor que 0.");
            return;
        }
        setFormError(null);
        setStep("details");
    };

    // ---------- OCR ----------
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setReceiptFile(file);
        setReceiptPreview(URL.createObjectURL(file));
        await runOCR(file);
    };

    const runOCR = async (file: File) => {
        setScanState("scanning");
        setOcrError(null);
        setPendingOcr(null);
        setOcrProgress(15);
        try {
            const formData = new FormData();
            formData.append("image", file);
            setOcrProgress(35);
            const response = await fetch("/api/ocr", { method: "POST", body: formData });
            setOcrProgress(80);
            if (!response.ok) {
                setOcrError("No se pudo leer el ticket. Puedes reintentar o rellenarlo a mano.");
                setScanState("idle");
                return;
            }
            const data = await response.json();
            if (data.success) {
                setOcrProgress(100);
                setPendingOcr({
                    total: typeof data.total === "number" ? data.total : null,
                    store: data.store || null,
                    category: data.category && VALID_CATEGORY_IDS.has(data.category) ? data.category : null,
                    items: Array.isArray(data.items) ? data.items : [],
                });
                setScanState("done");
            } else {
                console.error("OCR Error:", data.error);
                setOcrError("No se reconoció el ticket. Prueba otra foto o rellénalo a mano.");
                setScanState("idle");
            }
        } catch (err) {
            console.error("OCR Error:", err);
            setOcrError("Error al procesar la imagen. Comprueba tu conexión y reintenta.");
            setScanState("idle");
        }
    };

    const applyScan = () => {
        if (!pendingOcr) return;
        if (pendingOcr.total != null) setAmount(pendingOcr.total.toFixed(2).replace(".", ","));
        if (pendingOcr.store) setDescription((prev) => (prev === "" ? pendingOcr.store! : prev));
        if (pendingOcr.category) {
            setCategory(pendingOcr.category);
            setCategoryAutoDetected(true);
        }
        if (pendingOcr.items.length > 0) {
            const newItems = pendingOcr.items.map((item) => withUid(item));
            setReceiptItems(newItems);
            syncAmountFromItems(newItems);
            setAdvancedOpen(true);
        }
        setPendingOcr(null);
        setScanState("idle");
        setStep("details");
    };

    const discardScan = () => {
        setScanState("idle");
        setPendingOcr(null);
        setReceiptFile(null);
        setReceiptPreview(null);
        setReceiptUrl(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    // ---------- Items ----------
    const addItem = () => {
        const newItems = [...receiptItems, withUid({ description: "", quantity: 1, price: 0, total: 0, assignedTo: null })];
        setReceiptItems(newItems);
        syncAmountFromItems(newItems);
    };

    const updateItem = (index: number, field: keyof ReceiptItem, value: string | number | null) => {
        const newItems = [...receiptItems];
        const item = { ...newItems[index], [field]: value };
        if (field === "quantity" || field === "price") {
            item.quantity = Math.max(0, item.quantity || 0);
            item.price = Math.max(0, item.price || 0);
            item.total = Number((item.quantity * item.price).toFixed(2));
        }
        newItems[index] = item;
        setReceiptItems(newItems);
        syncAmountFromItems(newItems);
    };

    const removeItem = (index: number) => {
        const newItems = receiptItems.filter((_, i) => i !== index);
        setReceiptItems(newItems);
        syncAmountFromItems(newItems);
    };
    const setItemAssignment = (index: number, value: string | null) => {
        const newItems = [...receiptItems];
        newItems[index] = { ...newItems[index], assignedTo: value };
        setReceiptItems(newItems);
    };

    // ---------- Tags ----------
    const toggleTag = (tagId: string) =>
        setSelectedTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));

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
        } catch (err) {
            console.error("Failed to create tag", err);
        }
    };

    const applyTagsToExpense = async (expenseId: string) => {
        const results = await Promise.allSettled(
            selectedTagIds.map((tagId) =>
                fetch(`/api/expenses/${expenseId}/tags`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ tagId }),
                }).then((r) => {
                    if (!r.ok) throw new Error(`tag ${tagId} failed`);
                })
            )
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) console.warn(`${failed} etiqueta(s) no se pudieron aplicar`);
    };

    // ---------- Submit ----------
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);

        if (!amountValid) {
            setFormError("Introduce un importe válido mayor que 0.");
            setStep("amount");
            return;
        }
        if (!description.trim()) {
            setFormError("Añade un concepto para el gasto.");
            return;
        }
        if (split === "custom" && myPercent + partnerPercent !== 100) {
            setFormError("Los porcentajes deben sumar 100%.");
            return;
        }
        const needsPartner = split === "partner" || paidBy === "partner";
        if (needsPartner && !partner) {
            setFormError("Necesitas una pareja configurada para esta opción.");
            return;
        }

        setLoading(true);
        try {
            let uploadedUrl = receiptUrl;
            if (receiptFile && !uploadedUrl) {
                const formData = new FormData();
                formData.append("file", receiptFile);
                const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
                const uploadData = uploadRes.ok ? await uploadRes.json() : null;
                if (uploadData?.success) {
                    uploadedUrl = uploadData.url;
                    setReceiptUrl(uploadedUrl);
                } else {
                    setFormError("No se pudo subir el ticket. Inténtalo de nuevo.");
                    setLoading(false);
                    return;
                }
            }

            const amountCents = Math.round(amountNum * 100);
            const bodyPayload: Record<string, unknown> = {
                amount: amountNum,
                description,
                category,
                paidById: paidBy === "me" ? userId : partner?.id,
                receiptUrl: uploadedUrl,
                receiptData: receiptItems.length > 0
                    ? receiptItems.map(({ description, quantity, price, total, assignedTo }) => ({
                        description, quantity, price, total, assignedTo,
                    }))
                    : undefined,
                notes: notes.trim() || undefined,
                isRecurring,
                recurringInterval: isRecurring ? recurringInterval : undefined,
            };

            if (hasItemAssignments && userId && partner) {
                const myCents = Math.round(itemSplitMyAmount * 100);
                bodyPayload.customSplits = [
                    { userId, amount: myCents },
                    { userId: partner.id, amount: amountCents - myCents },
                ];
            } else if (split === "custom" && userId && partner) {
                const myCents = Math.round((amountCents * myPercent) / 100);
                bodyPayload.customSplits = [
                    { userId, amount: myCents },
                    { userId: partner.id, amount: amountCents - myCents },
                ];
            } else if (split === "me" && userId) {
                bodyPayload.beneficiaryId = userId;
            } else if (split === "partner" && partner) {
                bodyPayload.beneficiaryId = partner.id;
            }
            // split === "equal" → no beneficiary/customSplits → API splits equally

            const res = await fetch("/api/expenses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(bodyPayload),
            });

            if (res.ok) {
                const data = await res.json();
                if (selectedTagIds.length > 0 && data.expenseId) {
                    await applyTagsToExpense(data.expenseId);
                }
                router.push("/dashboard");
                router.refresh();
            } else {
                const errData = await res.json().catch(() => null);
                setFormError(errData?.error || "No se pudo guardar el gasto. Inténtalo de nuevo.");
                setLoading(false);
            }
        } catch (err) {
            console.error(err);
            setFormError("Error de conexión. Comprueba tu red e inténtalo de nuevo.");
            setLoading(false);
        }
    };

    const recurringIntervalLabel: Record<RecurringInterval, string> = {
        weekly: "semana", monthly: "mes", yearly: "año",
    };

    const amountDisplay = amount === "" ? "0" : amount;

    const splitOptions: { key: SplitChoice; label: string; hint: string }[] = [
        { key: "equal", label: "Mitad y mitad", hint: "50% · 50%" },
        { key: "me", label: "Pagué por mí", hint: "100% Yo" },
        { key: "partner", label: `Favor para ${partnerName}`, hint: `100% ${partnerName}` },
        { key: "custom", label: "Personalizado", hint: "Ajustar %" },
    ];

    return (
        <div className="flex flex-col min-h-screen max-w-md mx-auto relative">
            {/* Hidden file input shared by the scan flow */}
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
            />

            <header className="flex items-center justify-between px-4 pt-3 pb-1">
                {step === "amount" ? (
                    <Link href="/dashboard" aria-label="Volver al inicio">
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                            <X className="h-5 w-5" />
                        </Button>
                    </Link>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Volver al importe"
                        className="h-10 w-10 rounded-full hover:bg-white/10"
                        onClick={() => setStep("amount")}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                )}
                <h1 className="text-base font-semibold">Nuevo gasto</h1>
                <div className="w-10" />
            </header>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col px-4">
                {/* ============ STEP 1: AMOUNT ============ */}
                {step === "amount" && (
                    <div className="flex-1 flex flex-col animate-in fade-in duration-200">
                        <div className="flex-1 flex flex-col items-center justify-center py-6">
                            <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                                ¿Cuánto ha sido?
                            </span>
                            <div className="relative mt-3 flex items-baseline justify-center">
                                <input
                                    id="amount"
                                    data-testid="expense-amount"
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    value={amount}
                                    onChange={(e) => {
                                        const sanitized = e.target.value.replace(/[^0-9.,]/g, "");
                                        setAmount(sanitized);
                                        if (formError) setFormError(null);
                                    }}
                                    placeholder="0"
                                    aria-label="Importe en euros"
                                    className={cn(
                                        "w-full max-w-[260px] bg-transparent text-center font-mono text-6xl font-bold tracking-tight focus:outline-none p-0",
                                        amountValid ? "text-foreground" : "text-muted-foreground/40 placeholder:text-muted-foreground/40"
                                    )}
                                />
                                <span className="font-mono text-3xl font-bold text-muted-foreground ml-1">€</span>
                            </div>

                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:border-white/20 hover:text-foreground transition-colors active:scale-95"
                            >
                                <Camera className="h-4 w-4" />
                                Escanear recibo
                            </button>

                            {ocrError && (
                                <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-300 animate-in fade-in">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    <span className="flex-1">{ocrError}</span>
                                    {receiptFile && (
                                        <Button type="button" variant="secondary" size="sm" className="h-7 text-xs flex-shrink-0" onClick={() => runOCR(receiptFile)}>
                                            <RotateCw className="h-3 w-3 mr-1" /> Reintentar
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Numeric keypad */}
                        <div className="grid grid-cols-3 gap-2.5 mb-3">
                            {KEYPAD.map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    aria-label={k === "⌫" ? "Borrar" : k === "," ? "Coma decimal" : k}
                                    onClick={() => pressKey(k)}
                                    className="h-[60px] rounded-2xl bg-white/5 border border-white/5 font-mono text-2xl font-medium flex items-center justify-center transition-all active:scale-95 active:bg-white/10 [@media(hover:hover)]:hover:bg-white/[0.08]"
                                >
                                    {k === "⌫" ? <Delete className="h-6 w-6" /> : k}
                                </button>
                            ))}
                        </div>

                        {formError && (
                            <div role="alert" className="mb-3 flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-sm text-red-300 animate-in fade-in">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                <span>{formError}</span>
                            </div>
                        )}

                        <Button
                            type="button"
                            data-testid="expense-next"
                            size="lg"
                            disabled={!amountValid}
                            onClick={goToDetails}
                            className="w-full h-14 text-base font-bold mb-5"
                        >
                            Siguiente
                        </Button>
                    </div>
                )}

                {/* ============ STEP 2: DETAILS ============ */}
                {step === "details" && (
                    <div className="flex-1 flex flex-col gap-5 pt-1 animate-in fade-in duration-200">
                        {/* Editable amount summary */}
                        <button
                            type="button"
                            onClick={() => setStep("amount")}
                            className="self-center flex flex-col items-center gap-0.5 px-4 py-1.5 active:scale-95 transition-transform"
                        >
                            <span className="font-mono text-4xl font-bold">{amountDisplay} €</span>
                            <span className="text-[10px] font-medium tracking-wide uppercase text-muted-foreground/70">Toca para editar</span>
                        </button>

                        {/* Description */}
                        <div className="space-y-2">
                            <label htmlFor="description" className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">Concepto</label>
                            <Input
                                id="description"
                                data-testid="expense-description"
                                placeholder="p. ej. Cena del viernes"
                                value={description}
                                onChange={(e) => { setDescription(e.target.value); if (formError) setFormError(null); }}
                                required
                            />
                        </div>

                        {/* Category */}
                        <div className="space-y-2">
                            <label className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
                                Categoría
                                {categoryAutoDetected && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/20 text-primary normal-case tracking-normal">✨ Auto</span>
                                )}
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                                {getAllCategories().map((cat) => (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => { setCategory(cat.id); setCategoryAutoDetected(false); }}
                                        aria-pressed={category === cat.id}
                                        className={cn(
                                            "flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-all active:scale-95",
                                            category === cat.id ? "bg-primary/10 border-primary" : "bg-white/5 border-white/5 hover:bg-white/10"
                                        )}
                                    >
                                        <span className="text-xl">{cat.emoji}</span>
                                        <span className="text-[10px] font-medium text-muted-foreground">{cat.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Who paid */}
                        <fieldset className="space-y-2 border-0 p-0 m-0">
                            <legend className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground p-0">¿Quién pagó?</legend>
                            <div className="flex gap-1.5 p-1 rounded-xl bg-white/5 border border-white/5">
                                {([["me", "Yo"], ["partner", partnerName]] as const).map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        disabled={key === "partner" && !partner}
                                        onClick={() => setPaidBy(key)}
                                        aria-pressed={paidBy === key}
                                        className={cn(
                                            "flex-1 h-11 rounded-lg text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40",
                                            paidBy === key ? "bg-primary text-white shadow" : "text-muted-foreground"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>

                        {/* How to split */}
                        <fieldset className="space-y-2 border-0 p-0 m-0">
                            <legend className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground p-0">¿Cómo se divide?</legend>
                            <div className="flex flex-col gap-2">
                                {splitOptions.map((o) => {
                                    const sel = split === o.key;
                                    const disabled = (o.key === "partner" || o.key === "custom") && !partner;
                                    return (
                                        <button
                                            key={o.key}
                                            type="button"
                                            disabled={disabled}
                                            onClick={() => setSplit(o.key)}
                                            aria-pressed={sel}
                                            aria-label={o.label}
                                            className={cn(
                                                "flex items-center justify-between w-full px-4 py-3 rounded-xl border transition-all active:scale-[0.99] disabled:opacity-40",
                                                sel ? "bg-primary/10 border-primary" : "bg-white/5 border-white/5 hover:bg-white/10"
                                            )}
                                        >
                                            <span className="text-left">
                                                <span className={cn("block text-sm font-semibold", sel ? "text-foreground" : "text-muted-foreground")}>{o.label}</span>
                                                <span className="block text-[11px] text-muted-foreground/70 mt-0.5">{o.hint}</span>
                                            </span>
                                            <span className={cn(
                                                "h-[18px] w-[18px] rounded-full border-2 flex-shrink-0 transition-all",
                                                sel ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--color-background)]" : "border-white/20"
                                            )} />
                                        </button>
                                    );
                                })}
                            </div>

                            {split === "custom" && partner && (
                                <div className="space-y-3 animate-in fade-in duration-200 bg-white/5 rounded-xl p-4 mt-1">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 space-y-1">
                                            <label htmlFor="my-percent" className="text-xs text-muted-foreground">Yo</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    id="my-percent"
                                                    type="number"
                                                    inputMode="numeric"
                                                    min={0}
                                                    max={100}
                                                    value={myPercent}
                                                    onChange={(e) => setMyPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                                    className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-primary/50"
                                                />
                                                <span className="text-sm text-muted-foreground">%</span>
                                            </div>
                                        </div>
                                        <div className="text-muted-foreground text-sm font-bold pt-4">/</div>
                                        <div className="flex-1 space-y-1">
                                            <label htmlFor="partner-percent" className="text-xs text-muted-foreground">{partnerName}</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    id="partner-percent"
                                                    type="number"
                                                    inputMode="numeric"
                                                    min={0}
                                                    max={100}
                                                    value={partnerPercent}
                                                    onChange={(e) => setMyPercent(100 - Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                                    className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-primary/50"
                                                />
                                                <span className="text-sm text-muted-foreground">%</span>
                                            </div>
                                        </div>
                                    </div>
                                    {amountNum > 0 && (
                                        <div className="text-xs text-center text-muted-foreground">
                                            Yo: <strong className="text-foreground">{formatEuros(myAmount)}</strong> — {partnerName}: <strong className="text-foreground">{formatEuros(partnerAmount)}</strong>
                                        </div>
                                    )}
                                </div>
                            )}
                        </fieldset>

                        {/* Advanced (collapsible): notes, tags, recurring, item breakdown */}
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => setAdvancedOpen((p) => !p)}
                                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-sm font-medium"
                            >
                                <span className="flex items-center gap-2">
                                    <SlidersHorizontal className="h-4 w-4 text-primary" />
                                    Más opciones
                                    {(selectedTagIds.length > 0 || isRecurring || notes.trim() || receiptItems.length > 0) && (
                                        <span className="h-2 w-2 rounded-full bg-primary" />
                                    )}
                                </span>
                                {advancedOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            </button>

                            {advancedOpen && (
                                <div className="space-y-5 animate-in fade-in duration-200 pt-1">
                                    {/* Item breakdown */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-bold flex items-center gap-2">
                                                <Calculator className="h-4 w-4 text-primary" /> Desglose de ticket
                                            </h3>
                                            <Button type="button" variant="secondary" size="sm" onClick={addItem} className="h-7">
                                                <Plus className="h-3 w-3 mr-1" /> Item
                                            </Button>
                                        </div>
                                        {receiptItems.length === 0 ? (
                                            <p className="text-xs text-muted-foreground px-1">Escanea un ticket o añade productos para repartir por persona.</p>
                                        ) : (
                                            <>
                                                <div className="rounded-xl border border-white/10 overflow-hidden bg-black/20 divide-y divide-white/5">
                                                    {receiptItems.map((item, idx) => (
                                                        <div key={item._uid} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 items-center">
                                                            <input
                                                                aria-label={`Descripción del producto ${idx + 1}`}
                                                                className="bg-transparent text-sm w-full focus:outline-none font-medium min-w-0 px-1"
                                                                value={item.description}
                                                                onChange={(e) => updateItem(idx, "description", e.target.value)}
                                                                placeholder="Producto..."
                                                            />
                                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                                <input
                                                                    aria-label={`Cantidad del producto ${idx + 1}`}
                                                                    type="number" inputMode="decimal" min={0}
                                                                    className="bg-transparent text-xs w-7 text-right focus:outline-none text-muted-foreground"
                                                                    value={item.quantity}
                                                                    onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                                                                />
                                                                <span className="text-xs text-muted-foreground">x</span>
                                                                <input
                                                                    aria-label={`Precio del producto ${idx + 1}`}
                                                                    type="number" inputMode="decimal" min={0}
                                                                    className="bg-transparent text-xs w-11 text-right focus:outline-none text-muted-foreground"
                                                                    value={item.price}
                                                                    onChange={(e) => updateItem(idx, "price", parseFloat(e.target.value) || 0)}
                                                                    placeholder="0.00"
                                                                />
                                                            </div>
                                                            <div className="font-mono font-bold text-xs w-14 text-right flex-shrink-0">{item.total.toFixed(2)}</div>
                                                            <div className="flex items-center flex-shrink-0 rounded-lg overflow-hidden border border-white/10 text-[11px] font-bold">
                                                                <button type="button" onClick={() => setItemAssignment(idx, null)} aria-pressed={item.assignedTo === null} aria-label="Compartido 50/50"
                                                                    className={cn("px-2.5 py-2 transition-colors", item.assignedTo === null ? "bg-primary text-white" : "text-muted-foreground hover:bg-white/10")} title="Compartido (50/50)">½</button>
                                                                <button type="button" onClick={() => setItemAssignment(idx, userId)} aria-pressed={item.assignedTo === userId} aria-label="Solo mío"
                                                                    className={cn("px-2.5 py-2 border-l border-white/10 transition-colors", item.assignedTo === userId ? "bg-blue-500/30 text-blue-300" : "text-muted-foreground hover:bg-white/10")} title="Solo mío">Yo</button>
                                                                <button type="button" onClick={() => setItemAssignment(idx, partner?.id || null)} aria-pressed={item.assignedTo === partner?.id && item.assignedTo !== null} aria-label={`Solo ${partnerName}`}
                                                                    className={cn("px-2.5 py-2 border-l border-white/10 transition-colors", item.assignedTo === partner?.id && item.assignedTo !== null ? "bg-pink-500/30 text-pink-300" : "text-muted-foreground hover:bg-white/10")} title={`Solo ${partnerName}`}>{partner?.name?.charAt(0).toUpperCase() ?? "P"}</button>
                                                            </div>
                                                            <button type="button" onClick={() => removeItem(idx)} aria-label={`Eliminar producto ${idx + 1}`} className="text-muted-foreground hover:text-red-400 p-2 flex-shrink-0">
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="text-xs px-2 py-2 bg-white/5 rounded-lg space-y-1">
                                                    <div className="flex justify-between font-semibold text-blue-300"><span>Tu parte:</span><span>{formatEuros(itemSplitMyAmount)}</span></div>
                                                    <div className="flex justify-between font-semibold text-pink-300"><span>{partnerName}:</span><span>{formatEuros(itemSplitPartnerAmount)}</span></div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Notes */}
                                    <div className="space-y-2">
                                        <label htmlFor="notes" className="text-sm font-medium flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-primary" /> Notas
                                            <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                                        </label>
                                        <div className="relative">
                                            <textarea
                                                id="notes"
                                                value={notes}
                                                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                                                placeholder="Añade una nota opcional..."
                                                rows={3}
                                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 resize-none placeholder:text-muted-foreground/50 transition-colors"
                                            />
                                            <span className={cn("absolute bottom-2 right-3 text-[10px]", notes.length >= 480 ? "text-yellow-400" : "text-muted-foreground/50")}>
                                                {notes.length}/500
                                            </span>
                                        </div>
                                    </div>

                                    {/* Tags */}
                                    <div className="space-y-3">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-primary" /> Etiquetas
                                            {selectedTagIds.length > 0 && (
                                                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold">{selectedTagIds.length}</span>
                                            )}
                                        </label>
                                        {tags.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {tags.map((tag) => {
                                                    const isSelected = selectedTagIds.includes(tag.id);
                                                    return (
                                                        <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} aria-pressed={isSelected}
                                                            className={cn("px-3 py-1 rounded-full text-xs font-semibold border transition-all", isSelected ? "border-transparent text-white scale-105" : "border-white/10 text-muted-foreground bg-white/5 hover:bg-white/10")}
                                                            style={isSelected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}>
                                                            {tag.name}
                                                        </button>
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
                                                <input type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Nombre de la etiqueta" aria-label="Nombre de la etiqueta"
                                                    className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); } }} />
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {TAG_PRESET_COLORS.map((color) => (
                                                        <button key={color} type="button" aria-label={`Color ${color}`} aria-pressed={newTagColor === color} onClick={() => setNewTagColor(color)}
                                                            className={cn("h-8 w-8 rounded-full border-2 transition-transform", newTagColor === color ? "border-white scale-110" : "border-transparent")}
                                                            style={{ backgroundColor: color }} />
                                                    ))}
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button type="button" size="sm" onClick={handleCreateTag} disabled={!newTagName.trim()} className="h-7 text-xs">
                                                        <Check className="h-3 w-3 mr-1" /> Crear
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewTagForm(false); setNewTagName(""); }} className="h-7 text-xs">Cancelar</Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Recurring */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium flex items-center gap-2">
                                                <RefreshCw className="h-4 w-4 text-primary" /> Recurrente
                                                {isRecurring && (
                                                    <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold capitalize">{recurringIntervalLabel[recurringInterval]}</span>
                                                )}
                                            </span>
                                            <button type="button" role="switch" aria-checked={isRecurring} aria-label="¿Es un gasto recurrente?" onClick={() => setIsRecurring((p) => !p)}
                                                className={cn("relative h-6 w-11 rounded-full transition-colors", isRecurring ? "bg-primary" : "bg-white/10")}>
                                                <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", isRecurring && "translate-x-5")} />
                                            </button>
                                        </div>
                                        {isRecurring && (
                                            <div className="grid grid-cols-3 gap-2 animate-in fade-in duration-200">
                                                {(["weekly", "monthly", "yearly"] as RecurringInterval[]).map((interval) => {
                                                    const labels = { weekly: "Semanal", monthly: "Mensual", yearly: "Anual" };
                                                    const icons = { weekly: "📅", monthly: "🗓️", yearly: "🔄" };
                                                    return (
                                                        <button key={interval} type="button" onClick={() => setRecurringInterval(interval)} aria-pressed={recurringInterval === interval}
                                                            className={cn("py-3 rounded-xl border text-center transition-all text-sm font-medium", recurringInterval === interval ? "bg-primary/20 border-primary text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10")}>
                                                            <span className="block text-lg mb-1">{icons[interval]}</span>
                                                            {labels[interval]}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Sticky submit */}
                        <div className="sticky bottom-0 -mx-4 px-4 pt-6 pb-4 mt-auto bg-gradient-to-t from-background via-background to-transparent space-y-3">
                            {formError && (
                                <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-sm text-red-300 animate-in fade-in slide-in-from-bottom-2">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    <span>{formError}</span>
                                </div>
                            )}
                            <Button
                                data-testid="expense-submit"
                                type="submit"
                                size="lg"
                                disabled={!amountValid || !description.trim()}
                                className="w-full text-base h-14 font-bold"
                                isLoading={loading}
                            >
                                Guardar gasto <Check className="ml-2 h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                )}
            </form>

            {/* ============ SCAN OVERLAY ============ */}
            {scanState !== "idle" && (
                <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8 animate-in fade-in duration-200">
                    <button type="button" onClick={discardScan} aria-label="Cerrar escáner" className="absolute top-12 right-6 text-muted-foreground p-1 active:scale-90">
                        <X className="h-6 w-6" />
                    </button>

                    {scanState === "scanning" && (
                        <output aria-live="polite" className="flex flex-col items-center">
                            <div className="relative w-[200px] h-[260px] rounded-xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl">
                                {receiptPreview ? (
                                    // oxlint-disable-next-line nextjs/no-img-element -- user-uploaded receipt of unknown dimensions
                                    <img src={receiptPreview} alt="Ticket en escaneo" className="w-full h-full object-cover opacity-80" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center"><Camera className="h-10 w-10 text-muted-foreground" /></div>
                                )}
                                <div className="absolute left-0 right-0 h-0.5 bg-primary shadow-[0_0_14px_2px_var(--color-primary,#7c3aed)] animate-equil-scan" />
                            </div>
                            <div className="flex items-center gap-2.5 mt-6 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <span className="text-sm font-medium">Analizando recibo… {ocrProgress}%</span>
                            </div>
                        </output>
                    )}

                    {scanState === "done" && pendingOcr && (
                        <div className="w-full max-w-[320px] animate-in fade-in duration-200">
                            <div className="flex flex-col items-center">
                                <div className="h-12 w-12 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center">
                                    <Check className="h-6 w-6 text-emerald-400" />
                                </div>
                                <h3 className="text-lg font-bold mt-3.5">Recibo detectado</h3>
                                <p className="text-sm text-muted-foreground">
                                    {pendingOcr.store || "Ticket"}{pendingOcr.items.length > 0 ? ` · ${pendingOcr.items.length} productos` : ""}
                                </p>
                            </div>
                            {pendingOcr.items.length > 0 && (
                                <div className="mt-5 rounded-xl bg-white/5 border border-white/10 p-2 max-h-52 overflow-y-auto">
                                    {pendingOcr.items.slice(0, 8).map((it, i) => (
                                        <div key={i} className="flex justify-between px-3 py-2 text-sm">
                                            <span className="text-muted-foreground truncate mr-2">{it.description || "Producto"}</span>
                                            <span className="font-mono font-medium flex-shrink-0">{it.total.toFixed(2)} €</span>
                                        </div>
                                    ))}
                                    {pendingOcr.items.length > 8 && (
                                        <p className="px-3 py-1 text-xs text-muted-foreground">…y {pendingOcr.items.length - 8} productos más</p>
                                    )}
                                </div>
                            )}
                            {pendingOcr.total != null && (
                                <div className="flex justify-between items-center mt-3 px-1">
                                    <span className="text-sm font-semibold">Total</span>
                                    <span className="font-mono text-lg font-bold">{pendingOcr.total.toFixed(2)} €</span>
                                </div>
                            )}
                            <Button type="button" onClick={applyScan} size="lg" className="w-full h-12 mt-5 font-semibold">Usar estos datos</Button>
                            <button type="button" onClick={discardScan} className="w-full h-10 mt-2 text-sm font-medium text-muted-foreground">Descartar</button>
                        </div>
                    )}
                </div>
            )}

            <style>{`
                @keyframes equil-scan { 0% { top: 0; } 100% { top: 100%; } }
                .animate-equil-scan { animation: equil-scan 1.5s ease-in-out infinite alternate; }
            `}</style>
        </div>
    );
}
