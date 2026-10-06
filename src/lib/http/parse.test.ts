import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseJson, parseQuery, readJson, validate } from "./parse";
import { HttpError } from "./errors";

const json = (body: string) => new Request("http://localhost/x", { method: "POST", body });

async function thrown(p: Promise<unknown> | (() => unknown)): Promise<HttpError> {
    try {
        await (typeof p === "function" ? p() : p);
    } catch (e) {
        return e as HttpError;
    }
    throw new Error("did not throw");
}

describe("readJson / parseJson", () => {
    it("parses a JSON body", async () => {
        expect(await readJson(json('{"a":1}'))).toEqual({ a: 1 });
    });

    it("an empty body is undefined (optional bodies)", async () => {
        expect(await readJson(new Request("http://localhost/x", { method: "POST" }))).toBeUndefined();
        expect(await parseJson(json("  "), z.object({ a: z.number() }).optional())).toBeUndefined();
    });

    it("invalid JSON → 400 'Petición no válida'", async () => {
        const e = await thrown(readJson(json("{nope")));
        expect(e).toBeInstanceOf(HttpError);
        expect(e.status).toBe(400);
        expect(e.message).toBe("Petición no válida");
    });

    it("schema failures → 400 with Spanish default messages + issues", async () => {
        const e = await thrown(parseJson(json('{"a":"x"}'), z.object({ a: z.number() })));
        expect(e.status).toBe(400);
        expect(e.message).toMatch(/se esperaba número/);
        expect(e.extra.issues).toEqual([{ path: "a", message: e.message }]);
    });

    it("messages worded on the schema win over the Spanish defaults", () => {
        const e = (() => {
            try {
                validate(z.string({ error: "El concepto es obligatorio" }), 3);
            } catch (err) {
                return err as HttpError;
            }
        })();
        expect(e?.message).toBe("El concepto es obligatorio");
    });
});

describe("parse options", () => {
    it("invalidMessage customises the unparseable-JSON 400 (and only that one)", async () => {
        const e = await thrown(parseJson(json("{nope"), z.object({ a: z.number() }), { invalidMessage: "Cuerpo inválido" }));
        expect(e.status).toBe(400);
        expect(e.toJSON()).toEqual({ error: "Cuerpo inválido" });
        const v = await thrown(parseJson(json('{"a":"x"}'), z.object({ a: z.number() }), { invalidMessage: "Cuerpo inválido" }));
        expect(v.message).toMatch(/se esperaba número/);
    });

    it("code adds a machine code to a validation 400 (fixed or derived from the issues)", async () => {
        const schema = z.object({ a: z.number(), b: z.number() });
        const fixed = await thrown(() => validate(schema, { a: 1 }, { code: "INVALID_INPUT" }));
        expect(fixed.toJSON()).toMatchObject({ code: "INVALID_INPUT", issues: [{ path: "b" }] });

        const byIssue = (issues: { path: string }[]) => (issues[0]?.path === "a" ? "INVALID_A" : undefined);
        const a = await thrown(parseJson(json('{"a":"x","b":1}'), schema, { code: byIssue }));
        expect(a.code).toBe("INVALID_A");
        const b = await thrown(parseJson(json('{"a":1}'), schema, { code: byIssue }));
        expect(b.code).toBeUndefined();
        expect(b.toJSON()).not.toHaveProperty("code");
    });
});

describe("parseQuery", () => {
    const schema = z.object({ scope: z.enum(["shared", "personal"]).optional(), limit: z.string().optional() });

    it("reads the query of a Request, URL or string", () => {
        expect(parseQuery(new Request("http://localhost/x?scope=personal"), schema)).toEqual({ scope: "personal" });
        expect(parseQuery(new URL("http://localhost/x?limit=3"), schema)).toEqual({ limit: "3" });
        expect(parseQuery("http://localhost/x", schema)).toEqual({});
    });

    it("keeps the FIRST value of a repeated key (URLSearchParams.get semantics)", () => {
        expect(parseQuery("http://localhost/x?limit=1&limit=2", schema)).toEqual({ limit: "1" });
    });

    it("invalid → 400", async () => {
        const e = await thrown(() => parseQuery("http://localhost/x?scope=nope", schema));
        expect(e.status).toBe(400);
        expect(e.extra.issues).toHaveLength(1);
    });
});
