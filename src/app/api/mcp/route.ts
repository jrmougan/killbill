import { randomUUID } from "crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { validateBearerToken } from "@/lib/mcp-auth";
import { createServer } from "@/mcp/server";

/**
 * MCP Streamable HTTP endpoint.
 *
 * Hermes Agent (and any MCP client) connects here:
 *   POST   /api/mcp   — JSON-RPC messages (initialize, tools/call, …)
 *   GET    /api/mcp   — SSE stream (optional, for server→client notifications)
 *   DELETE /api/mcp   — terminate a session
 *
 * Auth: `Authorization: Bearer <jwt>` validated via JWT_SECRET (same as browser
 * sessions). The JWT is then reused internally to call existing API routes.
 *
 * Session management: stateful — a module-level Map keyed by Mcp-Session-Id
 * holds { server, transport } pairs. This works because the Next.js standalone
 * server is a long-running single process.
 */

type McpSession = {
  server: ReturnType<typeof createServer>;
  transport: WebStandardStreamableHTTPServerTransport;
};

const sessions = new Map<string, McpSession>();

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function getRawToken(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

export async function POST(request: Request) {
  const identity = await validateBearerToken(request);
  if (!identity) return unauthorized();

  const sessionId = request.headers.get("mcp-session-id");

  // Existing session — delegate directly
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
      return Response.json(
        { error: "Session not found. Re-initialize." },
        { status: 404 },
      );
    }
    return session.transport.handleRequest(request);
  }

  // New session — create transport + server, wire them together
  const rawToken = await getRawToken(request);
  if (!rawToken) return unauthorized();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string) => {
      sessions.set(id, { server, transport });
    },
    onsessionclosed: (id: string) => {
      sessions.delete(id);
    },
  });

  const server = createServer(rawToken);
  await server.connect(transport);

  // The first handleRequest processes `initialize` and assigns the session ID
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const identity = await validateBearerToken(request);
  if (!identity) return unauthorized();

  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      return session.transport.handleRequest(request);
    }
  }

  // No active session for SSE
  return new Response(null, { status: 405 });
}

export async function DELETE(request: Request) {
  const identity = await validateBearerToken(request);
  if (!identity) return unauthorized();

  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      // handleRequest(DELETE) fires onsessionclosed → Map cleanup
      return session.transport.handleRequest(request);
    }
  }

  return new Response(null, { status: 404 });
}
