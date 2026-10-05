import { describe, it, expect } from "vitest";
import { normalizeAmountText, amountToCents } from "./amount-input";
import { initialSplitState } from "./quick-split";
import { receiptLinesCents, splitPayload } from "./form-payload";
import { computeSplit, seedSplitValue } from "@/components/expense/split-editor";

describe("normalizeAmountText (G-05: paste / free typing)", () => {
    it.each([
        ["", ""],
        ["12", "12"],
        ["12,", "12,"],
        ["12.5", "12,5"],
        ["25.50", "25,50"],
        ["1.234,56", "1234,56"],
        ["1,234.56", "1234,56"],
        ["12,50 €", "12,50"],
        [" 7 ", "7"],
        ["1.234", "1234"],
    ])("%j → %j", (raw, amount) => {
        expect(normalizeAmountText(raw)).toEqual({ ok: true, amount });
    });

    it("never turns a pasted thousands amount into a smaller one", () => {
        const r = normalizeAmountText("1.234,56");
        expect(r.ok && amountToCents(r.amount)).toBe(123456);
    });

    it.each(["1,234", "12,345", "1.2.3", "abc", "-5", "1,2,3,4"])("rejects %j with a visible error", (raw) => {
        const r = normalizeAmountText(raw);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/Importe no válido/);
    });

    it("rejects amounts over the 999.999,99 € ceiling", () => {
        expect(normalizeAmountText("1.000.000,00")).toEqual({ ok: false, error: "El importe máximo es 999.999,99 €" });
    });
});

const me = { id: "me", name: "Yo" };
const lu = { id: "lu", name: "Lucía" };
const da = { id: "da", name: "Dani" };

describe("initialSplitState (edit form hydration)", () => {
    it("EQUAL → equal tile", () => {
        expect(initialSplitState("EQUAL", [], [me, lu], "me", 1000).choice).toBe("equal");
    });
    it("EXCLUSIVE to me / to the partner → mine / theirs", () => {
        expect(initialSplitState("EXCLUSIVE", [{ userId: "me", amount: 1000 }], [me, lu], "me", 1000).choice).toBe("mine");
        expect(initialSplitState("EXCLUSIVE", [{ userId: "lu", amount: 1000 }], [me, lu], "me", 1000).choice).toBe("theirs");
    });
    it("EXCLUSIVE to one of several others → custom editor on that beneficiary", () => {
        const s = initialSplitState("EXCLUSIVE", [{ userId: "da", amount: 900 }], [me, lu, da], "me", 900);
        expect(s.choice).toBe("custom");
        expect(s.value).toMatchObject({ mode: "exclusive", beneficiaryId: "da" });
    });
    it("CUSTOM equal to 'los demás' in a group → theirs tile", () => {
        const s = initialSplitState("CUSTOM", [{ userId: "lu", amount: 500 }, { userId: "da", amount: 500 }], [me, lu, da], "me", 1000);
        expect(s.choice).toBe("theirs");
    });
    it("any other CUSTOM → custom editor with the persisted amounts", () => {
        const s = initialSplitState("CUSTOM", [{ userId: "me", amount: 300 }, { userId: "lu", amount: 700 }], [me, lu], "me", 1000);
        expect(s.choice).toBe("custom");
        expect(computeSplit(s.value, [me, lu], 1000).shares).toEqual({ me: 300, lu: 700 });
    });
});

describe("splitPayload", () => {
    const members = [me, lu];
    const base = { isShared: true, itemized: false, members, meId: "me", totalCents: 1000 };
    const eq = computeSplit(seedSplitValue("equal", members, 1000), members, 1000);

    it("itemized receipts send no split: the API derives ITEMIZED from the lines (G-16)", () => {
        expect(splitPayload({ ...base, mode: "create", itemized: true, choice: "equal", custom: eq })).toEqual({});
    });
    it("equal: nothing on create, splitEqual on edit", () => {
        expect(splitPayload({ ...base, mode: "create", choice: "equal", custom: eq })).toEqual({});
        expect(splitPayload({ ...base, mode: "edit", choice: "equal", custom: eq })).toEqual({ splitEqual: true });
    });
    it("quick mine / theirs → beneficiary", () => {
        expect(splitPayload({ ...base, mode: "create", choice: "mine", custom: eq })).toEqual({ beneficiaryId: "me" });
        expect(splitPayload({ ...base, mode: "edit", choice: "theirs", custom: eq })).toEqual({ beneficiaryId: "lu" });
    });
    it("custom amounts → customSplits", () => {
        const v = seedSplitValue("amounts", members, 1000);
        v.amounts = { me: "3", lu: "7" };
        const custom = computeSplit(v, members, 1000);
        expect(splitPayload({ ...base, mode: "create", choice: "custom", custom })).toEqual({
            customSplits: [{ userId: "me", amount: 300 }, { userId: "lu", amount: 700 }],
        });
    });
    it("personal → nothing", () => {
        expect(splitPayload({ ...base, isShared: false, mode: "edit", choice: "mine", custom: eq })).toEqual({});
    });
    it("receiptLinesCents sums euro lines without float drift", () => {
        expect(receiptLinesCents([{ total: 0.1 }, { total: 0.2 }, { total: 6.45 }])).toBe(675);
    });
});
