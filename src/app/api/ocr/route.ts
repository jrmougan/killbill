import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-flash-latest';

interface ReceiptItem {
    description: string;
    quantity: number;
    price: number;
    total: number;
    assignedTo: string | null;
}

interface OCRResponse {
    store?: string;
    category?: string;
    items: ReceiptItem[];
    total: number;
    raw_text?: string;
}

export async function POST(request: Request) {
    const session = await getSession();
    if (!session?.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!GEMINI_API_KEY) {
        return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get('image') as File;

        if (!file) {
            return NextResponse.json({ error: 'No image provided' }, { status: 400 });
        }

        // Convert file to base64
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString('base64');
        const mimeType = file.type || 'image/jpeg';

        // Call Gemini Vision API
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                text: `Analiza este ticket de compra y extrae los productos en JSON.

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
  "other" = cualquier otra cosa

Formato JSON:
{"store":"TIENDA","category":"shopping","items":[{"description":"PRODUCTO","quantity":1,"price":2.50,"total":2.50}],"total":45.99}`
                            },
                            {
                                inline_data: {
                                    mime_type: mimeType,
                                    data: base64
                                }
                            }
                        ]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 8192,
                        responseMimeType: 'application/json',
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.text();
            console.error('Gemini API Error:', error);
            return NextResponse.json({ error: 'Failed to process image' }, { status: 500 });
        }

        const data = await response.json();
        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textContent) {
            return NextResponse.json({ error: 'No response from Gemini' }, { status: 500 });
        }

        // Parse JSON from response (handle potential markdown wrapper)
        let jsonStr = textContent.trim();
        if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
        jsonStr = jsonStr.trim();

        // Try to repair truncated JSON
        function tryParseJSON(str: string): OCRResponse | null {
            try {
                return JSON.parse(str);
            } catch {
                return null;
            }
        }

        let parsed = tryParseJSON(jsonStr);

        // If parse failed, try to repair truncated JSON
        if (!parsed) {
            console.warn('OCR: JSON truncated, attempting repair...');
            let repaired = jsonStr;

            // Remove trailing incomplete item (after last complete object)
            const lastCompleteItem = repaired.lastIndexOf('},');
            const lastCompleteItem2 = repaired.lastIndexOf('}]');
            const cutPoint = Math.max(lastCompleteItem, lastCompleteItem2);

            if (cutPoint > 0 && lastCompleteItem > lastCompleteItem2) {
                // Cut after last complete item in array, close the structure
                repaired = repaired.substring(0, cutPoint + 1) + '],"total":0}';
                parsed = tryParseJSON(repaired);
            }

            if (!parsed) {
                console.error('JSON repair failed. Raw:', jsonStr);
                return NextResponse.json({
                    error: 'El ticket es demasiado largo. Intenta con una foto más nítida.',
                    raw: textContent
                }, { status: 500 });
            }

            console.log('OCR: JSON repair succeeded, recovered', parsed.items?.length || 0, 'items');
        }

        // Ensure items have assignedTo field
        const items: ReceiptItem[] = (parsed.items || []).map(item => ({
            description: item.description || '',
            quantity: item.quantity || 1,
            price: item.price || 0,
            total: item.total || item.price || 0,
            assignedTo: null
        }));

        return NextResponse.json({
            success: true,
            store: parsed.store || '',
            category: parsed.category || '',
            items,
            total: parsed.total || 0
        });

    } catch (error) {
        console.error('OCR Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
