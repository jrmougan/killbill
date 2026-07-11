import { z } from "zod";
import type { ToolRegistrar } from "@/mcp/server";

const JSON_MIME = "application/json";

export const registerResourcesPrompts: ToolRegistrar = (server, api) => {
  server.registerResource(
    "spaces",
    "kb://spaces",
    {
      description:
        "List all spaces (couples, groups, ephemeral) where the authenticated user is an active member.",
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const result = await api.get("/api/spaces");
      const text = result.ok
        ? JSON.stringify(result.data, null, 2)
        : JSON.stringify({ error: result.error });
      return {
        contents: [{ uri: uri.href, mimeType: JSON_MIME, text }],
      };
    },
  );

  server.registerResource(
    "budget-summary",
    "kb://budget-summary",
    {
      description:
        "Current-month budget summary showing each category's limit, actual spend, and percentage consumed.",
      mimeType: JSON_MIME,
    },
    async (uri) => {
      const result = await api.get("/api/budget", { scope: "shared" });
      const text = result.ok
        ? JSON.stringify(result.data, null, 2)
        : JSON.stringify({ error: result.error });
      return {
        contents: [{ uri: uri.href, mimeType: JSON_MIME, text }],
      };
    },
  );

  server.registerPrompt(
    "monthly_report",
    {
      description:
        "Generate a comprehensive monthly spending report. Analyzes expenses and budget status for the specified month.",
      argsSchema: {
        month: z
          .string()
          .describe("Month to report on in YYYY-MM format. Defaults to the current month if omitted."),
      },
    },
    async (args) => {
      const monthLabel = args.month ?? "the current month";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Generate a comprehensive monthly spending report for ${monthLabel}.`,
                ``,
                `Follow these steps:`,
                `1. Call the list_expenses tool with scope "shared" to retrieve recent shared expenses.`,
                `2. Call the get_budgets tool to retrieve the current budget status for each category.`,
                `3. Filter and total the expenses for ${monthLabel}.`,
                `4. Produce a category-by-category breakdown of spend.`,
                `5. Identify budget alerts for any category whose actual spend exceeds its limit.`,
                `6. Return a well-formatted summary that includes: total spend for the month, the per-category breakdown, and any budget alerts.`,
                ``,
                `If ${args.month ? `no expenses match ${args.month}` : "no expenses are found for the current month"}, state that clearly in the report.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "settle_up_guide",
    {
      description:
        "Guide the user through settling up debts in a space. Shows who owes what and suggests payments.",
      argsSchema: {
        groupId: z.string().describe("The space (group) id whose balances should be settled."),
      },
    },
    async (args) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Help the user settle up outstanding debts in the space with id "${args.groupId}".`,
                ``,
                `Follow these steps:`,
                `1. Call the get_balance tool with groupId "${args.groupId}" to retrieve each member's current net balance.`,
                `2. Determine who owes money to whom based on the balances (positive balance = is owed, negative balance = owes).`,
                `3. Suggest the minimal set of payments that would zero out all balances.`,
                `4. For each suggested payment, offer to call create_settlement with the from user, to user, and amount.`,
                `5. Explain the confirmation flow: each settlement must be confirmed by both parties before it is finalized, and confirmed settlements reduce the outstanding balances.`,
                ``,
                `Present the suggested settlements clearly and ask the user which ones they want to execute.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "shopping_trip",
    {
      description:
        "Prepare for a shopping trip. Shows the current shopping list organized by aisle.",
      argsSchema: {
        groupId: z
          .string()
          .describe("The space (group) id whose shopping list to use. If omitted, use the active space."),
      },
    },
    async (args) => {
      const scope = args.groupId ?? "the user's active space";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Prepare the user for a shopping trip in ${scope}.`,
                ``,
                `Follow these steps:`,
                `1. Call the list_shopping_lists tool${args.groupId ? ` with groupId "${args.groupId}"` : ""} to find the relevant shopping list.`,
                `2. Present the items organized by aisle so the user can follow an efficient path through the shop.`,
                `3. Group items under their aisle name, and list items with no aisle at the end under "Otros".`,
                `4. Offer to check off items one by one as the user gathers them, using the shopping list item tools.`,
                ``,
                `Wait for the user to confirm which items they have picked up before marking anything as checked.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
};
