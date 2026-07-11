/**
 * Supermarket AISLE vocabulary for shopping-list items (Feature A).
 *
 * This is deliberately NOT the 8 expense categories: an item's aisle does an
 * ORTHOGONAL job — organizing the physical walk through the shop, not classifying
 * spend for reports (the receipt OCR owns the expense category). Rules (plan §3):
 *  1. Aisle is PER ITEM (never per list, never free text).
 *  2. A brand-new PASILLO vocabulary (reusing the Category system's icon+color
 *     idea, not its keys).
 *  3. NULLABLE and AUTO-ASSIGNED (by name); never a mandatory toll at capture.
 *
 * Kept as a small static const table (like the system-category seed) instead of a
 * DB-backed Category scope: no migration/seed, and grouping/sorting stays a pure
 * client concern. `sortOrder` fixes the aisle order in the detail view.
 */

export interface Aisle {
    /** Stable slug persisted in `ShoppingListItem.aisle`. */
    key: string;
    label: string;
    emoji: string;
    /** Order the aisle appears in when items are grouped (mirrors a shop layout). */
    sortOrder: number;
    /** Lowercase, accent-free substrings that auto-assign this aisle from a name. */
    keywords: string[];
}

/**
 * The aisle vocabulary. "Otros" is a selectable bucket (last) but auto-assign
 * never forces it — an unmatched item stays `null` (truly optional).
 */
export const AISLES: readonly Aisle[] = [
    {
        key: "fruta_verdura",
        label: "Fruta y verdura",
        emoji: "🥦",
        sortOrder: 1,
        keywords: [
            "fruta", "verdura", "manzana", "platano", "banana", "naranja", "limon", "pera",
            "uva", "fresa", "melon", "sandia", "tomate", "lechuga", "cebolla", "ajo", "patata",
            "zanahoria", "pepino", "pimiento", "calabacin", "brocoli", "espinaca", "aguacate",
            "champinon", "seta", "kiwi", "mandarina", "apio", "puerro", "berenjena",
        ],
    },
    {
        key: "lacteos",
        label: "Lácteos y huevos",
        emoji: "🥛",
        sortOrder: 2,
        keywords: [
            "leche", "yogur", "queso", "mantequilla", "nata", "huevo", "huevos", "cuajada",
            "batido", "kefir", "flan", "natillas", "margarina",
        ],
    },
    {
        key: "carne_pescado",
        label: "Carne y pescado",
        emoji: "🥩",
        sortOrder: 3,
        keywords: [
            "carne", "pollo", "pavo", "cerdo", "ternera", "filete", "bistec", "chuleta",
            "salchicha", "hamburguesa", "jamon", "chorizo", "bacon", "pescado", "salmon",
            "atun", "merluza", "gamba", "marisco", "bacalao", "sardina", "lomo", "costilla",
        ],
    },
    {
        key: "panaderia",
        label: "Panadería",
        emoji: "🥖",
        sortOrder: 4,
        keywords: [
            "pan", "barra", "baguette", "bolleria", "croissant", "napolitana", "magdalena",
            "bizcocho", "tostada", "pan de molde", "donut", "ensaimada", "empanada",
        ],
    },
    {
        key: "congelados",
        label: "Congelados",
        emoji: "🧊",
        sortOrder: 5,
        keywords: [
            "congelado", "helado", "pizza", "croqueta", "varitas", "guisantes congelados",
            "hielo", "polo",
        ],
    },
    {
        key: "despensa",
        label: "Despensa",
        emoji: "🥫",
        sortOrder: 6,
        keywords: [
            "arroz", "pasta", "macarrones", "espagueti", "harina", "azucar", "sal", "aceite",
            "vinagre", "conserva", "lata", "legumbre", "garbanzo", "lenteja", "alubia",
            "cereal", "galleta", "chocolate", "cafe", "te", "mermelada", "miel", "salsa",
            "tomate frito", "caldo", "especia", "snack", "patatas fritas", "frutos secos",
        ],
    },
    {
        key: "bebidas",
        label: "Bebidas",
        emoji: "🧃",
        sortOrder: 7,
        keywords: [
            "agua", "refresco", "cola", "zumo", "cerveza", "vino", "bebida", "gaseosa",
            "tonica", "energetica", "isotonica", "sidra",
        ],
    },
    {
        key: "drogueria",
        label: "Droguería e higiene",
        emoji: "🧼",
        sortOrder: 8,
        keywords: [
            "papel", "higienico", "servilleta", "detergente", "suavizante", "lejia",
            "limpiador", "friegasuelos", "lavavajillas", "jabon", "champu", "gel", "pasta de dientes",
            "cepillo", "desodorante", "compresa", "panal", "bolsa de basura", "estropajo", "bayeta",
        ],
    },
    {
        key: "otros",
        label: "Otros",
        emoji: "🛒",
        sortOrder: 99,
        keywords: [],
    },
];

const BY_KEY = new Map(AISLES.map((a) => [a.key, a]));

/** Ordered list of aisle keys (for pickers / validation). */
export const AISLE_KEYS: string[] = AISLES.map((a) => a.key);

/** Look up an aisle's metadata by key (undefined if unknown). */
export function getAisle(key: string | null | undefined): Aisle | undefined {
    if (!key) return undefined;
    return BY_KEY.get(key);
}

/** Validate + normalize a raw key against the vocabulary; null if not a valid aisle. */
export function normalizeAisle(raw: string): string | null {
    const key = raw.trim().toLowerCase();
    return BY_KEY.has(key) ? key : null;
}

/** Strip accents + lowercase for keyword matching. */
function fold(s: string): string {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Best-effort auto-assign an aisle from an item name by keyword match. Returns the
 * matching aisle key or `null` (never "otros") so an unmatched item stays truly
 * optional. Longer keywords win, so "tomate frito" (despensa) beats "tomate"
 * (fruta_verdura) when both would match.
 */
export function autoAssignAisle(name: string): string | null {
    const folded = fold(name);
    let best: { key: string; len: number } | null = null;
    for (const aisle of AISLES) {
        for (const kw of aisle.keywords) {
            if (folded.includes(kw) && (!best || kw.length > best.len)) {
                best = { key: aisle.key, len: kw.length };
            }
        }
    }
    return best ? best.key : null;
}
