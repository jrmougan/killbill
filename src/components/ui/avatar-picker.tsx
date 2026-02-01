"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, X, Image as ImageIcon, Smile } from "lucide-react";
import { cn } from "@/lib/utils";

interface AvatarPickerProps {
    currentAvatar: string;
    onAvatarChange: (newAvatar: string) => void;
}

const COMMON_EMOJIS = ["👤", "👨", "👩", "🧑", "👶", "🧓", "👽", "🤖", "👻", "🐵", "🐶", "🐱", "🦊", "🦁", "🐸", "🍕", "🍔", "🍺", "⚽", "🎮", "🚀", "💡", "💰", "💸", "❤️", "🔥", "✨", "💩"];

export function AvatarPicker({ currentAvatar, onAvatarChange }: AvatarPickerProps) {
    const [mode, setMode] = useState<"EMOJI" | "IMAGE">("EMOJI");
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [customEmoji, setCustomEmoji] = useState("");

    const isInternalImage = currentAvatar.startsWith("/uploads/") || currentAvatar.startsWith("http");

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                onAvatarChange(data.url);
            } else {
                alert("Error al subir la imagen");
            }
        } catch (err) {
            console.error(err);
            alert("Error de conexión");
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-4 justify-center">
                {/* Current Avatar Preview */}
                <div className="relative group">
                    <div className="h-24 w-24 rounded-full bg-gradient-to-tr from-primary to-purple-500 p-[3px] shadow-xl">
                        <div className="h-full w-full rounded-full bg-black flex items-center justify-center overflow-hidden relative">
                            {isInternalImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={currentAvatar} alt="Avatar" className="h-full w-full object-cover" />
                            ) : (
                                <span className="text-5xl select-none">{currentAvatar}</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Selector Tabs */}
            <div className="flex p-1 bg-white/5 rounded-lg">
                <button
                    onClick={() => setMode("EMOJI")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all",
                        mode === "EMOJI" ? "bg-primary/20 text-primary shadow-sm" : "text-muted-foreground hover:bg-white/5"
                    )}
                >
                    <Smile className="h-4 w-4" /> Emojis
                </button>
                <button
                    onClick={() => setMode("IMAGE")}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all",
                        mode === "IMAGE" ? "bg-primary/20 text-primary shadow-sm" : "text-muted-foreground hover:bg-white/5"
                    )}
                >
                    <ImageIcon className="h-4 w-4" /> Imagen
                </button>
            </div>

            {/* Content Area */}
            <div className="min-h-[180px] p-4 bg-black/20 rounded-xl border border-white/5">
                {mode === "EMOJI" && (
                    <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
                        <div className="grid grid-cols-7 gap-2">
                            {COMMON_EMOJIS.map(emoji => (
                                <button
                                    key={emoji}
                                    onClick={() => onAvatarChange(emoji)}
                                    className={cn(
                                        "h-8 w-8 flex items-center justify-center rounded-full text-xl hover:bg-white/10 transition-colors",
                                        currentAvatar === emoji && "bg-primary/20 ring-1 ring-primary"
                                    )}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                            <span className="text-xs text-muted-foreground whitespace-nowrap">O escribe uno:</span>
                            <Input
                                value={customEmoji}
                                onChange={(e) => {
                                    setCustomEmoji(e.target.value);
                                    if (e.target.value) onAvatarChange(e.target.value);
                                }}
                                className="h-8 bg-transparent border-white/10 text-center"
                                placeholder="🚀"
                                maxLength={2}
                            />
                        </div>
                    </div>
                )}

                {mode === "IMAGE" && (
                    <div className="flex flex-col items-center justify-center py-6 gap-4 animate-in fade-in zoom-in-95 duration-200">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={handleFileUpload}
                        />
                        <Button
                            variant="secondary"
                            className="h-auto py-8 px-8 border-dashed border-2 border-white/20 bg-transparent hover:bg-white/5 flex flex-col gap-2"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                        >
                            <Upload className="h-8 w-8 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                {isUploading ? "Subiendo..." : "Subir imagen"}
                            </span>
                        </Button>
                        <p className="text-[10px] text-muted-foreground text-center">
                            Máximo 5MB. JPG, PNG, GIF, WEBP.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
