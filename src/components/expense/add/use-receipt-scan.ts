"use client";

import { useEffect, useRef, type Dispatch } from "react";
import { withUid, type EditableReceiptItem } from "./receipt-items-editor";
import type { FormAction } from "./expense-form-state";

const revokeBlob = (url: string | null) => {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
};

/**
 * Receipt photo + OCR for the expense form: the hidden file input, the
 * cancellable `/api/ocr` call and the receipt preview (blob URLs are revoked
 * when replaced or discarded). With `autoScan` the picker opens on mount (the
 * scan button keeps a visual hint in case the browser blocks it).
 */
export function useReceiptScan({
    dispatch,
    receiptPreview,
    categoryKeys,
    autoScan,
}: {
    dispatch: Dispatch<FormAction>;
    receiptPreview: string | null;
    /** Effective category keys: the OCR category is only applied when valid. */
    categoryKeys: string[];
    autoScan: boolean;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ocrAbort = useRef<AbortController | null>(null);

    const runOcr = async (file: File) => {
        dispatch({ type: "scanStarted" });
        const ctrl = new AbortController();
        ocrAbort.current = ctrl;
        try {
            const fd = new FormData();
            fd.append("image", file);
            const res = await fetch("/api/ocr", { method: "POST", body: fd, signal: ctrl.signal });
            const data = res.ok ? await res.json() : null;
            if (ctrl.signal.aborted) return;
            if (!data?.success) {
                dispatch({
                    type: "scanFailed",
                    error: res.ok
                        ? "No se reconoció el ticket. Prueba otra foto o rellénalo a mano."
                        : "No se pudo leer el ticket. Puedes reintentar o rellenarlo a mano.",
                });
                return;
            }
            const items: EditableReceiptItem[] = Array.isArray(data.items) ? data.items.map(withUid) : [];
            dispatch({
                type: "scanSucceeded",
                items,
                total: typeof data.total === "number" ? data.total : null,
                store: data.store || null,
                category: typeof data.category === "string" && categoryKeys.includes(data.category) ? data.category : null,
            });
        } catch (err) {
            if (ctrl.signal.aborted) return;
            console.error("OCR error", err);
            dispatch({ type: "scanFailed", error: "Error al procesar la imagen. Comprueba tu conexión y reintenta." });
        }
    };

    const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        revokeBlob(receiptPreview);
        dispatch({ type: "fileChosen", file, preview: URL.createObjectURL(file) });
        void runOcr(file);
    };

    const resetInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const discardReceipt = () => {
        revokeBlob(receiptPreview);
        dispatch({ type: "receiptDiscarded" });
        resetInput();
    };

    const cancelScan = () => {
        ocrAbort.current?.abort();
        revokeBlob(receiptPreview);
        dispatch({ type: "scanCancelled" });
        resetInput();
    };

    const openScanner = () => fileInputRef.current?.click();

    useEffect(() => {
        if (!autoScan) return;
        // Browsers may refuse a picker without a user gesture: keep a visual hint.
        dispatch({ type: "scanHintShown" });
        try { fileInputRef.current?.click(); } catch { /* blocked: the hint stays */ }
    }, [autoScan, dispatch]);

    return { fileInputRef, runOcr, onFile, discardReceipt, cancelScan, openScanner };
}
