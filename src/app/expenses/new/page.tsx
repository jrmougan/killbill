"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, Heart, User, Camera, Image as ImageIcon, Loader2, X, Plus, Trash2, Calculator } from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ReceiptItem } from "@/types";
import { getAllCategories, getScannableCategories, getCategoryById } from "@/lib/categories";

export default function NewExpensePage() {
    const router = useRouter();
    const [amount, setAmount] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("food");
    const [loading, setLoading] = useState(false);

    // Simplified Split Selection for Couples
    const [splitWithPartner, setSplitWithPartner] = useState(true);
    const [members, setMembers] = useState<{ id: string, name: string, avatar: string | null }[]>([]);
    const [userId, setUserId] = useState<string | null>(null);

    // Receipt OCR States
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [receiptFile, setReceiptFile] = useState<File | null>(null);
    const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [ocrProgress, setOcrProgress] = useState(0);
    const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
    const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);

    // Reset form when category changes
    useEffect(() => {
        setAmount("");
        setDescription("");
        setReceiptFile(null);
        setReceiptPreview(null);
        setReceiptUrl(null);
        setReceiptItems([]);
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    }, [category]);

    useEffect(() => {
        fetch("/api/couple")
            .then(res => res.json())
            .then(data => {
                if (data.couple) {
                    setMembers(data.couple.members);
                }
                if (data.userId) {
                    setUserId(data.userId);
                }
            })
            .catch(err => console.error("Failed to fetch couple", err));
    }, []);

    const partner = members.find(m => m.id !== userId);

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
            formData.append('image', file);

            setOcrProgress(30);
            const response = await fetch('/api/ocr', {
                method: 'POST',
                body: formData
            });

            setOcrProgress(80);
            const data = await response.json();

            if (data.success) {
                console.log("Gemini OCR Result:", data);

                if (data.total) setAmount(data.total.toFixed(2));
                if (data.store) setDescription(data.store);
                if (data.items && data.items.length > 0) {
                    setReceiptItems(data.items);
                }
            } else {
                console.error("OCR Error:", data.error);
                // Fallback message
                alert("No se pudo procesar el ticket. Intenta con otra foto.");
            }

            setOcrProgress(100);
        } catch (err) {
            console.error("OCR Error:", err);
            alert("Error al procesar la imagen");
        } finally {
            setIsOcrRunning(false);
        }
    };

    useEffect(() => {
        if (receiptItems.length > 0) {
            const total = receiptItems.reduce((sum, item) => sum + item.total, 0);
            setAmount(total.toFixed(2));
        }
    }, [receiptItems]);

    const addItem = () => {
        setReceiptItems([...receiptItems, { description: "", quantity: 1, price: 0, total: 0, assignedTo: null }]);
    };

    const updateItem = (index: number, field: keyof ReceiptItem, value: any) => {
        const newItems = [...receiptItems];
        const item = { ...newItems[index], [field]: value };

        // Auto-calc total or price
        if (field === 'quantity' || field === 'price') {
            item.total = Number((item.quantity * item.price).toFixed(2));
        }

        newItems[index] = item;
        setReceiptItems(newItems);
    };

    const removeItem = (index: number) => {
        setReceiptItems(receiptItems.filter((_, i) => i !== index));
    };

    const toggleItemAssignment = (index: number) => {
        const newItems = [...receiptItems];
        const item = newItems[index];
        // Toggle between null (shared) and partner's id
        item.assignedTo = item.assignedTo ? null : partner?.id || null;
        setReceiptItems(newItems);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            let uploadedUrl = receiptUrl;

            // Upload image if present
            if (receiptFile && !uploadedUrl) {
                const formData = new FormData();
                formData.append('file', receiptFile);
                const uploadRes = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData,
                });
                const uploadData = await uploadRes.json();
                if (uploadData.success) {
                    uploadedUrl = uploadData.url;
                    setReceiptUrl(uploadedUrl);
                }
            }

            const res = await fetch("/api/expenses", {
                method: "POST",
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    description,
                    category,
                    beneficiaryId: splitWithPartner ? null : partner?.id,
                    receiptUrl: uploadedUrl,
                    receiptData: receiptItems.length > 0 ? receiptItems : undefined
                }),
            });

            if (res.ok) {
                router.push("/dashboard");
                router.refresh();
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col min-h-screen p-4 space-y-6 max-w-md mx-auto relative pb-24">
            <header className="flex items-center gap-4 pt-2">
                <Link href="/dashboard">
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-white/10">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <h1 className="text-xl font-bold">Nuevo Gasto</h1>
            </header>

            <form onSubmit={handleSubmit} className="flex-1 space-y-8 mt-4">

                {/* 1. Category Selection - Now at the Top */}
                <div className="space-y-4">
                    <label className="text-sm font-medium ml-1 flex items-center gap-2">
                        Categoría
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                        {getAllCategories().map((cat) => (
                            <button
                                key={cat.id}
                                type="button"
                                onClick={() => setCategory(cat.id)}
                                className={`p-3 rounded-xl border border-white/5 text-center transition-all ${category === cat.id ? "bg-primary text-white border-primary scale-105" : "bg-white/5 hover:bg-white/10"
                                    }`}
                            >
                                <span className="text-xl block mb-1">{cat.emoji}</span>
                                <span className="text-[10px] font-bold uppercase tracking-tight">{cat.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* 2. Amount Section */}
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

                {/* 3. Receipt Upload/Preview Zone - Only for scannable categories */}
                {getScannableCategories().includes(category) && (
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
                                    <p className="font-semibold text-sm">Escanear Ticket</p>
                                    <p className="text-xs text-muted-foreground">La magia del OCR hará el resto</p>
                                </div>
                            </div>
                        ) : (
                            <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-video bg-black/40">
                                <img
                                    src={receiptPreview}
                                    alt="Ticket preview"
                                    className="w-full h-full object-contain"
                                />
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-2 right-2 h-8 w-8 rounded-full"
                                    onClick={() => {
                                        setReceiptFile(null);
                                        setReceiptPreview(null);
                                        setReceiptUrl(null);
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
                                            <div
                                                className="h-full bg-primary transition-all duration-300"
                                                style={{ width: `${ocrProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleFileChange}
                        />
                    </div>
                )}

                {/* 4. Details */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium ml-1">Concepto</label>
                        <Input
                            placeholder="Ej: Compra Mercadona"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            required
                        />
                    </div>
                </div>

                {/* Items Breakdown Table */}
                {(receiptItems.length > 0 || category === 'shopping') && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold ml-1 flex items-center gap-2">
                                <Calculator className="h-4 w-4 text-primary" />
                                Desglose de Ticket
                            </h3>
                            <div className="flex gap-2">
                                <Button type="button" variant="secondary" size="sm" onClick={addItem} className="h-7">
                                    <Plus className="h-3 w-3 mr-1" /> Item
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-xl border border-white/10 overflow-hidden bg-black/20">
                            {receiptItems.length === 0 ? (
                                <div className="p-4 text-center text-sm text-muted-foreground">
                                    Añade items manualmente o escanea un ticket
                                </div>
                            ) : (
                                <div className="divide-y divide-white/5">
                                    {receiptItems.map((item, idx) => (
                                        <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 p-2 items-center hover:bg-white/5 transition-colors border-b border-white/[0.02]">
                                            <input
                                                className="bg-transparent text-sm w-full focus:outline-none font-medium min-w-0 px-1"
                                                value={item.description}
                                                onChange={(e) => updateItem(idx, 'description', e.target.value)}
                                                placeholder="Producto..."
                                            />
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <input
                                                    type="number"
                                                    className="bg-transparent text-[10px] w-6 text-right focus:outline-none text-muted-foreground"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                                                />
                                                <span className="text-[10px] text-muted-foreground">x</span>
                                                <input
                                                    type="number"
                                                    className="bg-transparent text-[10px] w-10 text-right focus:outline-none text-muted-foreground"
                                                    value={item.price}
                                                    onChange={(e) => updateItem(idx, 'price', parseFloat(e.target.value) || 0)}
                                                    placeholder="0.00"
                                                />
                                            </div>
                                            <div className="font-mono font-bold text-[11px] w-14 text-right flex-shrink-0">
                                                {item.total.toFixed(2)}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleItemAssignment(idx)}
                                                className={cn(
                                                    "h-7 w-7 flex-shrink-0 flex items-center justify-center rounded-lg transition-all",
                                                    item.assignedTo
                                                        ? "bg-pink-500/20 text-pink-400 hover:bg-pink-500/30"
                                                        : "bg-white/5 text-muted-foreground hover:bg-white/10"
                                                )}
                                                title={item.assignedTo ? `Solo para ${partner?.name}` : "Gasto común"}
                                            >
                                                {item.assignedTo ? (
                                                    <User className="h-3 w-3" />
                                                ) : (
                                                    <Heart className="h-3 w-3" />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeItem(idx)}
                                                className="text-muted-foreground hover:text-red-400 p-1 flex-shrink-0"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Summary of shared vs personal items */}
                        {receiptItems.length > 0 && receiptItems.some(i => i.assignedTo) && (
                            <div className="text-xs space-y-1 px-2 py-2 bg-white/5 rounded-lg animate-in fade-in">
                                <div className="flex justify-between text-muted-foreground">
                                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" /> Común (50/50):</span>
                                    <span>{receiptItems.filter(i => !i.assignedTo).reduce((acc, i) => acc + i.total, 0).toFixed(2)}€</span>
                                </div>
                                <div className="flex justify-between text-pink-400">
                                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> Solo {partner?.name}:</span>
                                    <span>{receiptItems.filter(i => i.assignedTo).reduce((acc, i) => acc + i.total, 0).toFixed(2)}€</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl">
                        <button
                            type="button"
                            onClick={() => setSplitWithPartner(true)}
                            className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${splitWithPartner ? "bg-primary text-white shadow-lg" : "text-muted-foreground hover:text-white"}`}
                        >
                            <Heart className={cn("h-4 w-4", splitWithPartner && "fill-current")} />
                            Común
                        </button>
                        <button
                            type="button"
                            onClick={() => setSplitWithPartner(false)}
                            className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${!splitWithPartner ? "bg-primary text-white shadow-lg" : "text-muted-foreground hover:text-white"}`}
                        >
                            <User className="h-4 w-4" />
                            Solo para {partner?.name || "pareja"}
                        </button>
                    </div>

                    {!splitWithPartner && partner && (
                        <p className="text-center text-xs text-muted-foreground animate-in fade-in duration-500">
                            100% del gasto es para <strong>{partner.name}</strong>
                        </p>
                    )}
                </div>

                {/* 0. OLD Categories (Removed from here) */}

                <div className="pt-4">
                    <Button
                        type="submit"
                        size="lg"
                        className="w-full text-base h-16 shadow-xl shadow-primary/20 font-bold"
                        isLoading={loading}
                    >
                        Guardar Gasto <Check className="ml-2 h-5 w-5" />
                    </Button>
                </div>
            </form>
        </div>
    );
}
