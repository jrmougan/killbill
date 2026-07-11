import { z } from "zod";
import type { ToolRegistrar } from "@/mcp/server";
import { toToolResult } from "@/mcp/internal-client";
import { toCents } from "@/lib/currency";

const customSplitShape = {
  userId: z.string().describe("Member user id who bears this split share."),
  amount: z
    .number()
    .nonnegative()
    .describe("Share in euros (e.g. 6.25). Must be >= 0."),
};

export const registerFinanceTools: ToolRegistrar = (server, api) => {
  server.registerTool(
    "list_spaces",
    {
      description:
        "List all spaces (couples, groups, ephemeral) where the authenticated user is an active member. Returns each space's id, name, type, status, and member count.",
      inputSchema: {},
    },
    async () => {
      const result = await api.get("/api/spaces");
      return toToolResult(result);
    },
  );

  server.registerTool(
    "get_balance",
    {
      description:
        "Get the current balance and debt summary for a space. Shows each member's net balance in cents (positive = owed money, negative = owes money; divide by 100 for euros) and what the caller owes to each creditor (also in cents).",
      inputSchema: {
        groupId: z.string().describe("Space id whose balances to retrieve."),
      },
    },
    async (args) => {
      const result = await api.get(`/api/spaces/${args.groupId}/balance`);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "list_expenses",
    {
      description:
        "List expenses with optional pagination. Scope 'shared' for group expenses, 'personal' for private expenses. Uses keyset cursor pagination (pass nextCursor from the previous response). Default limit 50, max 200.",
      inputSchema: {
        scope: z
          .enum(["shared", "personal"])
          .optional()
          .describe("Expense scope: 'shared' (group) or 'personal' (private). Defaults to 'shared'."),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe("Page size (1-200). Defaults to 50."),
        cursor: z
          .string()
          .optional()
          .describe("Keyset cursor from a previous response's nextCursor."),
      },
    },
    async (args) => {
      const result = await api.get("/api/expenses", {
        scope: args.scope,
        limit: args.limit !== undefined ? String(args.limit) : undefined,
        cursor: args.cursor,
      });
      return toToolResult(result);
    },
  );

  server.registerTool(
    "create_expense",
    {
      description:
        "Create a new expense. Amount is in euros (e.g. 12.50). Category must be a valid key from the effective category set. By default splits equally among active members; use customSplits for custom amounts (must sum to total) or beneficiaryId to charge a single person. Set isPersonal for a private expense.",
      inputSchema: {
        description: z.string().describe("Short human-readable label for the expense."),
        amount: z.number().positive().describe("Total amount in euros (e.g. 12.50)."),
        category: z
          .string()
          .describe("Category key from the effective category set (e.g. 'food', 'transport')."),
        paidById: z
          .string()
          .optional()
          .describe("User id of the payer. Defaults to the caller. Must be an active member of the space."),
        customSplits: z
          .array(z.object(customSplitShape))
          .optional()
          .describe("Custom per-member shares in euros; must sum to the total amount."),
        beneficiaryId: z
          .string()
          .optional()
          .describe("Charge the entire expense to a single member (exclusive split). Must be an active member."),
        isPersonal: z
          .boolean()
          .optional()
          .describe("If true, create a private (personal) expense instead of a shared one."),
        notes: z.string().optional().describe("Free-form note attached to the expense."),
        receiptUrl: z.string().optional().describe("URL of an uploaded receipt image."),
        isRecurring: z
          .boolean()
          .optional()
          .describe("If true, start a recurring series (requires recurringInterval)."),
        recurringInterval: z
          .enum(["weekly", "monthly", "yearly"])
          .optional()
          .describe("Recurrence interval for a recurring expense."),
      },
    },
    async (args) => {
      const body = {
        description: args.description,
        amount: args.amount,
        category: args.category,
        paidById: args.paidById,
        customSplits: args.customSplits?.map((s) => ({
          userId: s.userId,
          amount: toCents(s.amount),
        })),
        beneficiaryId: args.beneficiaryId,
        isPersonal: args.isPersonal,
        notes: args.notes,
        receiptUrl: args.receiptUrl,
        isRecurring: args.isRecurring,
        recurringInterval: args.recurringInterval,
      };
      const result = await api.post("/api/expenses", body);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "update_expense",
    {
      description: "Update an existing expense. Only the fields provided will be changed.",
      inputSchema: {
        id: z.string().describe("Expense id to update."),
        description: z.string().optional().describe("New short label for the expense."),
        amount: z.number().positive().optional().describe("New total amount in euros."),
        category: z
          .string()
          .optional()
          .describe("New category key from the effective category set."),
        paidById: z
          .string()
          .optional()
          .describe("New payer user id (must be an active member)."),
        customSplits: z
          .array(z.object(customSplitShape))
          .optional()
          .describe("New custom per-member shares in euros; must sum to the total amount."),
        notes: z.string().optional().describe("New free-form note."),
        receiptUrl: z.string().optional().describe("New receipt image URL."),
        isRecurring: z.boolean().optional().describe("Toggle recurring on/off."),
        recurringInterval: z
          .enum(["weekly", "monthly", "yearly"])
          .optional()
          .describe("New recurrence interval."),
      },
    },
    async (args) => {
      const body = {
        description: args.description,
        amount: args.amount,
        category: args.category,
        paidById: args.paidById,
        customSplits: args.customSplits?.map((s) => ({
          userId: s.userId,
          amount: toCents(s.amount),
        })),
        notes: args.notes,
        receiptUrl: args.receiptUrl,
        isRecurring: args.isRecurring,
        recurringInterval: args.recurringInterval,
      };
      const result = await api.patch(`/api/expenses/${args.id}`, body);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "delete_expense",
    {
      description:
        "Delete an expense. Also deactivates its recurring series if it was the template.",
      inputSchema: {
        id: z.string().describe("Expense id to delete."),
      },
    },
    async (args) => {
      const result = await api.delete(`/api/expenses/${args.id}`);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "create_settlement",
    {
      description:
        "Record a payment (settlement) from the caller to another member. Amount in euros. Creates a PENDING settlement that the receiver must confirm.",
      inputSchema: {
        amount: z
          .number()
          .nonnegative()
          .describe("Amount paid in euros (0 allowed for a checkpoint with no outstanding debt)."),
        toUserId: z
          .string()
          .describe("User id of the receiver (must be an active member of the active space)."),
        method: z
          .enum(["CASH", "BIZUM", "TRANSFER"])
          .optional()
          .describe("Payment method. Defaults to CASH."),
      },
    },
    async (args) => {
      const body = {
        amount: args.amount,
        toUserId: args.toUserId,
        method: args.method,
      };
      const result = await api.post("/api/settle", body);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "confirm_settlement",
    {
      description:
        "Confirm or reject a pending settlement. Only the receiver can do this. Confirming posts the ledger entry that zeros out the debt.",
      inputSchema: {
        id: z.string().describe("Settlement id to confirm or reject."),
        status: z
          .enum(["CONFIRMED", "REJECTED"])
          .describe("CONFIRMED to accept the payment, REJECTED to decline it."),
      },
    },
    async (args) => {
      const result = await api.patch(`/api/settle/${args.id}/status`, {
        status: args.status,
      });
      return toToolResult(result);
    },
  );
};
