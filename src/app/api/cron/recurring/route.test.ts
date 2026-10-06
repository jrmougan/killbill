import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockMaterializeAll = vi.fn();
vi.mock("@/lib/recurring", () => ({ materializeAllDueRecurring: () => mockMaterializeAll() }));

import { POST } from "./route";

function call(secret?: string) {
    return POST(new Request("http://localhost/api/cron/recurring", {
        method: "POST",
        headers: secret ? { "x-cron-secret": secret } : {},
    }));
}

describe("POST /api/cron/recurring", () => {
    const original = process.env.CRON_SECRET;
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.CRON_SECRET = "s3cret";
        mockMaterializeAll.mockResolvedValue(3);
    });
    afterEach(() => {
        if (original === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = original;
    });

    it("503 (disabled) without CRON_SECRET", async () => {
        delete process.env.CRON_SECRET;
        expect((await call("s3cret")).status).toBe(503);
        expect(mockMaterializeAll).not.toHaveBeenCalled();
    });

    it("401 with a wrong or missing secret", async () => {
        expect((await call("nope")).status).toBe(401);
        expect((await call()).status).toBe(401);
        expect(mockMaterializeAll).not.toHaveBeenCalled();
    });

    it("materializes every due series and reports how many were created", async () => {
        const res = await call("s3cret");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ created: 3 });
    });

    it("500 with a Spanish error when materialization fails", async () => {
        mockMaterializeAll.mockRejectedValue(new Error("boom"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        const res = await call("s3cret");
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/recurrentes/);
    });
});
