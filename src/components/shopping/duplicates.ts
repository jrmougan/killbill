import { MAX_QUANTITY } from "@/lib/list-quantity";

/** "  Leché  " → "leche": case-, accent- and spacing-insensitive item key. */
export function itemKey(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/** A PENDING item with the same name (ticked-off ones may legitimately be re-added). */
export function findDuplicate<T extends { name: string; checked: boolean }>(items: T[], name: string): T | undefined {
    const key = itemKey(name);
    if (!key) return undefined;
    return items.find((i) => !i.checked && itemKey(i.name) === key);
}

/** Quantity after "Sumar 1": no quantity counts as 1 → 2; null when over the max. */
export function bumpedQuantity(current: number | null): number | null {
    const next = (current ?? 1) + 1;
    return next > MAX_QUANTITY ? null : Math.round(next * 1000) / 1000;
}
