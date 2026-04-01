"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    ArrowLeft, Check, Heart, User, Camera, Loader2, X, Plus, Trash2,
    Calculator, FileText, SlidersHorizontal, Tag, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReceiptItem } from "@/types";
import { getAllCategories } from "@/lib/categories";

type SplitMode = "shared" | "solo" | "custom";
type RecurringInterval = "weekly" | "monthly" | "yearly";

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
    initialAmount: number;
    initialDescription: string;
    initialCategory: string;
    initialSplitMode: SplitMode;
    initialMyPercent: number;
    initialReceiptItems: ReceiptItem[];
    initialReceiptUrl: string | null;
    initialNotes: string;
    initialIsRecurring: boolean;
    initialRecurringInterval: RecurringInterval;
    initialTagIds: string[];
    allTags: TagItem[];
}

export function EditExpenseClient({
    expenseId,
    userId,
    partner,
    initialAmount,
    initialDescription,
    initialCategory,
    initialSplitMode,
    initialMyPercent,
    initialReceiptItems,
    initialReceiptUrl,
    initialNotes,
    initialIsRecurring,
    initialRecurringInterval,
    initialTagIds,
    allTags,
}: EditExpenseClientProps) {
    const router = useRouter();

    const [amount, setAmount] = useState(initialAmount.toFixed(2));
    const [description, setDescription] = useState(initialDescription);
    const [category, setCategory] = useState(initialCategory);
    const [loading, setLoading] = useState(false);

    // Split
    const [splitMode, setSplitMode] = useState<SplitMode>(initialSplitMode);
    const [myPercent, setMyPercent] = useState(initialMyPercent);

    // Items breakdown
    const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>(initialReceiptItems);

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

    const partnerPercent = 100 - myPercent;
    const amountNum = parseFloat(amount) || 0;
    const myAmount = ((amountNum * myPercent) / 100).toFixed(2);
    const partnerAmount = ((amountNum * partnerPercent) / 100).toFixed(2);

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
    const hasItemAssignments = receiptItems.some((i) => i.assignedTo !== null);

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
                if (data.category) setCategory(data.category);
                if (data.items && data.items.length > 0) setReceiptItems(data.items);
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
        setReceiptItems([...receiptItems, { description: "", quantity: 1, price: 0, total: 0, assignedTo: null }]);
    };

    const updateItem = (index: number, field: keyof ReceiptItem, value: any) => {
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

        if (splitMode === "custom" && myPercent + partnerPercent !== 100) {
            alert("Los porcentajes deben sumar 100%");
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
                receiptItems: receiptItems.length > 0 ? receiptItems : undefined,
                notes: notes.trim() || null,
                isRecurring,
                recurringInterval: isRecurring ? recurringInterval : undefined,
            };

            if (hasItemAssignments && partner) {
                bodyPayload.customSplits = [
                    { userId, amount: Math.round(itemSplitMyAmount * 100) },
                    { userId: partner.id, amount: Math.round(itemSplitPartnerAmount * 100) },
                ];
            } else if (splitMode === "solo" && partner) {
                bodyPayload.splitWithPartner = false;
            } else if (splitMode === "custom" && partner) {
                bodyPayload.customSplits = [
                    { userId, amount: Math.round((amountCents * myPercent) / 100) },
                    { userId: partner.id, amount: Math.round((amountCents * partnerPercent) / 100) },
                ];
            } else {
                bodyPayload.splitWithPartner = true;
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
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Editar Gasto</h1>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 space-y-8 mt-4">

                {/* 1. Receipt preview / re-scan */}
                <div className="space-y-4">
                    {!receiptPreview ? (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/10 bg-white/5 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/[0.08] transition-all group"
                        >
                            <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Camera className="h-6 w-6 text-primary" />
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-sm">Añadir / Re-escanear Ticket</p>
                                <p className="text-xs text-muted-foreground">El OCR actualizará el desglose automáticamente</p>
                            </div>
                        </div>
                    ) : (
                        <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-video bg-black/40">
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
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300">
                                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                                    <div className="text-center">
                                        <p className="font-bold text-white">Leyendo ticket...</p>
                                        <p className="text-xs text-primary">{ocrProgress}%</p>
                                    </div>
                                    <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
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
                    <label className="text-sm font-medium ml-1">Categoría</label>
                    <div className="grid grid-cols-4 gap-2">
                        {getAllCategories().map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setCategory(cat.id)}
                                className={`p-3 rounded-xl border border-white/5 text-center transition-all ${
                                    category === cat.id
                                        ? "bg-primary text-white border-primary scale-105"
                                        : "bg-white/5 hover:bg-white/10"
                                }`}
                            >
                                <span className="text-xl block mb-1">{cat.emoji}</span>
                                <span className="text-[10px] font-bold uppercase tracking-tight">{cat.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 3. Amount */}
                <div className="space-y-2 text-center py-2">
                    <label className="text-sm text-muted-foreground uppercase tracking-widest font-bold">Importe</label>
                    <div className="relative inline-block w-full max-w-[200px]">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground">€</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-center text-5xl font-bold focus:outline-none placeholder:text-white/10 p-2 appearance-none"
                            required
                            step="0.01"
                        />
                    </div>
                </div>

                {/* 4. Description */}
                <div className="space-y-2">
                    <label className="text-sm font-medium ml-1">Concepto</label>
                    <Input
                        placeholder="Ej: Compra Mercadona"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        required
                    />
                </div>

                {/* 5. Items breakdown */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold ml-1 flex items-center gap-2">
                            <Calculator className="h-4 w-4 text-primary" />
                            Desglose de Ticket
                        </h3>
                        <Button type="button" variant="secondary" size="sm" onClick={addItem} className="h-7">
                            <Plus className="h-3 w-3 mr-1" /> Item
                        </Button>
                    </div>

                    <div className="rounded-xl border border-white/10 overflow-hidden bg-black/20">
                        {receiptItems.length === 0 ? (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                                Añade items manualmente o re-escanea el ticket
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {receiptItems.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 items-center hover:bg-white/5 transition-colors"
                                    >
                                        <input
                                            className="bg-transparent text-sm w-full focus:outline-none font-medium min-w-0 px-1"
                                            value={item.description}
                                            onChange={(e) => updateItem(idx, "description", e.target.value)}
                                            placeholder="Producto..."
                                        />
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <input
                                                type="number"
                                                className="bg-transparent text-[10px] w-6 text-right focus:outline-none text-muted-foreground"
                                                value={item.quantity}
                                                onChange={(e) => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)}
                                            />
                                            <span className="text-[10px] text-muted-foreground">x</span>
                                            <input
                                                type="number"
                                                className="bg-transparent text-[10px] w-10 text-right focus:outline-none text-muted-foreground"
                                                value={item.price}
                                                onChange={(e) => updateItem(idx, "price", parseFloat(e.target.value) || 0)}
                                                placeholder="0.00"
                                            />
                                        </div>
                                        <div className="font-mono font-bold text-[11px] w-14 text-right flex-shrink-0">
                                            {item.total.toFixed(2)}
                                        </div>
                                        {partner && (
                                            <div className="flex items-center flex-shrink-0 rounded-lg overflow-hidden border border-white/10 text-[9px] font-bold">
                                                <button type="button" onClick={() => setItemAssignment(idx, null)}
                                                    className={cn("px-1.5 py-1 transition-colors", item.assignedTo === null ? "bg-primary text-white" : "text-muted-foreground hover:bg-white/10")}
                                                    title="Compartido (50/50)">½</button>
                                                <button type="button" onClick={() => setItemAssignment(idx, userId)}
                                                    className={cn("px-1.5 py-1 border-l border-white/10 transition-colors", item.assignedTo === userId ? "bg-blue-500/30 text-blue-300" : "text-muted-foreground hover:bg-white/10")}
                                                    title="Solo mío">Yo</button>
                                                <button type="button" onClick={() => setItemAssignment(idx, partner.id)}
                                                    className={cn("px-1.5 py-1 border-l border-white/10 transition-colors", item.assignedTo === partner.id ? "bg-pink-500/30 text-pink-300" : "text-muted-foreground hover:bg-white/10")}
                                                    title={`Solo ${partner.name}`}>{partner.name.charAt(0).toUpperCase()}</button>
                                            </div>
                                        )}
                                        <button type="button" onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-red-400 p-1 flex-shrink-0">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {receiptItems.length > 0 && hasItemAssignments && (
                        <div className="text-xs px-2 py-2 bg-white/5 rounded-lg space-y-1">
                            <div className="flex justify-between font-semibold">
                                <span className="text-blue-300">Tu parte:</span>
                                <span className="text-blue-300">{itemSplitMyAmount.toFixed(2)}€</span>
                            </div>
                            <div className="flex justify-between font-semibold">
                                <span className="text-pink-300">{partner?.name ?? "Pareja"}:</span>
                                <span className="text-pink-300">{itemSplitPartnerAmount.toFixed(2)}€</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* 6. Split mode */}
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 p-1 bg-white/5 rounded-xl">
                        {(["shared", "solo", "custom"] as SplitMode[]).map((mode) => {
                            const icons = { shared: <Heart className={cn("h-4 w-4", splitMode === "shared" && "fill-current")} />, solo: <User className="h-4 w-4" />, custom: <SlidersHorizontal className="h-4 w-4" /> };
                            const labels = { shared: "Común", solo: `Solo ${partner?.name ?? "pareja"}`, custom: "Custom" };
                            return (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setSplitMode(mode)}
                                    className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                                        splitMode === mode ? "bg-primary text-white shadow-lg" : "text-muted-foreground hover:text-white"
                                    }`}
                                >
                                    {icons[mode]}
                                    <span className="truncate">{labels[mode]}</span>
                                </button>
                            );
                        })}
                    </div>

                    {splitMode === "custom" && (
                        <div className="space-y-3 animate-in fade-in duration-300 bg-white/5 rounded-xl p-4">
                            <div className="flex items-center gap-3">
                                <div className="flex-1 space-y-1">
                                    <label className="text-xs text-muted-foreground">Yo</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number" min={0} max={100} value={myPercent}
                                            onChange={(e) => setMyPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                            className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-primary/50"
                                        />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                                <div className="text-muted-foreground text-sm font-bold pt-4">/</div>
                                <div className="flex-1 space-y-1">
                                    <label className="text-xs text-muted-foreground">{partner?.name ?? "Pareja"}</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number" min={0} max={100} value={partnerPercent}
                                            onChange={(e) => setMyPercent(100 - Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                                            className="w-16 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5 text-sm font-bold text-center focus:outline-none focus:border-primary/50"
                                        />
                                        <span className="text-sm text-muted-foreground">%</span>
                                    </div>
                                </div>
                            </div>
                            {amountNum > 0 && (
                                <div className="text-xs text-center text-muted-foreground">
                                    Yo: <strong className="text-white">{myAmount}€</strong> — {partner?.name ?? "Pareja"}: <strong className="text-white">{partnerAmount}€</strong>
                                </div>
                            )}
                            {myPercent + partnerPercent !== 100 && (
                                <p className="text-xs text-red-400 text-center">Los porcentajes deben sumar 100%</p>
                            )}
                        </div>
                    )}
                </div>

                {/* 7. Notes */}
                <div className="space-y-2">
                    <label className="text-sm font-medium ml-1 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        Notas
                        <span className="text-xs text-muted-foreground font-normal">(opcional)</span>
                    </label>
                    <div className="relative">
                        <textarea
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

                {/* 8. Tags */}
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => setTagsExpanded((p) => !p)}
                        className="w-full flex items-center justify-between text-sm font-medium p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <Tag className="h-4 w-4 text-primary" />
                            Etiquetas
                            {selectedTagIds.length > 0 && (
                                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold">{selectedTagIds.length}</span>
                            )}
                        </span>
                        {tagsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>

                    {tagsExpanded && (
                        <div className="space-y-3 animate-in fade-in duration-200 bg-white/5 rounded-xl p-4">
                            {tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {tags.map((tag) => {
                                        const isSelected = selectedTagIds.includes(tag.id);
                                        return (
                                            <button
                                                key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                                                className={cn("px-3 py-1 rounded-full text-xs font-semibold border transition-all", isSelected ? "border-transparent text-white scale-105" : "border-white/10 text-muted-foreground bg-white/5 hover:bg-white/10")}
                                                style={isSelected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
                                            >{tag.name}</button>
                                        );
                                    })}
                                </div>
                            )}
                            {!showNewTagForm ? (
                                <button type="button" onClick={() => setShowNewTagForm(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors">
                                    <Plus className="h-3.5 w-3.5" /> Nueva etiqueta
                                </button>
                            ) : (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    <input
                                        type="text" value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                                        placeholder="Nombre de la etiqueta"
                                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); } }}
                                    />
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {TAG_PRESET_COLORS.map((color) => (
                                            <button key={color} type="button" onClick={() => setNewTagColor(color)}
                                                className={cn("h-6 w-6 rounded-full border-2 transition-transform", newTagColor === color ? "border-white scale-110" : "border-transparent")}
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
                        className="w-full flex items-center justify-between text-sm font-medium p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                    >
                        <span className="flex items-center gap-2">
                            <RefreshCw className="h-4 w-4 text-primary" />
                            Recurrente
                            {isRecurring && (
                                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold capitalize">
                                    {{ weekly: "Semanal", monthly: "Mensual", yearly: "Anual" }[recurringInterval]}
                                </span>
                            )}
                        </span>
                        {recurringExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </button>

                    {recurringExpanded && (
                        <div className="space-y-4 animate-in fade-in duration-200 bg-white/5 rounded-xl p-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm">¿Es un gasto recurrente?</span>
                                <button
                                    type="button"
                                    onClick={() => setIsRecurring((p) => !p)}
                                    className={cn("relative h-6 w-11 rounded-full transition-colors", isRecurring ? "bg-primary" : "bg-white/10")}
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
                                                    recurringInterval === interval ? "bg-primary/20 border-primary text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10")}
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
                        className="w-full text-base h-16 shadow-xl shadow-primary/20 font-bold"
                        isLoading={loading}
                    >
                        Guardar Cambios <Check className="ml-2 h-5 w-5" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
