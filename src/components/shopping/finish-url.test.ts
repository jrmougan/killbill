import { describe, expect, it } from "vitest";
import { buildFinishExpenseUrl, GROCERIES_CATEGORY_KEY } from "./finish-url";

describe("buildFinishExpenseUrl", () => {
    it("prefills a group list's space, title, groceries category and return path", () => {
        const url = new URL(buildFinishExpenseUrl({ id: "l1", name: "Mercadona & Co", groupId: "g1" }), "http://x");
        expect(url.pathname).toBe("/expenses/new");
        expect(url.searchParams.get("title")).toBe("Mercadona & Co");
        expect(url.searchParams.get("category")).toBe(GROCERIES_CATEGORY_KEY);
        expect(url.searchParams.get("space")).toBe("g1");
        expect(url.searchParams.get("returnTo")).toBe("/lists/l1");
        expect(url.searchParams.get("scan")).toBe("1");
    });

    it("uses the personal space for personal lists", () => {
        const url = new URL(buildFinishExpenseUrl({ id: "l2", name: "Farmacia", groupId: null }), "http://x");
        expect(url.searchParams.get("space")).toBe("personal");
    });

    it("targets a seeded system category", () => {
        expect(GROCERIES_CATEGORY_KEY).toBe("shopping");
    });
});
