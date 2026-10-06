import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { validateBearerToken } from "@/lib/mcp-auth";
import { createServer } from "@/mcp/server";

/**
 * MCP Streamable HTTP endpoint — STATELESS mode.
 *
 *   POST   /api/mcp   — JSON-RPC messages (initialize, tools/call, resources/read, …)
 *   GET    /api/mcp   — 405: no server→client SSE stream is offered
 *   DELETE /api/mcp   — 405: there are no sessions to terminate
 *
 * Auth: `Authorization: Bearer <jwt>` (kind 'mcp') validated on EVERY request.
 *
 * Every POST builds a fresh McpServer + transport bound to the bearer of that
 * very request and tears both down once the response is produced. There is no
 * session map, so a session id can never be replayed under another user's
 * token, nothing accumulates in memory, and the endpoint works the same behind
 * several replicas. All our tools/resources/prompts are request→response and
 * need no per-session state; an `Mcp-Session-Id` header sent by an old client
 * is simply ignored.
 */

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function methodNotAllowed(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

function getRawToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

export async function POST(request: Request) {
  const identity = await validateBearerToken(request);
  const rawToken = getRawToken(request);
  if (!identity || !rawToken) return unauthorized();

  const server = createServer(rawToken);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Plain JSON responses: the promise resolves only once every response is
    // ready, so the per-request server can be closed right after.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("MCP request failed:", error);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 },
    );
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  if (!(await validateBearerToken(request))) return unauthorized();
  return methodNotAllowed();
}

export async function DELETE(request: Request) {
  if (!(await validateBearerToken(request))) return unauthorized();
  return methodNotAllowed();
}
