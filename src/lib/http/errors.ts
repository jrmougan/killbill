/**
 * HTTP error model shared by every API route handler.
 *
 * A route throws (never returns) an error and `toErrorResponse` turns it into
 * the JSON shape the clients already rely on:
 *
 *   { error: '<mensaje en español>', code?: 'SOME_CODE', ...extra }
 *
 * Mapping order: HttpError → ZodError (400 + `issues`) → typed domain errors of
 * the lib services (SettlementError, SpacePolicyError, ListError, CategoryError)
 * → anything else is a 500 logged with console.error.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorBody = { error: string; code?: string } & Record<string, unknown>;

export class HttpError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly code?: string,
        /** Extra top-level fields merged into the JSON body (e.g. `maxAmountCents`, `issues`). */
        public readonly extra: Record<string, unknown> = {},
        /** Extra response headers (e.g. `Retry-After`). */
        public readonly headers?: Record<string, string>,
    ) {
        super(message);
        this.name = "HttpError";
    }

    toJSON(): ErrorBody {
        return { error: this.message, ...(this.code ? { code: this.code } : {}), ...this.extra };
    }
}

export const badRequest = (message: string, code?: string, extra?: Record<string, unknown>) =>
    new HttpError(400, message, code, extra);
export const unauthorized = (message = "No autorizado") => new HttpError(401, message);
export const forbidden = (message = "No autorizado", code?: string) => new HttpError(403, message, code);
export const notFound = (message: string, code?: string) => new HttpError(404, message, code);
export const conflict = (message: string, code?: string, extra?: Record<string, unknown>) =>
    new HttpError(409, message, code, extra);

/** Default message of a 400 caused by an unparseable / non-object body. */
export const INVALID_BODY_MESSAGE = "Petición no válida";

export type ValidationIssue = { path: string; message: string };

/** Flatten Zod issues to `{ path: 'customSplits.0.amount', message }`. */
export function zodIssues(error: ZodError): ValidationIssue[] {
    return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

/**
 * Machine `code` of a validation 400: a fixed string, or derived from the issues
 * (e.g. `INVALID_AMOUNT` when the first one is the amount). `undefined` → no code.
 */
export type ValidationCode = string | ((issues: ValidationIssue[]) => string | undefined);

/** A ZodError as a 400 HttpError: `{ error: <first issue message>, code?, issues: [...] }`. */
export function validationError(error: ZodError, code?: ValidationCode): HttpError {
    const issues = zodIssues(error);
    const resolved = typeof code === "function" ? code(issues) : code;
    return new HttpError(400, issues[0]?.message ?? INVALID_BODY_MESSAGE, resolved, { issues });
}

/**
 * Typed domain errors thrown by lib services. They all carry a numeric `status`,
 * a string `code` and set an explicit `name` in their constructor, so they are
 * matched structurally (by name) — this module does not import the services
 * (category-crud pulls lucide icons, list-crud the DB client…). SettlementError
 * also carries `extra` (e.g. `maxAmountCents`), merged into the body like its toJSON().
 */
const DOMAIN_ERROR_NAMES = new Set(["SettlementError", "SpacePolicyError", "ListError", "CategoryError"]);

function domainError(e: unknown): HttpError | null {
    if (!(e instanceof Error) || !DOMAIN_ERROR_NAMES.has(e.name)) return null;
    const { status, code, extra } = e as Error & { status?: unknown; code?: unknown; extra?: unknown };
    if (typeof status !== "number") return null;
    return new HttpError(
        status,
        e.message,
        typeof code === "string" ? code : undefined,
        extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {},
    );
}

export type ErrorResponseOptions = {
    /** Body message of an unexpected 500 (route-specific, e.g. "Error al crear el gasto"). */
    fallbackMessage?: string;
    /** console.error label of an unexpected 500 (e.g. "Error creating expense:"). */
    logLabel?: string;
};

export const DEFAULT_500_MESSAGE = "Error interno del servidor";

/** Map anything thrown by a route handler to its JSON error response. */
export function toErrorResponse(e: unknown, options: ErrorResponseOptions = {}): NextResponse {
    const known = e instanceof HttpError ? e : e instanceof ZodError ? validationError(e) : domainError(e);
    if (known) {
        return NextResponse.json(known.toJSON(), {
            status: known.status,
            ...(known.headers ? { headers: known.headers } : {}),
        });
    }
    console.error(options.logLabel ?? "Unhandled API route error:", e);
    return NextResponse.json({ error: options.fallbackMessage ?? DEFAULT_500_MESSAGE }, { status: 500 });
}
