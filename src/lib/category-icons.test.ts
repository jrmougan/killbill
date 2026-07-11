import { describe, it, expect } from "vitest";
import { ICON_REGISTRY, ICON_KEYS, getIconComponent, isValidIconName, FALLBACK_ICON } from "./category-icons";
import { CATEGORIES } from "./categories";

/**
 * The 8 system-category icon NAMES (as persisted in Category.icon / prisma seed).
 * If any of these drops out of ICON_REGISTRY, the DB-driven render of the system
 * categories themselves silently falls back — guard it here.
 */
const SYSTEM_ICON_NAMES = [
    "ShoppingBag",
    "Coffee",
    "Home",
    "Lightbulb",
    "TramFront",
    "Clapperboard",
    "Heart",
    "Receipt",
] as const;

describe("ICON_REGISTRY", () => {
    it("includes every system-category icon name", () => {
        for (const name of SYSTEM_ICON_NAMES) {
            expect(ICON_REGISTRY[name], `missing system icon: ${name}`).toBeDefined();
            expect(isValidIconName(name)).toBe(true);
        }
    });

    it("exposes each system category's iconName and derives its component from the registry", () => {
        for (const cat of Object.values(CATEGORIES)) {
            expect(SYSTEM_ICON_NAMES).toContain(cat.iconName as (typeof SYSTEM_ICON_NAMES)[number]);
            expect(cat.icon).toBe(ICON_REGISTRY[cat.iconName]);
        }
    });

    it("curates a picker set of ~30-40 icons", () => {
        expect(ICON_KEYS.length).toBeGreaterThanOrEqual(30);
        expect(ICON_KEYS.length).toBeLessThanOrEqual(45);
    });

    it("ICON_KEYS matches the registry keys and every entry is a component", () => {
        expect(ICON_KEYS).toEqual(Object.keys(ICON_REGISTRY));
        for (const key of ICON_KEYS) {
            // lucide-react components are forwardRef objects, not plain functions.
            expect(ICON_REGISTRY[key], `not renderable: ${key}`).toBeTruthy();
            expect(["function", "object"]).toContain(typeof ICON_REGISTRY[key]);
        }
    });
});

describe("getIconComponent", () => {
    it("resolves a known name to its component", () => {
        expect(getIconComponent("ShoppingBag")).toBe(ICON_REGISTRY.ShoppingBag);
    });

    it("falls back safely for unknown / empty names", () => {
        expect(getIconComponent("NotARealIcon")).toBe(FALLBACK_ICON);
        expect(getIconComponent("")).toBe(FALLBACK_ICON);
        expect(getIconComponent(null)).toBe(FALLBACK_ICON);
        expect(getIconComponent(undefined)).toBe(FALLBACK_ICON);
    });
});
