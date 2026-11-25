/**
 * Zod schemas of the expense write bodies (POST /api/expenses, PATCH
 * /api/expenses/[id]). They check SHAPE only (types, non-blank strings, amount
 * bounds, dates): everything that depends on the space — membership of payer /
 * beneficiary / split users, split sum, category existence — stays in the
 * handlers, after authorization. Messages are the routes' historical ones.
 */
import { z } from "zod";
import { MAX_EXPENSE_TEXT } from "@/lib/expense-input";
import { categoryKey, eurosToCents, eurosToCentsOrNull, expenseDate, jsonObject, recurringInterval } from "@/lib/http/schemas";

/** Upper bound for one expense (999.999,99 €, the numpad ceiling; Int column safe). */
export const MAX_EXPENSE_CENTS = 99_999_999;
export const MAX_EXPENSE_MESSAGE = "El importe máximo es 999.999,99 €";

export { MAX_EXPENSE_TEXT };

const DESCRIPTION_REQUIRED = "El concepto es obligatorio";
export const DESCRIPTION_TOO_LONG = `El concepto no puede superar ${MAX_EXPENSE_TEXT} caracteres`;
export const NOTES_TOO_LONG = `Las notas no pueden superar ${MAX_EXPENSE_TEXT} caracteres`;
export const RECEIPT_URL_TOO_LONG = `La URL del recibo no puede superar ${MAX_EXPENSE_TEXT} caracteres`;
const SPLIT_AMOUNTS_INVALID = "Los importes del reparto no son válidos";
export const SPLIT_NOT_MEMBER = "El reparto incluye a alguien que no es miembro del espacio";
export const PAYER_NOT_MEMBER = "Quien pagó no es miembro del espacio";
export const BENEFICIARY_NOT_MEMBER = "La persona elegida no es miembro del espacio";

const description = z
    .string({ error: DESCRIPTION_REQUIRED })
    .refine((v) => v.trim().length > 0, DESCRIPTION_REQUIRED)
    // Stored trimmed, so only the trimmed text has to fit the column.
    .refine((v) => v.trim().length <= MAX_EXPENSE_TEXT, DESCRIPTION_TOO_LONG);

/** One `{ userId, amount(cents) }` line of a CUSTOM split. */
const splitLine = z.object(
    {
        userId: z.string({ error: SPLIT_NOT_MEMBER }),
        amount: z
            .number({ error: SPLIT_AMOUNTS_INVALID })
            .int(SPLIT_AMOUNTS_INVALID)
            .nonnegative("Los importes del reparto no pueden ser negativos"),
    },
    { error: SPLIT_AMOUNTS_INVALID },
);

/** CUSTOM split lines (an empty array means "no custom split", as before). */
const customSplits = z.array(splitLine, { error: SPLIT_AMOUNTS_INVALID }).nullish();

/**
 * Receipt lines (`receiptData` on create / `receiptItems` on edit). Their own
 * leniency lives in buildReceiptLineItems / calculateSplitAmounts; here they
 * only have to be an array.
 */
const receiptLines = z.array(z.unknown(), { error: "El desglose del recibo no es válido" }).nullish();

/** Notes are stored as sent (when not blank), so the raw length must fit. */
const notes = z.string().max(MAX_EXPENSE_TEXT, NOTES_TOO_LONG).nullish();
const receiptUrl = z.string().max(MAX_EXPENSE_TEXT, RECEIPT_URL_TOO_LONG).nullish();

export const CreateExpenseBody = jsonObject({
    description,
    amount: eurosToCents({ max: MAX_EXPENSE_CENTS, maxMessage: MAX_EXPENSE_MESSAGE }),
    category: categoryKey(),
    date: expenseDate,
    /** Destination space; absent/null → the caller's active space. */
    groupId: z.string({ error: "Espacio no válido" }).min(1, "Espacio no válido").nullish(),
    isPersonal: z.boolean().nullish(),
    visibility: z.enum(["PERSONAL", "SHARED"]).nullish(),
    paidById: z.string({ error: PAYER_NOT_MEMBER }).nullish(),
    beneficiaryId: z.string({ error: BENEFICIARY_NOT_MEMBER }).nullish(),
    customSplits,
    receiptData: receiptLines,
    receiptUrl,
    notes,
    isRecurring: z.boolean().nullish(),
    recurringInterval: recurringInterval().nullish(),
}).superRefine((b, ctx) => {
    if (b.isRecurring === true && !b.recurringInterval) {
        ctx.addIssue({ code: "custom", path: ["recurringInterval"], message: "Periodicidad no válida" });
    }
});
export type CreateExpenseBody = z.output<typeof CreateExpenseBody>;

/**
 * Every field optional; `undefined` = keep. `amount: null | ""` keeps the old
 * amount (but still counts as "sent" for the split recompute, as before).
 * `paidById: null` is rejected (a payer can't be removed).
 */
export const PatchExpenseBody = jsonObject({
    description: description.optional(),
    amount: eurosToCentsOrNull({ max: MAX_EXPENSE_CENTS, maxMessage: MAX_EXPENSE_MESSAGE }).optional(),
    category: categoryKey().nullish(),
    date: expenseDate,
    paidById: z.string({ error: PAYER_NOT_MEMBER }).optional(),
    beneficiaryId: z.string({ error: BENEFICIARY_NOT_MEMBER }).nullish(),
    customSplits,
    splitEqual: z.boolean().nullish(),
    /** Retired binary toggle, still accepted so old clients don't 400. */
    splitWithPartner: z.unknown().optional(),
    receiptItems: receiptLines,
    receiptUrl,
    notes,
    isRecurring: z.boolean().nullish(),
    recurringInterval: recurringInterval().nullish(),
});
export type PatchExpenseBody = z.output<typeof PatchExpenseBody>;
