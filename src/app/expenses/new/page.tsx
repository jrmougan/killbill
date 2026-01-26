"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Check, Heart, User } from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createWorker } from 'tesseract.js';
import { Camera, Image as ImageIcon, Loader2, X } from "lucide-react";

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

    useEffect(() => {
        fetch("/api/couple")
            .then(res => res.json())
            .then(data => {
                if (data.couple) {
                    setMembers(data.couple.members);
                }
            })
            .catch(err => console.error("Failed to fetch couple", err));

        const uid = document.cookie.split('; ').find(row => row.startsWith('user_id='))?.split('=')[1];
        setUserId(uid || null);
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
        setOcrProgress(0);
        try {
            const worker = await createWorker('spa', 1, {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        setOcrProgress(Math.round(m.progress * 100));
                    }
                }
            });

            const { data: { text } } = await worker.recognize(file);
            console.log("OCR Result:", text);

            // Basic parsing logic
            // Look for patterns like "TOTAL" or "EUR" or "€" followed by numbers
            const lines = text.split('\n');
            let foundAmount = "";
            let foundDescription = "";

            // Try to find the total amount
            // Patterns: TOTAL 12.34, EUR 12.34, 12,34€ etc
            const amountRegex = /(?:total|importe|eur|€)\s*[:=]?\s*(\d+[.,]\d{2})/i;
            const fallbackAmountRegex = /(\d+[.,]\d{2})/;

            for (const line of lines) {
                const match = line.match(amountRegex);
                if (match) {
                    foundAmount = match[1].replace(',', '.');
                    break;
                }
            }

            if (!foundAmount) {
                // Try fallback search for any price-like number from the bottom up (usually totals are at the end)
                for (let i = lines.length - 1; i >= 0; i--) {
                    const match = lines[i].match(fallbackAmountRegex);
                    if (match) {
                        foundAmount = match[1].replace(',', '.');
                        break;
                    }
                }
            }

            // Try to find a description (first line often has the store name)
            if (lines.length > 0) {
                foundDescription = lines[0].trim();
            }

            if (foundAmount) setAmount(foundAmount);
            if (foundDescription) setDescription(foundDescription);

            await worker.terminate();
        } catch (err) {
            console.error("OCR Error:", err);
        } finally {
            setIsOcrRunning(false);
        }
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
                    beneficiaryId: splitWithPartner ? null : userId,
                    receiptUrl: uploadedUrl
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

                {/* Receipt Upload/Preview Zone */}
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

                <div className="space-y-2 text-center py-6">
                    <label className="text-sm text-muted-foreground uppercase tracking-widest font-bold">¿Cuánto ha sido?</label>
                    <div className="relative inline-block w-full max-w-[200px]">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-bold text-muted-foreground">€</span>
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-center text-5xl font-bold focus:outline-none placeholder:text-white/10 p-2 appearance-none"
                            autoFocus
                            required
                            step="0.01"
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl">
                        <button
                            type="button"
                            onClick={() => setSplitWithPartner(true)}
                            className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${splitWithPartner ? "bg-primary text-white shadow-lg" : "text-muted-foreground hover:text-white"}`}
                        >
                            <Heart className={cn("h-4 w-4", splitWithPartner && "fill-current")} />
                            Los dos
                        </button>
                        <button
                            type="button"
                            onClick={() => setSplitWithPartner(false)}
                            className={`py-3 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${!splitWithPartner ? "bg-primary text-white shadow-lg" : "text-muted-foreground hover:text-white"}`}
                        >
                            <User className="h-4 w-4" />
                            Solo yo
                        </button>
                    </div>

                    {splitWithPartner && partner && (
                        <p className="text-center text-xs text-muted-foreground animate-in fade-in duration-500">
                            Se dividirá 50/50 con <strong>{partner.name}</strong>
                        </p>
                    )}
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium ml-1">Concepto</label>
                        <Input
                            placeholder="Ej: Cena romántica"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium ml-1">Categoría</label>
                        <div className="grid grid-cols-3 gap-2">
                            {["food", "rent", "utilities", "transport", "entertainment", "other"].map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setCategory(cat)}
                                    className={`p-3 rounded-xl border border-white/5 text-sm font-medium capitalize transition-all ${category === cat ? "bg-primary text-white border-primary" : "bg-white/5 hover:bg-white/10"
                                        }`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

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
