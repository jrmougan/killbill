"use client";

import { EqCta } from "@/components/ui/eq";

/**
 * Receipt scanning screen (prototype `scanning`): dark striped viewfinder with
 * an animated scan line (`eq-scan` keyframes from globals.css) while /api/ocr
 * reads the photo the user just took or picked.
 */
export function ScanScreen({ preview, onCancel }: { preview: string | null; onCancel: () => void }) {
    return (
        <div className="eq-in flex-1 flex flex-col gap-4 px-5 pt-4 pb-[30px]">
            <output
                aria-live="polite"
                className="relative flex-1 min-h-[320px] rounded-[24px] overflow-hidden bg-foreground flex items-center justify-center"
            >
                <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 10px, rgba(255,255,255,0.035) 10px 20px)" }}
                />
                {preview && (
                    // oxlint-disable-next-line nextjs/no-img-element -- local object URL of the receipt being read
                    <img src={preview} alt="" aria-hidden className="absolute inset-[30px_40px] h-[calc(100%-60px)] w-[calc(100%-80px)] object-cover rounded-[14px] opacity-35" />
                )}
                <div aria-hidden className="absolute inset-[30px_40px] rounded-[14px] border-2 border-white/80" />
                <div
                    aria-hidden
                    className="absolute left-10 right-10 top-10 h-0.5 bg-[var(--accent-soft)] shadow-[0_0_14px_var(--accent-soft)]"
                    style={{ animation: "eq-scan 1.8s ease-in-out infinite" }}
                />
                <span className="relative font-mono text-[11px] text-[color:var(--ink-3)]">cámara · encuadra el ticket</span>
            </output>
            <span className="text-center text-sm text-muted-foreground">Leyendo importe, comercio y fecha…</span>
            <EqCta variant="outline" onClick={onCancel}>Cancelar</EqCta>
        </div>
    );
}
