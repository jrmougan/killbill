import { z } from "zod";
import type { ToolRegistrar } from "@/mcp/server";
import { toToolResult } from "@/mcp/internal-client";

export const registerBudgetShoppingTools: ToolRegistrar = (server, api) => {
  server.registerTool(
    "get_budgets",
    {
      description:
        "Get current-month budgets with spending progress for each category. Amounts are in cents. Percentage shows how much of the budget has been consumed.",
      inputSchema: {
        scope: z
          .enum(["shared", "personal"])
          .optional()
          .describe("Budget scope: 'shared' (default) for the active group or 'personal' for the user's own budgets."),
      },
    },
    async (args) => {
      const result = await api.get("/api/budget", {
        scope: args.scope,
      });
      return toToolResult(result);
    },
  );

  server.registerTool(
    "get_categories",
    {
      description:
        "Get the effective category set (system + custom) for a space or personal context. Each category has a key (for expense creation), label, emoji, icon, and color. Use the key as the 'category' field when creating expenses.",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id whose effective categories to read. Omit (or set personal=true) to read personal categories."),
        personal: z
          .boolean()
          .optional()
          .describe("If true, read the caller's personal categories instead of a space's. Takes precedence over groupId."),
      },
    },
    async (args) => {
      if (args.personal) {
        const result = await api.get("/api/me/categories");
        return toToolResult(result);
      }
      const result = await api.get(`/api/spaces/${args.groupId}/categories`);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "list_shopping_lists",
    {
      description: "List all shopping lists in a space or personal scope.",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id to list lists for. Omit to list the caller's personal shopping lists."),
      },
    },
    async (args) => {
      if (args.groupId) {
        const result = await api.get(`/api/spaces/${args.groupId}/lists`);
        return toToolResult(result);
      }
      const result = await api.get("/api/me/lists");
      return toToolResult(result);
    },
  );

  server.registerTool(
    "create_shopping_list",
    {
      description:
        "Create a new shopping list in a space (groupId provided) or personal scope (no groupId).",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id to create the list in. Omit to create a personal shopping list."),
        name: z.string().describe("The name of the new shopping list."),
        description: z
          .string()
          .optional()
          .describe("An optional description for the shopping list."),
      },
    },
    async (args) => {
      const body = { name: args.name, description: args.description };
      if (args.groupId) {
        const result = await api.post(`/api/spaces/${args.groupId}/lists`, body);
        return toToolResult(result);
      }
      const result = await api.post("/api/me/lists", body);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "add_shopping_item",
    {
      description:
        "Add an item to a shopping list. The aisle (optional) is a supermarket-aisle key that helps organize the physical walk through the shop — it's orthogonal to expense categories and never classifies spend.",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id of the list. Omit for a personal shopping list."),
        listId: z.string().describe("The id of the shopping list to add the item to."),
        name: z.string().describe("The name of the item to add."),
        quantity: z.string().optional().describe("An optional quantity for the item."),
        unit: z.string().optional().describe("An optional unit for the item (e.g. kg, l, units)."),
        note: z.string().optional().describe("An optional free-text note for the item."),
        aisle: z
          .string()
          .optional()
          .describe("An optional supermarket-aisle key used to order the physical walk through the shop (orthogonal to expense categories)."),
      },
    },
    async (args) => {
      const body = {
        name: args.name,
        quantity: args.quantity,
        unit: args.unit,
        note: args.note,
        aisle: args.aisle,
      };
      if (args.groupId) {
        const result = await api.post(
          `/api/spaces/${args.groupId}/lists/${args.listId}/items`,
          body,
        );
        return toToolResult(result);
      }
      const result = await api.post(`/api/me/lists/${args.listId}/items`, body);
      return toToolResult(result);
    },
  );

  server.registerTool(
    "check_shopping_item",
    {
      description: "Toggle the checked status of a shopping list item (mark as done/undone).",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id of the list. Omit for a personal shopping list."),
        listId: z.string().describe("The id of the shopping list the item belongs to."),
        itemId: z.string().describe("The id of the item to update."),
        checked: z.boolean().describe("The target checked status: true to mark done, false to undo."),
      },
    },
    async (args) => {
      const body = { checked: args.checked };
      if (args.groupId) {
        const result = await api.patch(
          `/api/spaces/${args.groupId}/lists/${args.listId}/items/${args.itemId}`,
          body,
        );
        return toToolResult(result);
      }
      const result = await api.patch(
        `/api/me/lists/${args.listId}/items/${args.itemId}`,
        body,
      );
      return toToolResult(result);
    },
  );

  server.registerTool(
    "clear_checked_items",
    {
      description:
        "Delete all checked-off items from a shopping list. Useful for recycling a weekly list.",
      inputSchema: {
        groupId: z
          .string()
          .optional()
          .describe("The group/space id of the list. Omit for a personal shopping list."),
        listId: z.string().describe("The id of the shopping list to clear checked items from."),
      },
    },
    async (args) => {
      if (args.groupId) {
        const result = await api.post(
          `/api/spaces/${args.groupId}/lists/${args.listId}/clear-checked`,
        );
        return toToolResult(result);
      }
      const result = await api.post(`/api/me/lists/${args.listId}/clear-checked`);
      return toToolResult(result);
    },
  );
};
