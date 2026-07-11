import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InternalApiClient } from "./internal-client";
import { registerFinanceTools } from "./tools/finance";
import { registerBudgetShoppingTools } from "./tools/budget-shopping";
import { registerOcrTools } from "./tools/ocr";
import { registerResourcesPrompts } from "./resources-prompts";

export type { InternalApiClient };

export type ToolRegistrar = (server: McpServer, api: InternalApiClient) => void;

const registrars: ToolRegistrar[] = [
  registerFinanceTools,
  registerBudgetShoppingTools,
  registerOcrTools,
  registerResourcesPrompts,
];

/**
 * Create a configured McpServer bound to the given JWT identity.
 *
 * The JWT is used by the InternalApiClient to set the session_token cookie
 * on all internal API calls, so every tool operates as the authenticated user
 * with full authorization enforcement (requireSpaceAccess, role gates, etc.).
 */
export function createServer(jwt: string): McpServer {
  const api = new InternalApiClient(jwt);

  const server = new McpServer({
    name: "killbill",
    version: "1.0.0",
  });

  // Phase 1 ping tool — verify the server is alive end-to-end.
  server.registerTool(
    "ping",
    {
      description: "Health check — returns 'pong' and the caller identity.",
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
    }),
  );

  // Register all Phase 2 tool modules
  for (const register of registrars) {
    register(server, api);
  }

  return server;
}
