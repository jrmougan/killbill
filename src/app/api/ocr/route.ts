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
                                text: `Analiza este ticket de supermercado español y extrae la información en JSON.
                                
IMPORTANTE:
- Extrae TODOS los productos con sus precios
- El precio de cada producto es el número que aparece al final de cada línea
- Ignora líneas de IVA, subtotales parciales, métodos de pago (TARJETA, EFECTIVO, CAMBIO)
- El total es la cantidad final pagada (busca "TOTAL", "TOT", o el número más grande al final)
- Los precios en España usan coma como separador decimal (ej: 2,50€)

Responde SOLO con JSON válido, sin markdown ni explicaciones:
{
    "store": "nombre de la tienda si aparece",
    "items": [
        {"description": "NOMBRE DEL PRODUCTO", "quantity": 1, "price": 2.50, "total": 2.50}
    ],
    "total": 45.99
}

Si hay cantidades tipo "2 x 1,50", cantidad=2, price=1.50, total=3.00`
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
                        maxOutputTokens: 2048,
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
        if (jsonStr.startsWith('```json')) {
            jsonStr = jsonStr.slice(7);
        }
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.slice(3);
        }
        if (jsonStr.endsWith('```')) {
            jsonStr = jsonStr.slice(0, -3);
        }
        jsonStr = jsonStr.trim();

        try {
            const parsed: OCRResponse = JSON.parse(jsonStr);

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
                items,
                total: parsed.total || 0
            });

        } catch (parseError) {
            console.error('JSON parse error:', parseError, 'Raw:', jsonStr);
            return NextResponse.json({
                error: 'Failed to parse receipt data',
                raw: textContent
            }, { status: 500 });
        }

    } catch (error) {
        console.error('OCR Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
