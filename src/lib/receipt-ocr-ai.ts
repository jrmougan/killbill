const GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";

const RECEIPT_PROMPT = `Analiza este ticket de compra y extrae los productos en JSON.

REGLAS:
- Extrae TODOS los productos con precio
- Usa descripciones CORTAS (max 20 caracteres, sin marcas largas)
- Ignora IVA, subtotales, métodos de pago
- El total es la cantidad final pagada
- Precios con punto decimal (ej: 2.50, no 2,50)
- Elige la categoría más apropiada para el ticket completo:
  "shopping" = supermercado, ropa, electrodomésticos, bazar
  "food" = restaurante, bar, cafetería, comida preparada, delivery
  "health" = farmacia, parafarmacia, médico
  "transport" = gasolinera, parking, peaje, tren, bus
  "entertainment" = cine, teatro, museo, parque
  "utilities" = factura luz, gas, agua, internet
  "other" = cualquier otra cosa`;

const RECEIPT_SCHEMA = {
    type: "object",
    properties: {
        store: { type: "string" },
        category: { type: "string" },
        items: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    description: { type: "string" },
                    quantity: { type: "number" },
                    price: { type: "number" },
                    total: { type: "number" },
                },
                required: ["description", "quantity", "price", "total"],
                additionalProperties: false,
            },
        },
        total: { type: "number" },
    },
    required: ["store", "category", "items", "total"],
    additionalProperties: false,
} as const;

export interface ReceiptAIItem {
    description: string;
    quantity: number;
    price: number;
    total: number;
}

export interface ReceiptAIResult {
    store: string;
    category: string;
    items: ReceiptAIItem[];
    total: number;
}

export class ReceiptAIError extends Error {
    constructor(message = "No se pudo procesar la imagen con los proveedores de IA disponibles.") {
        super(message);
        this.name = "ReceiptAIError";
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function stripMarkdownFence(text: string): string {
    let json = text.trim();
    if (json.startsWith("```json")) json = json.slice(7);
    else if (json.startsWith("```")) json = json.slice(3);
    if (json.endsWith("```")) json = json.slice(0, -3);
    return json.trim();
}

function tryParseJSON(text: string): unknown | null {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function toReceiptResult(value: unknown): ReceiptAIResult | null {
    if (!value || typeof value !== "object") return null;

    const receipt = value as Record<string, unknown>;
    if (!Array.isArray(receipt.items)) return null;

    const items: ReceiptAIItem[] = [];
    for (const value of receipt.items) {
        if (!value || typeof value !== "object") return null;
        const item = value as Record<string, unknown>;
        if (
            typeof item.description !== "string" ||
            !isFiniteNumber(item.quantity) ||
            !isFiniteNumber(item.price) ||
            !isFiniteNumber(item.total)
        ) return null;

        items.push({
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            total: item.total,
        });
    }

    if (!isFiniteNumber(receipt.total)) return null;

    return {
        store: typeof receipt.store === "string" ? receipt.store : "",
        category: typeof receipt.category === "string" ? receipt.category : "",
        items,
        total: receipt.total,
    };
}

export function parseReceiptAIResponse(text: string): ReceiptAIResult {
    const json = stripMarkdownFence(text);
    let parsed = tryParseJSON(json);

    if (!parsed) {
        const lastCompleteItem = json.lastIndexOf("},");
        const closedItems = json.lastIndexOf("}]");
        if (lastCompleteItem > closedItems) {
            parsed = tryParseJSON(`${json.substring(0, lastCompleteItem + 1)}],"total":0}`);
        }
    }

    const receipt = toReceiptResult(parsed);
    if (!receipt) throw new ReceiptAIError("La respuesta del modelo no contiene un ticket válido.");
    return receipt;
}

async function callGemini(apiKey: string, base64: string, mimeType: string): Promise<ReceiptAIResult> {
    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: RECEIPT_PROMPT },
                        { inline_data: { mime_type: mimeType, data: base64 } },
                    ],
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    responseMimeType: "application/json",
                    responseSchema: RECEIPT_SCHEMA,
                },
            }),
        },
    );

    if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("Gemini returned an empty response");
    return parseReceiptAIResponse(text);
}

async function callOpenRouter(apiKey: string, base64: string, mimeType: string): Promise<ReceiptAIResult> {
    const model = process.env.OPENROUTER_OCR_MODEL || DEFAULT_OPENROUTER_MODEL;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-OpenRouter-Title": "Kill Bill",
        },
        body: JSON.stringify({
            model,
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: RECEIPT_PROMPT },
                    {
                        type: "image_url",
                        image_url: { url: `data:${mimeType};base64,${base64}` },
                    },
                ],
            }],
            temperature: 0.1,
            max_tokens: 8192,
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "receipt",
                    strict: true,
                    schema: RECEIPT_SCHEMA,
                },
            },
            provider: {
                require_parameters: true,
                data_collection: "deny",
            },
        }),
    });

    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error("OpenRouter returned an empty response");
    return parseReceiptAIResponse(text);
}

export async function analyzeReceiptImage(base64: string, mimeType: string): Promise<ReceiptAIResult> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    if (geminiKey) {
        try {
            return await callGemini(geminiKey, base64, mimeType);
        } catch (error) {
            console.warn(`Receipt OCR: Gemini failed${openRouterKey ? ", trying OpenRouter" : ""}: ${errorMessage(error)}`);
        }
    }

    if (openRouterKey) {
        try {
            return await callOpenRouter(openRouterKey, base64, mimeType);
        } catch (error) {
            console.error(`Receipt OCR: OpenRouter failed: ${errorMessage(error)}`);
        }
    }

    if (!geminiKey && !openRouterKey) {
        throw new ReceiptAIError("GEMINI_API_KEY or OPENROUTER_API_KEY must be configured");
    }

    throw new ReceiptAIError();
}
