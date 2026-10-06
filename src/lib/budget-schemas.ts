/**
 * Zod schemas of the /api/budget inputs. Shape only: the space (membership,
 * writability, EPHEMERAL veto) and the category's existence in the effective
 * set are decided by the handler after authorization. Messages are the
 * route's historical ones.
 */
import { z } from "zod";
import { toCents, parseEuroInput } from "@/lib/currency";
import { badRequest, HttpError, readJson, validate, type ValidationIssue } from "@/lib/http";
import { jsonObject } from "@/lib/http/schemas";

/** Upper bound for a single budget: 1.000.000 € (fits the INT `amount` column). */
export const MAX_BUDGET_CENTS = 100_000_000;

export const BUDGET_BODY_INVALID = "Cuerpo de la petición no válido";
const REQUIRED = "La categoría y el importe son obligatorios";
const MONTH_INVALID = "El mes no es válido (formato AAAA-MM)";

/**
 * Parse a budget amount in EUROS (number, or an es-ES string like "1.234,56")
 * into integer cents, enforcing (0, MAX_BUDGET_CENTS]. Returns an error message
 * instead of throwing so an absurd value is a 400, never a DB overflow 500.
 */
export function parseBudgetAmount(amount: unknown): { ok: true; cents: number } | { ok: false; error: string } {
    let cents: number | null = null;
    if (typeof amount === "number" && Number.isFinite(amount)) cents = toCents(amount);
    else if (typeof amount === "string") cents = parseEuroInput(amount);
    if (cents === null || !Number.isSafeInteger(cents)) {
        return { ok: false, error: "El importe no es válido" };
    }
    if (cents <= 0) return { ok: false, error: "El importe debe ser de al menos 0,01 €" };
    if (cents > MAX_BUDGET_CENTS) return { ok: false, error: "El importe máximo de un presupuesto es 1.000.000 €" };
    return { ok: true, cents };
}

/** Amount in euros → cents. Absent/null is "required" (no code), anything else invalid is INVALID_AMOUNT. */
const budgetAmount = z.unknown().optional().transform((v, ctx): number => {
    if (v === undefined || v === null) {
        ctx.addIssue({ code: "custom", message: REQUIRED });
        return z.NEVER;
    }
    const parsed = parseBudgetAmount(v);
    if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
    }
    return parsed.cents;
});

/** Optional 'YYYY-MM' (2000–2100) → `{ year, month (1-12) }`; absent/null/"" → null (current month). */
const budgetMonth = z.unknown().optional().transform((v, ctx): { year: number; month: number } | null => {
    if (v === undefined || v === null || v === "") return null;
    const m = typeof v === "string" ? /^(\d{4})-(\d{2})$/.exec(v) : null;
    const year = m ? Number(m[1]) : NaN;
    const month = m ? Number(m[2]) : NaN;
    if (!m || month < 1 || month > 12 || year < 2000 || year > 2100) {
        ctx.addIssue({ code: "custom", message: MONTH_INVALID });
        return z.NEVER;
    }
    return { year, month };
});

/** 'personal' or (anything else) 'shared' — lenient, as always. */
const budgetScope = z.unknown().optional().transform((v): "personal" | "shared" => (v === "personal" ? "personal" : "shared"));

/** POST /api/budget {category, amount (euros), month?, scope?, groupId?}. */
export const UpsertBudgetBody = jsonObject(
    {
        category: z.string({ error: REQUIRED }).min(1, REQUIRED),
        amount: budgetAmount,
        month: budgetMonth,
        scope: budgetScope,
        /** A non-empty string targets that space; anything else → the active space. */
        groupId: z.unknown().optional().transform((v) => (typeof v === "string" && v ? v : null)),
    },
    BUDGET_BODY_INVALID,
);
export type UpsertBudgetBody = z.output<typeof UpsertBudgetBody>;

/**
 * Read + validate the POST body: unparseable JSON keeps its historical
 * "Cuerpo de la petición no válido", and an invalid amount keeps
 * `code: INVALID_AMOUNT` (the kit's `{ error, issues }` 400 + that code).
 */
export async function parseBudgetBody(req: Request): Promise<UpsertBudgetBody> {
    const raw = await readJson(req).catch(() => {
        throw badRequest(BUDGET_BODY_INVALID);
    });
    try {
        return validate(UpsertBudgetBody, raw);
    } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        const first = (e.extra.issues as ValidationIssue[] | undefined)?.[0];
        const code = first?.path === "amount" && first.message !== REQUIRED ? "INVALID_AMOUNT" : undefined;
        throw new HttpError(400, e.message, code, e.extra);
    }
}

/** GET /api/budget?scope=&groupId= */
export const BudgetListQuery = z.object({
    scope: budgetScope,
    groupId: z.string().optional(),
});

/** DELETE /api/budget?id=&scope= */
export const BudgetDeleteQuery = z.object({
    id: z.string({ error: "Falta el identificador del presupuesto" }).min(1, "Falta el identificador del presupuesto"),
    scope: z.string().optional(),
});
