/**
 * Request parsing helpers. Every failure is thrown as a 400 HttpError, ready for
 * `toErrorResponse` (route() does that for you).
 */
import { z } from "zod";
import { HttpError, INVALID_BODY_MESSAGE, validationError } from "./errors";

/**
 * Spanish defaults for the issues a schema does not word itself. Applied per
 * parse (not via a global z.config) so the MCP tool schemas keep their own locale.
 * A message set on the schema (`z.string({ error: '…' })`, `.min(1, '…')`) wins.
 */
const SPANISH = z.locales.es().localeError;

/** Validate `value` against `schema` (Spanish messages) or throw a 400 with `issues`. */
export function validate<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
    const result = schema.safeParse(value, { error: SPANISH });
    if (!result.success) throw validationError(result.error);
    return result.data;
}

/**
 * Read the JSON body. An EMPTY body yields `undefined` (so a schema may make the
 * whole body optional); a non-empty unparseable one is a 400 "Petición no válida".
 */
export async function readJson(req: Request): Promise<unknown> {
    const text = await req.text();
    if (text.trim() === "") return undefined;
    try {
        return JSON.parse(text);
    } catch {
        throw new HttpError(400, INVALID_BODY_MESSAGE);
    }
}

/** Read + validate the JSON body. */
export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
    return validate(schema, await readJson(req));
}

/**
 * Validate the query string. Values are strings (`URLSearchParams.get`
 * semantics: the FIRST value of a repeated key); absent keys are absent.
 */
export function parseQuery<S extends z.ZodType>(input: Request | URL | string, schema: S): z.output<S> {
    const url = input instanceof Request ? new URL(input.url) : new URL(input);
    const raw: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
        if (!(key in raw)) raw[key] = value;
    }
    return validate(schema, raw);
}
