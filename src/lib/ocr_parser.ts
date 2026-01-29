import { ReceiptItem } from "@/types";

export interface OCRParseResult {
    amount: string;
    description: string;
    items: ReceiptItem[];
}

export function parseOCRText(text: string): OCRParseResult {
    const lines = text.split('\n');
    let foundAmount = "";
    let foundDescription = "";
    const detectedItems: ReceiptItem[] = [];

    // Regex for price at the end of the line:  ... 12.34 or ... 12,34 A or .12 A (Alcampo format)
    const priceRegex = /\s(\d*[.,]\d{2})(?:\s*[A-Z])?$/;
    // Regex for quantity: 2 x 1.50 or 2x1.50
    const qtyRegex = /(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+[.,]\d{2})/;

    // Ignore common garbage lines (addresses, headers, payment methods)
    // Include common OCR misreads: TARJETA -> TAREA/TARJE, CAMBIO -> CANBIO/CANBI
    const ignoredKeywords = [
        'cif', 'nif', 'tel', 'calle', 'plaza', 'avda',
        'factura', 'ticket', 'fecha', 'hora',
        'total', 'tot', 'entregado',
        'cambio', 'canbio', 'canbi',  // OCR variations
        'tarjeta', 'tarea', 'tarje',  // OCR variations
        'efectivo', 'efect',
        'vendidos', 'num.', 'art.',
        'iva', 'base'
    ];

    for (const line of lines) {
        const cleanLine = line.trim();
        const lowerLine = cleanLine.toLowerCase();
        if (cleanLine.length < 5) continue; // Too short

        // Check for total FIRST (includes TOT for Alcampo) - before filtering € lines
        // Handles: "TOTAL 40,18", "€ TOT 40,18", "€* TOT 40,18", "TOT 40,18"
        const amountMatch = cleanLine.match(/(?:total|tot|importe)\s*[:=*]?\s*(\d+[.,]\d{2})/i)
            || cleanLine.match(/^[€e]\s*\*?\s*tot\s+(\d+[.,]\d{2})/i); // € TOT 40,18 format
        if (amountMatch) {
            foundAmount = amountMatch[1].replace(',', '.');
            continue; // Is total line, not item
        }

        // Skip lines that start with € symbol or are payment-related
        // Use regex to handle spaces and OCR variations
        if (/^[€e]\s*\*?\s*(tarea|tarjeta|tarje|canbio|cambio|canbi)/i.test(cleanLine)) continue;
        if (/^[€e]\s+/i.test(cleanLine)) continue; // Lines starting with € or E followed by space

        // Check for item
        // 1. Check if it ends with a price
        const priceMatch = cleanLine.match(priceRegex);
        if (priceMatch && !ignoredKeywords.some(k => lowerLine.includes(k))) {
            let price = parseFloat(priceMatch[1].replace(',', '.'));
            let desc = cleanLine.replace(priceMatch[0], '').trim();
            let qty = 1;
            let unitPrice = price;

            // 2. Check for quantity pattern inside description
            const qtyMatch = cleanLine.match(qtyRegex);
            if (qtyMatch) {
                qty = parseFloat(qtyMatch[1].replace(',', '.'));
                unitPrice = parseFloat(qtyMatch[2].replace(',', '.'));
                // Clean desc further
                desc = desc.replace(qtyMatch[0], '').trim();
            }

            // Clean leading junk characters from description (OCR artifacts)
            desc = desc.replace(/^[>\-*#]+\s*/, '').trim();

            // Heuristic: If description is purely symbols or numbers, ignore
            if (!/^[\d\W]+$/.test(desc) && desc.length > 2) {
                detectedItems.push({
                    description: desc,
                    quantity: qty,
                    price: unitPrice,
                    total: price,
                    assignedTo: null // Shared by default
                });
            }
        }
    }

    // Fallback for amount if not found (look for highest number, usually total)
    if (!foundAmount && detectedItems.length > 0) {
        // Sum of items
        const sum = detectedItems.reduce((acc, item) => acc + item.total, 0);
        foundAmount = sum.toFixed(2);
    } else if (!foundAmount) {
        // Old fallback
        const fallbackAmountRegex = /(\d+[.,]\d{2})/;
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(fallbackAmountRegex);
            if (match) {
                foundAmount = match[1].replace(',', '.');
                break;
            }
        }
    }

    // Fallback description
    if (lines.length > 0) {
        // find first non-empty line
        const firstLine = lines.find(l => l.trim().length > 3);
        if (firstLine) foundDescription = firstLine.trim();
    }

    return {
        amount: foundAmount,
        description: foundDescription,
        items: detectedItems
    };
}
