/**
 * OCR → list reconciliation (Feature B). Delegates the fuzzy match to Gemini in a
 * dedicated vision call: receipt descriptions are cryptic, truncated, uppercase
 * abbreviations ("LECHE DESN PACK6") vs. generic list names ("leche"), so exact
 * matching fails almost always. The model returns, for each PENDING (unchecked)
 * list item, whether the receipt contains it.
 *
 * CRITICAL (plan §6): this is a SUGGESTION, never a silent auto-mark. The endpoint
 * returns matches; the user confirms which to tick, and the tick goes through the
 * normal idempotent `setItemChecked` toggle (target = `checked`, never a bridge).
 */

const GEMINI_MODEL = "gemini-flash-latest";

/** A pending list item offered to the matcher. */
export interface PendingItem {
    id: string;
    name: string;
}

/** One suggested match: a pending item the receipt appears to contain. */
export interface ReconcileMatch {
    itemId: string;
    name: string;
    /** The receipt line/text the model matched it to (for the confirm UI). */
    matchedText: string;
    /** Model confidence 0..1 (best-effort; clamped). */
    confidence: number;
}

/** Build the numbered-item matching prompt (pure — unit tested). */
export function buildReconcilePrompt(items: PendingItem[]): string {
    const numbered = items.map((it, i) => `${i + 1}. ${it.name}`).join("\n");
    return `Tienes la FOTO de un ticket de compra y una LISTA de artículos pendientes.
Para cada artículo de la lista, decide si aparece en el ticket (aunque el ticket
use abreviaturas en mayúsculas, marcas o nombres recortados). Sé conservador: solo
marca coincidencias claras.

LISTA DE ARTÍCULOS PENDIENTES:
${numbered}

Devuelve SOLO JSON con las coincidencias encontradas:
{"matches":[{"index":1,"receiptText":"TEXTO DEL TICKET","confidence":0.0}]}
- "index" es el número del artículo de la lista (1..${items.length}).
- "receiptText" es la línea del ticket que lo justifica.
- "confidence" entre 0 y 1.
- No inventes coincidencias; si un artículo no está, omítelo.`;
}

interface RawMatch {
    index?: unknown;
    receiptText?: unknown;
    confidence?: unknown;
}

/**
 * Map a raw Gemini JSON string back to concrete item matches. Pure + defensive:
 * ignores out-of-range indices, dedupes by item, clamps confidence. Unit tested.
 */
export function parseReconcileResponse(text: string, items: PendingItem[]): ReconcileMatch[] {
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();

    let parsed: { matches?: RawMatch[] } | null = null;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return [];
    }
    const raw = Array.isArray(parsed?.matches) ? parsed!.matches : [];
    const seen = new Set<string>();
    const out: ReconcileMatch[] = [];
    for (const m of raw) {
        const idx = typeof m.index === "number" ? Math.trunc(m.index) : NaN;
        if (!Number.isInteger(idx) || idx < 1 || idx > items.length) continue;
        const item = items[idx - 1];
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const confRaw = typeof m.confidence === "number" ? m.confidence : 0.5;
        const confidence = Math.max(0, Math.min(1, confRaw));
        const matchedText = typeof m.receiptText === "string" ? m.receiptText.slice(0, 120) : "";
        out.push({ itemId: item.id, name: item.name, matchedText, confidence });
    }
    return out;
}

/**
 * Call Gemini Vision to reconcile a receipt image against pending items. Returns
 * the suggested matches (possibly empty). Throws on a hard API/key failure so the
 * route can surface a 500/502.
 */
export async function reconcileReceiptWithItems(
    apiKey: string,
    base64: string,
    mimeType: string,
    items: PendingItem[],
): Promise<ReconcileMatch[]> {
    if (items.length === 0) return [];
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: buildReconcilePrompt(items) },
                        { inline_data: { mime_type: mimeType, data: base64 } },
                    ],
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: "application/json" },
            }),
        },
    );
    if (!response.ok) {
        throw new Error(`Gemini reconcile failed: ${response.status}`);
    }
    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) return [];
    return parseReconcileResponse(textContent, items);
}
