import { describe, it, expect, vi, afterEach } from "vitest";
import {
    buildReconcilePrompt,
    parseReconcileResponse,
    reconcileReceiptWithItems,
    type PendingItem,
} from "./receipt-reconcile";

const ITEMS: PendingItem[] = [
    { id: "a", name: "leche" },
    { id: "b", name: "pan" },
    { id: "c", name: "huevos" },
];

describe("buildReconcilePrompt", () => {
    it("numbers the items 1..n", () => {
        const p = buildReconcilePrompt(ITEMS);
        expect(p).toContain("1. leche");
        expect(p).toContain("2. pan");
        expect(p).toContain("3. huevos");
        expect(p).toContain("(1..3)");
    });
});

describe("parseReconcileResponse", () => {
    it("maps valid indices back to item ids", () => {
        const text = JSON.stringify({ matches: [{ index: 1, receiptText: "LECHE DESN", confidence: 0.9 }] });
        const out = parseReconcileResponse(text, ITEMS);
        expect(out).toEqual([{ itemId: "a", name: "leche", matchedText: "LECHE DESN", confidence: 0.9 }]);
    });

    it("strips a ```json code fence", () => {
        const text = "```json\n{\"matches\":[{\"index\":2}]}\n```";
        const out = parseReconcileResponse(text, ITEMS);
        expect(out.map((m) => m.itemId)).toEqual(["b"]);
        expect(out[0].confidence).toBe(0.5); // default when omitted
    });

    it("ignores out-of-range and duplicate indices", () => {
        const text = JSON.stringify({ matches: [{ index: 0 }, { index: 9 }, { index: 1 }, { index: 1 }] });
        const out = parseReconcileResponse(text, ITEMS);
        expect(out.map((m) => m.itemId)).toEqual(["a"]);
    });

    it("clamps confidence into [0,1] and truncates long receipt text", () => {
        const long = "x".repeat(200);
        const text = JSON.stringify({ matches: [{ index: 1, confidence: 5, receiptText: long }] });
        const [m] = parseReconcileResponse(text, ITEMS);
        expect(m.confidence).toBe(1);
        expect(m.matchedText.length).toBe(120);
    });

    it("returns [] on unparseable JSON", () => {
        expect(parseReconcileResponse("not json", ITEMS)).toEqual([]);
        expect(parseReconcileResponse("{}", ITEMS)).toEqual([]);
    });
});

describe("reconcileReceiptWithItems (Gemini client, stubbed fetch)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Shape a Gemini generateContent success response wrapping `text`. */
    function geminiOk(text: string) {
        return {
            ok: true,
            json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
        } as unknown as Response;
    }

    it("short-circuits with no items and never calls the API", async () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const out = await reconcileReceiptWithItems("key", "b64", "image/png", []);
        expect(out).toEqual([]);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("maps a successful Gemini match back to item ids", async () => {
        const body = JSON.stringify({ matches: [{ index: 1, receiptText: "LECHE DESN", confidence: 0.9 }] });
        vi.spyOn(globalThis, "fetch").mockResolvedValue(geminiOk(body));
        const out = await reconcileReceiptWithItems("key", "b64", "image/png", ITEMS);
        expect(out).toEqual([{ itemId: "a", name: "leche", matchedText: "LECHE DESN", confidence: 0.9 }]);
    });

    it("returns [] when Gemini yields no text content (graceful)", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            json: async () => ({ candidates: [] }),
        } as unknown as Response);
        expect(await reconcileReceiptWithItems("key", "b64", "image/png", ITEMS)).toEqual([]);
    });

    it("throws on a hard API failure so the route can surface an error", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
        await expect(reconcileReceiptWithItems("key", "b64", "image/png", ITEMS)).rejects.toThrow(/503/);
    });
});
