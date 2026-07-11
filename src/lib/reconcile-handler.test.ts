import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetListWithItems = vi.fn();
const mockReconcile = vi.fn();
const mockRateLimit = vi.fn();

vi.mock("./list-read", () => ({ getListWithItems: (...a: unknown[]) => mockGetListWithItems(...a) }));
vi.mock("./receipt-reconcile", () => ({ reconcileReceiptWithItems: (...a: unknown[]) => mockReconcile(...a) }));
vi.mock("./rate-limit", () => ({ rateLimit: (...a: unknown[]) => mockRateLimit(...a) }));
// A valid receipt image by construction — keep the handler test focused on
// reconciliation logic, not the byte sniffing (covered by receipt-image tests).
vi.mock("./receipt-image", () => ({
    isAllowedImage: () => true,
    ALLOWED_IMAGE_TYPES: ["image/png", "image/jpeg", "image/webp"],
    MAX_IMAGE_BYTES: 8 * 1024 * 1024,
}));

import { runReconcile } from "./reconcile-handler";
import type { ListWriteScope } from "./list-crud";

const SCOPE: ListWriteScope = { kind: "owner", ownerId: "u1" };

/** A minimal Request double carrying a one-image formData (avoids real multipart). */
function imageRequest(): Request {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "ticket.png", { type: "image/png" });
    const fd = new FormData();
    fd.append("image", file);
    return { formData: async () => fd } as unknown as Request;
}

/** A Request double with NO image field. */
function emptyRequest(): Request {
    return { formData: async () => new FormData() } as unknown as Request;
}

describe("runReconcile", () => {
    beforeEach(() => {
        [mockGetListWithItems, mockReconcile, mockRateLimit].forEach((m) => m.mockReset());
        mockRateLimit.mockReturnValue({ allowed: true });
        process.env.GEMINI_API_KEY = "test-key";
    });
    afterEach(() => {
        delete process.env.GEMINI_API_KEY;
    });

    it("degrades WITHOUT a Gemini key: 500 and never touches the list or model", async () => {
        delete process.env.GEMINI_API_KEY;
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(500);
        expect(mockGetListWithItems).not.toHaveBeenCalled();
        expect(mockReconcile).not.toHaveBeenCalled();
    });

    it("degrades gracefully with NO pending items: 200 empty matches, no paid call", async () => {
        mockGetListWithItems.mockResolvedValue({ items: [{ id: "i1", name: "leche", checked: true }] });
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ matches: [] });
        expect(mockReconcile).not.toHaveBeenCalled();
    });

    it("404s when the list is missing / out of scope", async () => {
        mockGetListWithItems.mockResolvedValue(null);
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(404);
        expect(mockReconcile).not.toHaveBeenCalled();
    });

    it("400s when no image is provided", async () => {
        mockGetListWithItems.mockResolvedValue({ items: [{ id: "i1", name: "leche", checked: false }] });
        const res = await runReconcile(emptyRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(400);
    });

    it("honours the rate limit (429) before spending a call", async () => {
        mockRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 42 });
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(429);
        expect(mockGetListWithItems).not.toHaveBeenCalled();
    });

    it("returns the model's matches on the happy path (only pending items are offered)", async () => {
        mockGetListWithItems.mockResolvedValue({
            items: [
                { id: "i1", name: "leche", checked: false },
                { id: "i2", name: "pan", checked: true }, // already bought → not offered
            ],
        });
        const matches = [{ itemId: "i1", name: "leche", matchedText: "LECHE DESN", confidence: 0.9 }];
        mockReconcile.mockResolvedValue(matches);
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ matches });
        // Only the pending item was passed to the matcher.
        const pendingArg = mockReconcile.mock.calls[0][3];
        expect(pendingArg).toEqual([{ id: "i1", name: "leche" }]);
    });

    it("surfaces a 502 when the Gemini call throws", async () => {
        mockGetListWithItems.mockResolvedValue({ items: [{ id: "i1", name: "leche", checked: false }] });
        mockReconcile.mockRejectedValue(new Error("boom"));
        const res = await runReconcile(imageRequest(), SCOPE, "l1", "u1");
        expect(res.status).toBe(502);
    });
});
