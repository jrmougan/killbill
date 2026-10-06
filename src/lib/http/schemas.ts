/**
 * Shared Zod primitives for API route inputs. They WRAP the existing pure
 * validators (expense-input, list-quantity, category-colors, currency…) instead
 * of re-implementing their rules, and every factory takes the route's
 * historical Spanish message so migrating a route never changes its wording.
 */
import { z } from "zod";
import { toCents } from "@/lib/currency";
import { parseExpenseDate, isRealCalendarDay, RECURRING_INTERVALS } from "@/lib/expense-input";
import { normalizeQuantity } from "@/lib/list-quantity";
import { isValidCategoryHex } from "@/lib/category-colors";
import { INVALID_BODY_MESSAGE } from "./errors";

/**
 * A JSON-object body. A missing / non-object body (null, array, string…) fails
 * with "Petición no válida" (the historical wording); unknown keys are stripped.
 */
export function jsonObject<T extends z.ZodRawShape>(shape: T, message = INVALID_BODY_MESSAGE) {
    return z.object(shape, { error: message });
}

/** A database id (cuid, or any opaque non-empty string in tests/legacy rows). */
export function id(message = "Identificador no válido") {
    return z.string({ error: message }).min(1, message).max(191, message);
}

/** `{ id }` dynamic segment of `[id]` routes. */
export const idParams = z.object({ id: id() });

/** Integer cents (money is ALWAYS integer cents in the API/DB). */
export function cents(opts: { message?: string; min?: number; max?: number; maxMessage?: string } = {}) {
    const message = opts.message ?? "Importe no válido";
    let s = z.number({ error: message }).int(message);
    if (opts.min !== undefined) s = s.min(opts.min, message);
    if (opts.max !== undefined) s = s.max(opts.max, opts.maxMessage ?? message);
    return s;
}

type EurosOptions = { message?: string; max?: number; maxMessage?: string };

function eurosSchema<E extends "reject" | "null">(opts: EurosOptions, empty: E) {
    const message = opts.message ?? "Importe no válido";
    return z
        .union([z.number(), z.string(), z.null()], { error: message })
        .transform((v, ctx): E extends "null" ? number | null : number => {
            type R = E extends "null" ? number | null : number;
            if (v === null || (typeof v === "string" && v.trim() === "")) {
                if (empty === "null") return null as R;
                ctx.addIssue({ code: "custom", message });
                return z.NEVER;
            }
            const value = toCents(Number(v));
            if (!Number.isFinite(value) || value <= 0) {
                ctx.addIssue({ code: "custom", message });
                return z.NEVER;
            }
            if (opts.max !== undefined && value > opts.max) {
                ctx.addIssue({ code: "custom", message: opts.maxMessage ?? message });
                return z.NEVER;
            }
            return value as R;
        });
}

/**
 * An amount in EUROS (JSON number, or numeric string from old clients/forms —
 * `Number()` semantics, as the routes always did) converted to integer cents,
 * strictly positive and ≤ `max` cents. null / "" are rejected.
 */
export function eurosToCents(opts: EurosOptions = {}) {
    return eurosSchema(opts, "reject");
}

/** Like eurosToCents, but null / "" map to null (PATCH: "keep the old amount"). */
export function eurosToCentsOrNull(opts: EurosOptions = {}) {
    return eurosSchema(opts, "null");
}

/** Strict "YYYY-MM-DD" naming a real calendar day (no range check). */
export function isoDay(message = "Fecha inválida") {
    return z.string({ error: message }).refine(isRealCalendarDay, message);
}

/**
 * Optional expense date (parseExpenseDate): absent / null / "" → undefined;
 * otherwise a real day in [2000-01-01, today + 1 year] stored at 12:00 UTC.
 * Messages come from expense-input ("Fecha inválida: …", "La fecha no puede…").
 */
export const expenseDate = z
    .unknown()
    .transform((v, ctx): Date | undefined => {
        const parsed = parseExpenseDate(v);
        if (!parsed.ok) {
            ctx.addIssue({ code: "custom", message: parsed.error });
            return z.NEVER;
        }
        return parsed.date;
    })
    .optional();

/** weekly | monthly | yearly (RecurringInterval). */
export function recurringInterval(message = "Periodicidad no válida") {
    return z.enum(RECURRING_INTERVALS, { error: message });
}

/**
 * A category KEY as sent by clients (non-blank string, value kept as-is). Whether
 * it exists is decided against the effective set (resolveCategoryId) in the handler.
 */
export function categoryKey(message = "Categoría no válida") {
    return z.string({ error: message }).refine((s) => s.trim().length > 0, message);
}

/** A palette hex accepted for categories (isValidCategoryHex). */
export function categoryHex(message = "Color no válido (fuera de la paleta)") {
    return z.string({ error: message }).refine(isValidCategoryHex, message);
}

/** Shopping-item quantity (normalizeQuantity): number or es-ES text → number | null. */
export const listQuantity = z
    .unknown()
    .transform((v, ctx): number | null => {
        const q = normalizeQuantity(v);
        if (!q.ok) {
            ctx.addIssue({ code: "custom", message: q.error });
            return z.NEVER;
        }
        return q.value;
    })
    .optional();

/**
 * Lenient integer query param (never a 400): parseInt, then `default` when
 * absent/garbage, clamped to [min, max]. Mirrors the historical pagination code.
 */
export function intParam(opts: { default: number; min?: number; max?: number }) {
    return z
        .string()
        .optional()
        .transform((v) => {
            const n = parseInt(v ?? "", 10);
            if (!Number.isFinite(n)) return opts.default;
            return Math.min(Math.max(n, opts.min ?? -Infinity), opts.max ?? Infinity);
        });
}

/** Keyset pagination query: `limit` (clamped), optional `cursor` (an id). */
export function paginationQuery(opts: { defaultLimit: number; maxLimit: number }) {
    return z.object({
        limit: intParam({ default: opts.defaultLimit, min: 1, max: opts.maxLimit }),
        cursor: z.string().optional(),
    });
}
