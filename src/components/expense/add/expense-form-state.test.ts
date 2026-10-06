import { describe, expect, it } from "vitest";
import {
    buildExpenseBody, deriveSplit, formReducer, initFormState, mirrorQuickSplit, nextQuickSplit, preSaveCheck,
    receiptLines, spaceMembers, tagDiff, withParam,
    type AddSpace, type ExpenseFormInitial, type FormAction, type FormState,
} from "./expense-form-state";
import { withUid } from "./receipt-items-editor";

const me = { id: "me", name: "Yo", avatar: null };
const lu = { id: "lu", name: "Lucía", avatar: null };
const da = { id: "da", name: "Dani", avatar: null };
const couple: AddSpace = { id: "c1", name: "Casa", type: "COUPLE", members: [me, lu] };
const group: AddSpace = { id: "g1", name: "Piso", type: "GROUP", members: [me, lu, da] };
const spaces = [couple, group];
const TODAY = "2026-10-06";

const fresh = (over: Partial<Parameters<typeof initFormState>[0]> = {}) =>
    initFormState({ userId: "me", spaces, initialSpace: "c1", today: TODAY, ...over });

const run = (state: FormState, ...actions: FormAction[]) => actions.reduce(formReducer, state);

const editInitial: ExpenseFormInitial = {
    expenseId: "e1",
    amountCents: 1250,
    description: "Cena",
    category: "food",
    date: "2026-10-01",
    notes: "nota",
    tagIds: ["t1"],
    isRecurring: true,
    recurringInterval: "weekly",
    paidById: "lu",
    splitStrategy: "EXCLUSIVE",
    splits: [{ userId: "me", amount: 1250 }],
    receiptItems: [{ description: "Pan", quantity: 1, price: 2, total: 2 }],
    receiptUrl: "/uploads/r.jpg",
};

describe("initFormState", () => {
    it("create mode: empty amount, today, me as payer, equal split, prefilled title/category preference", () => {
        const s = fresh({ initialTitle: "Mercadona", initialCategory: "shopping" });
        expect(s).toMatchObject({
            spaceId: "c1", amount: "", description: "Mercadona", category: null,
            preferredCategory: "shopping", categoryTouched: true, payerId: "me",
            splitChoice: "equal", date: TODAY, mode: "form", saving: false, receiptPreview: null,
        });
    });

    it("an untouched create form lets the OCR pick the category", () => {
        expect(fresh().categoryTouched).toBe(false);
    });

    it("edit mode hydrates from the persisted expense", () => {
        const s = fresh({ initial: editInitial });
        expect(s).toMatchObject({
            amount: "12,50", description: "Cena", category: "food", preferredCategory: "food", categoryTouched: true,
            payerId: "lu", splitChoice: "mine", date: "2026-10-01", notes: "nota", selectedTagIds: ["t1"],
            isRecurring: true, recurringInterval: "weekly", receiptPreview: "/uploads/r.jpg", storedReceiptUrl: "/uploads/r.jpg",
        });
        expect(s.receiptItems).toHaveLength(1);
        expect(s.receiptItems[0]._uid).toBeTruthy();
    });

    it("spaceMembers: personal and unknown spaces have no members", () => {
        expect(spaceMembers(spaces, "personal")).toEqual([]);
        expect(spaceMembers(spaces, "nope")).toEqual([]);
        expect(spaceMembers(spaces, "g1")).toHaveLength(3);
    });
});

describe("formReducer — amount", () => {
    it("numpad keys build the amount and clear a previous error", () => {
        const s = run({ ...fresh(), amountError: "x" }, { type: "amountKey", key: "1" }, { type: "amountKey", key: "," }, { type: "amountKey", key: "5" });
        expect(s.amount).toBe("1,5");
        expect(s.amountError).toBeNull();
    });

    it("typed text is normalized, an invalid one keeps the previous amount (G-05)", () => {
        let s = run(fresh(), { type: "amountTyped", raw: "1.234,56" });
        expect(s.amount).toBe("1234,56");
        s = run(s, { type: "amountTyped", raw: "abc" });
        expect(s.amount).toBe("1234,56");
        expect(s.amountError).toMatch(/Importe no válido/);
    });
});

describe("formReducer — categories (G-14/G-15)", () => {
    it("reconciles to the preference, else the current, else the first key", () => {
        const pref = fresh({ initialCategory: "shopping" });
        expect(run(pref, { type: "categoriesChanged", keys: ["food", "shopping"] }).category).toBe("shopping");
        const cur = { ...fresh(), category: "food" };
        expect(run(cur, { type: "categoriesChanged", keys: ["home", "food"] }).category).toBe("food");
        expect(run(fresh(), { type: "categoriesChanged", keys: ["home", "food"] }).category).toBe("home");
    });

    it("ignores an empty set (still loading)", () => {
        const s = { ...fresh(), category: "food" };
        expect(run(s, { type: "categoriesChanged", keys: [] })).toBe(s);
    });

    it("a picked category survives switching to a space that lacks it and back", () => {
        let s = run(fresh(), { type: "categoryPicked", key: "pets" });
        s = run(s, { type: "categoriesChanged", keys: ["food", "home"] });
        expect(s.category).toBe("food");
        s = run(s, { type: "categoriesChanged", keys: ["food", "pets"] });
        expect(s.category).toBe("pets");
    });

    it("OCR fills the category only while untouched", () => {
        const scan: FormAction = { type: "scanSucceeded", items: [], total: 10, store: null, category: "shopping" };
        expect(run({ ...fresh(), category: "food" }, scan).category).toBe("shopping");
        expect(run(run(fresh(), { type: "categoryPicked", key: "food" }), scan).category).toBe("food");
    });
});

describe("formReducer — space and split", () => {
    it("changing space resets payer, split and tags", () => {
        let s = run(fresh(), { type: "amountTyped", raw: "30" }, { type: "payerChanged", payerId: "lu" },
            { type: "splitChoiceChanged", choice: "mine" }, { type: "tagToggled", id: "t1" });
        s = run(s, { type: "spaceChanged", spaceId: "g1", userId: "me", members: group.members });
        expect(s).toMatchObject({ spaceId: "g1", payerId: "me", splitChoice: "equal", selectedTagIds: [] });
        expect(s.splitValue.amounts).toEqual({ me: "10", lu: "10", da: "10" });
    });

    it("selecting the same space is a no-op", () => {
        const s = fresh();
        expect(run(s, { type: "spaceChanged", spaceId: "c1", userId: "me", members: couple.members })).toBe(s);
    });

    it("editing the custom split switches to custom", () => {
        const v = { mode: "exclusive" as const, amounts: {}, percents: {}, beneficiaryId: "lu" };
        expect(run(fresh(), { type: "customSplitEdited", value: v })).toMatchObject({ splitChoice: "custom", splitValue: v });
    });

    it("opening Más opciones optionally mirrors the quick split", () => {
        const s = fresh();
        expect(run(s, { type: "moreOpened" })).toMatchObject({ moreOpen: true, splitValue: s.splitValue });
        const v = { mode: "exclusive" as const, amounts: {}, percents: {}, beneficiaryId: "me" };
        expect(run(s, { type: "moreOpened", splitValue: v }).splitValue).toBe(v);
        expect(run(s, { type: "moreOpened" }, { type: "moreClosed" }).moreOpen).toBe(false);
    });

    it("nextQuickSplit cycles and restarts from custom", () => {
        const order = ["equal", "mine", "theirs"] as const;
        expect(nextQuickSplit([...order], "equal")).toBe("mine");
        expect(nextQuickSplit([...order], "theirs")).toBe("equal");
        expect(nextQuickSplit([...order], "custom")).toBe("equal");
    });

    it("mirrorQuickSplit seeds the editor from the quick choice", () => {
        expect(mirrorQuickSplit("custom", couple.members, "me", 1000, {})).toBeNull();
        expect(mirrorQuickSplit("equal", couple.members, "me", 1000, {})?.mode).toBe("equal");
        expect(mirrorQuickSplit("mine", couple.members, "me", 1000, {})).toMatchObject({ mode: "exclusive", beneficiaryId: "me" });
        expect(mirrorQuickSplit("theirs", couple.members, "me", 1000, {})).toMatchObject({ mode: "exclusive", beneficiaryId: "lu" });
        const g = mirrorQuickSplit("theirs", group.members, "me", 1000, { lu: 500, da: 500 });
        expect(g).toMatchObject({ mode: "amounts", amounts: { me: "0", lu: "5", da: "5" } });
    });
});

describe("formReducer — receipt / OCR", () => {
    const pan = withUid({ description: "Pan", quantity: 1, price: 2.5, total: 2.5 });
    const leche = withUid({ description: "Leche", quantity: 2, price: 1, total: 2 });

    it("receipt lines drive the total; removing them all keeps the amount", () => {
        let s = run(fresh(), { type: "itemsChanged", items: [pan, leche] });
        expect(s.amount).toBe("4,50");
        s = run(s, { type: "itemsChanged", items: [] });
        expect(s).toMatchObject({ amount: "4,50", receiptItems: [] });
    });

    it("scan flow: start → success fills lines, empty concept and scanned flag", () => {
        let s = run(fresh(), { type: "fileChosen", file: new File([""], "t.jpg"), preview: "blob:x" }, { type: "scanStarted" });
        expect(s).toMatchObject({ mode: "scan", ocrError: null, receiptPreview: "blob:x", scanHint: false });
        s = run(s, { type: "scanSucceeded", items: [pan], total: 99, store: "Mercadona", category: null });
        expect(s).toMatchObject({ mode: "form", scanned: true, amount: "2,50", description: "Mercadona" });
    });

    it("scan without lines uses the total and never overwrites a typed concept", () => {
        const s = run(fresh({ initialTitle: "Compra" }), { type: "scanSucceeded", items: [], total: 12.34, store: "Dia", category: null });
        expect(s).toMatchObject({ amount: "12,34", description: "Compra" });
    });

    it("a failed scan goes back to the form with the error", () => {
        const s = run(fresh(), { type: "scanStarted" }, { type: "scanFailed", error: "No se pudo leer el ticket." });
        expect(s).toMatchObject({ mode: "form", ocrError: "No se pudo leer el ticket." });
    });

    it("discarding / cancelling drops the file, the stored url and the scanned flag", () => {
        const withReceipt = run(fresh({ initial: editInitial }), { type: "scanSucceeded", items: [], total: null, store: null, category: null });
        expect(run(withReceipt, { type: "receiptDiscarded" })).toMatchObject({
            receiptFile: null, storedReceiptUrl: null, receiptPreview: null, scanned: false,
        });
        expect(run(withReceipt, { type: "scanStarted" }, { type: "scanCancelled" })).toMatchObject({ mode: "form", receiptPreview: null });
    });
});

describe("formReducer — options, tags and submit", () => {
    it("notes are capped at 500 characters", () => {
        expect(run(fresh(), { type: "notesChanged", notes: "x".repeat(600) }).notes).toHaveLength(500);
    });

    it("tags toggle and a created tag is added and selected, closing the draft", () => {
        let s = run(fresh(), { type: "tagToggled", id: "a" }, { type: "tagToggled", id: "b" }, { type: "tagToggled", id: "a" });
        expect(s.selectedTagIds).toEqual(["b"]);
        s = run(s, { type: "newTagDraft", draft: { open: true, name: "Viaje" } }, { type: "newTagDraft", draft: { color: "#ec4899" } });
        expect(s.newTag).toEqual({ open: true, name: "Viaje", color: "#ec4899" });
        s = run(s, { type: "tagCreated", tag: { id: "t9", name: "Viaje", color: "#ec4899" } });
        expect(s.selectedTagIds).toEqual(["b", "t9"]);
        expect(s.tags.map((t) => t.id)).toEqual(["t9"]);
        expect(s.newTag).toEqual({ open: false, name: "", color: "#ec4899" });
    });

    it("recurrence toggles and keeps the interval", () => {
        const s = run(fresh(), { type: "recurringToggled" }, { type: "intervalChanged", interval: "yearly" });
        expect(s).toMatchObject({ isRecurring: true, recurringInterval: "yearly" });
    });

    it("formError can reveal Más opciones; a failed save re-enables the button", () => {
        expect(run(fresh(), { type: "formError", error: "x", openMore: true })).toMatchObject({ formError: "x", moreOpen: true });
        expect(run(fresh(), { type: "formError", error: "x" }).moreOpen).toBe(false);
        expect(run(fresh(), { type: "saveStarted" }, { type: "saveFailed", error: "boom" })).toMatchObject({ saving: false, formError: "boom" });
    });
});

describe("deriveSplit", () => {
    it("couple, equal split paid by me → partner owes half", () => {
        const v = deriveSplit({ state: fresh(), members: couple.members, userId: "me", isShared: true, partnerId: "lu", totalCents: 2000 });
        expect(v).toMatchObject({ itemized: false, splitLabel: "A medias" });
        expect(v.preview).toMatch(/^Lucía te deberá 10,00\s€ más$/);
    });

    it("itemized lines override the split and a mismatch hides the preview", () => {
        const items = [withUid({ description: "A", quantity: 1, price: 6, total: 6, assignedTo: "lu" }), withUid({ description: "B", quantity: 1, price: 4, total: 4 })];
        const state = { ...fresh(), receiptItems: items };
        const ok = deriveSplit({ state, members: couple.members, userId: "me", isShared: true, partnerId: "lu", totalCents: 1000 });
        expect(ok).toMatchObject({ itemized: true, splitLabel: "Por productos", shares: { me: 200, lu: 800 }, linesMismatch: false });
        expect(ok.preview).toMatch(/^Lucía te deberá 8,00\s€ más$/);
        const bad = deriveSplit({ state, members: couple.members, userId: "me", isShared: true, partnerId: "lu", totalCents: 1200 });
        expect(bad).toMatchObject({ linesMismatch: true, preview: "" });
    });

    it("personal → no options, no preview", () => {
        const v = deriveSplit({ state: fresh({ initialSpace: "personal" }), members: [], userId: "me", isShared: false, partnerId: null, totalCents: 500 });
        expect(v).toMatchObject({ splitOptions: [], preview: "", splitLabel: "" });
    });
});

describe("preSaveCheck", () => {
    const okSplit = deriveSplit({ state: fresh(), members: couple.members, userId: "me", isShared: true, partnerId: "lu", totalCents: 1000 });
    const base = { totalCents: 1000, split: okSplit, isShared: true, splitChoice: "equal" as const, date: TODAY, category: "food" };

    it("passes a valid form", () => {
        expect(preSaveCheck(base)).toBeNull();
    });
    it("empty amount → toast", () => {
        expect(preSaveCheck({ ...base, totalCents: 0 })).toEqual({ kind: "toast", message: "Introduce un importe" });
    });
    it("itemized mismatch → inline error", () => {
        const r = preSaveCheck({ ...base, split: { ...okSplit, itemized: true, linesMismatch: true, linesCents: 900 } });
        expect(r).toMatchObject({ kind: "error" });
        expect(r?.message).toMatch(/no coincide con la suma del desglose/);
    });
    it("invalid custom split → error opening Más opciones", () => {
        const r = preSaveCheck({ ...base, splitChoice: "custom", split: { ...okSplit, customResult: { ...okSplit.customResult, valid: false, reason: "Faltan 1,00 €" } } });
        expect(r).toEqual({ kind: "error", message: "Faltan 1,00 €", openMore: true });
    });
    it("out-of-range date → error opening Más opciones", () => {
        expect(preSaveCheck({ ...base, date: "1999-01-01" })).toMatchObject({ kind: "error", openMore: true });
    });
    it("no category → error", () => {
        expect(preSaveCheck({ ...base, category: null })).toEqual({ kind: "error", message: "Elige una categoría." });
    });
});

describe("buildExpenseBody", () => {
    const common = {
        totalCents: 1250, title: "Cena", category: "food", receiptUrl: null, isRecurring: false,
        recurringInterval: "monthly" as const, date: TODAY, today: TODAY, notes: "  ", lines: [],
        isPersonal: false, groupId: "c1", payerId: "lu", split: { beneficiaryId: "me" },
    };

    it("create (shared): explicit destination, payer and split; today's date omitted", () => {
        expect(buildExpenseBody(common)).toEqual({
            amount: 12.5, description: "Cena", category: "food", receiptUrl: null, isRecurring: false,
            recurringInterval: undefined, notes: undefined, receiptData: undefined,
            groupId: "c1", paidById: "lu", beneficiaryId: "me",
        });
    });

    it("create (personal): PERSONAL visibility, no split; another day travels", () => {
        const b = buildExpenseBody({ ...common, isPersonal: true, groupId: null, date: "2026-10-01", isRecurring: true });
        expect(b).toMatchObject({ visibility: "PERSONAL", date: "2026-10-01", recurringInterval: "monthly" });
        expect(b).not.toHaveProperty("groupId");
        expect(b).not.toHaveProperty("beneficiaryId");
    });

    it("edit: only changed category/date, notes null when blank, lines always sent when they existed", () => {
        const b = buildExpenseBody({ ...common, initial: editInitial, date: "2026-10-01", category: "food", split: { splitEqual: true } });
        expect(b).not.toHaveProperty("category");
        expect(b).not.toHaveProperty("date");
        expect(b).toMatchObject({ notes: null, receiptItems: [], paidById: "lu", splitEqual: true });
        const changed = buildExpenseBody({ ...common, initial: editInitial, date: "2026-10-02", category: "home", split: {} });
        expect(changed).toMatchObject({ date: "2026-10-02", category: "home" });
    });

    it("receiptLines strips UI-only fields", () => {
        const [line] = receiptLines([withUid({ description: "Pan", quantity: 1, price: 2, total: 2 })]);
        expect(line).toEqual({ description: "Pan", quantity: 1, price: 2, total: 2, assignedTo: null });
    });
});

describe("helpers", () => {
    it("tagDiff", () => {
        expect(tagDiff(["a", "b"], ["b", "c"])).toEqual({ toAdd: ["c"], toRemove: ["a"] });
    });
    it("withParam keeps the query and the hash", () => {
        expect(withParam("/dashboard", "saved", "100")).toBe("/dashboard?saved=100");
        expect(withParam("/dashboard?scope=personal#x", "saved", "1")).toBe("/dashboard?scope=personal&saved=1#x");
    });
});
