/**
 * Zod schemas of the settlement write bodies (POST /api/settle, PATCH
 * /api/settle/[id], PATCH /api/settle/[id]/status). Shape only: membership of
 * the counterparty, "not with yourself" (needs the caller) and the debt caps
 * stay in the handler / settlement-service. Amounts arrive in EUROS (a real
 * JSON number, parseSettlementAmount) and leave as integer cents.
 *
 * Settlement 400s historically carry a `code` (INVALID_AMOUNT for the amount,
 * INVALID_INPUT for everything else) that clients read, so these bodies are
 * parsed with `parseSettlementInput`, which adds that code to the kit's
 * `{ error, issues }` 400.
 */
import { z } from "zod";
import { HttpError, readJson, validate, type ValidationIssue } from "@/lib/http";
import { id, jsonObject } from "@/lib/http/schemas";
import { parseSettlementAmount, SETTLEMENT_METHODS } from "@/lib/settlement-rules";

const METHOD_INVALID = "Método de pago no válido";

/** An amount in euros (JSON number only) → integer cents in [1, MAX_SETTLEMENT_CENTS]. */
const settlementAmount = z.unknown().transform((v, ctx): number => {
    const parsed = parseSettlementAmount(v);
    if (!parsed.ok) {
        ctx.addIssue({ code: "custom", message: parsed.error });
        return z.NEVER;
    }
    return parsed.cents;
});

const settlementMethod = z.enum(SETTLEMENT_METHODS, { error: METHOD_INVALID });

/**
 * POST /api/settle. `fromUserId` present (non-null) = "received" direction;
 * otherwise `toUserId` is required ("paid"). `toUserId` is kept raw: in the
 * received direction it may only be null/absent/the caller, which the handler
 * checks against the session.
 */
export const CreateSettlementBody = jsonObject({
    fromUserId: id("fromUserId no válido").nullish(),
    toUserId: z.unknown().optional(),
    amount: settlementAmount,
    method: settlementMethod.nullish(),
    groupId: id("groupId no válido").nullish(),
}).superRefine((b, ctx) => {
    if (b.fromUserId == null && (typeof b.toUserId !== "string" || !b.toUserId)) {
        ctx.addIssue({ code: "custom", path: ["toUserId"], message: "Falta toUserId" });
    }
});
export type CreateSettlementBody = z.output<typeof CreateSettlementBody>;

/** PATCH /api/settle/[id]: edit a PENDING settlement (`null` is not "keep"). */
export const EditSettlementBody = jsonObject({
    amount: settlementAmount.optional(),
    method: settlementMethod.optional(),
});
export type EditSettlementBody = z.output<typeof EditSettlementBody>;

const STATUS_INVALID = "Estado no válido";
const EXPECTED_INVALID = "expectedAmountCents no válido";

/** PATCH /api/settle/[id]/status: the receiver confirms / rejects. */
export const ResolveSettlementBody = jsonObject(
    {
        status: z.enum(["CONFIRMED", "REJECTED"], { error: STATUS_INVALID }),
        expectedAmountCents: z
            .number({ error: EXPECTED_INVALID })
            .refine(Number.isSafeInteger, EXPECTED_INVALID)
            .optional(),
    },
    STATUS_INVALID,
);
export type ResolveSettlementBody = z.output<typeof ResolveSettlementBody>;

/**
 * Read + validate a settlement body. An unparseable JSON body counts as `null`
 * (the historical `request.json().catch(() => null)`), so its message is the
 * schema's own. A 400 gets `code: INVALID_AMOUNT` when the first issue is the
 * amount, `INVALID_INPUT` otherwise.
 */
export async function parseSettlementInput<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
    const raw = await readJson(req).catch(() => null);
    try {
        return validate(schema, raw);
    } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        const issues = (e.extra.issues as ValidationIssue[] | undefined) ?? [];
        const code = issues[0]?.path === "amount" ? "INVALID_AMOUNT" : "INVALID_INPUT";
        throw new HttpError(400, e.message, code, e.extra);
    }
}
