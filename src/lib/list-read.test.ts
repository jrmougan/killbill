import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const aggregate = vi.fn();

vi.mock("./db", () => ({
    prisma: {
        shoppingList: { findFirst: (...a: unknown[]) => findFirst(...a) },
        shoppingListItem: { aggregate: (...a: unknown[]) => aggregate(...a) },
    },
}));

import { getListVersion, listVersionOf, listVersionStamp } from "./list-read";

const t = (ms: number) => new Date(ms);

describe("listVersionStamp / listVersionOf", () => {
    it("is stable for the same data", () => {
        expect(listVersionStamp(t(1), 2, t(5))).toBe(listVersionStamp(t(1), 2, t(5)));
    });

    it("moves on add/delete (count), edit/toggle (newest item) and list rename", () => {
        const base = listVersionStamp(t(1), 2, t(5));
        expect(listVersionStamp(t(1), 3, t(5))).not.toBe(base);
        expect(listVersionStamp(t(1), 2, t(6))).not.toBe(base);
        expect(listVersionStamp(t(2), 2, t(5))).not.toBe(base);
    });

    it("an empty list has a stamp too", () => {
        expect(listVersionStamp(t(1), 0, null)).toBe("0.0.1");
    });

    it("computed from a loaded list matches the aggregate form", () => {
        const list = { updatedAt: t(1), items: [{ updatedAt: t(9) }, { updatedAt: t(4) }] };
        expect(listVersionOf(list)).toBe(listVersionStamp(t(1), 2, t(9)));
        expect(listVersionOf({ updatedAt: t(1), items: [] })).toBe(listVersionStamp(t(1), 0, null));
    });
});

describe("getListVersion", () => {
    beforeEach(() => {
        findFirst.mockReset();
        aggregate.mockReset();
    });

    it("scopes the lookup (group / owner) and aggregates the items", async () => {
        findFirst.mockResolvedValue({ updatedAt: t(1) });
        aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { updatedAt: t(9) } });
        expect(await getListVersion({ kind: "group", groupId: "g1" }, "l1")).toBe(listVersionStamp(t(1), 2, t(9)));
        expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { id: "l1", groupId: "g1" } });
        expect(aggregate.mock.calls[0][0]).toMatchObject({ where: { listId: "l1" } });

        await getListVersion({ kind: "owner", ownerId: "u1" }, "l2");
        expect(findFirst.mock.calls[1][0]).toMatchObject({ where: { id: "l2", ownerId: "u1" } });
    });

    it("null for a missing or foreign list, without aggregating", async () => {
        findFirst.mockResolvedValue(null);
        expect(await getListVersion({ kind: "owner", ownerId: "u1" }, "x")).toBeNull();
        expect(aggregate).not.toHaveBeenCalled();
    });
});
