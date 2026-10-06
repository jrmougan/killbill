// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/mcp-auth", () => ({
  validateBearerToken: vi.fn(async (request: Request) => {
    const auth = request.headers.get("authorization");
    if (auth === "Bearer token-a") return { userId: "user-a" };
    if (auth === "Bearer token-b") return { userId: "user-b" };
    return null;
  }),
}));

import { DELETE, GET, POST } from "./route";

let nextId = 1;

function rpc(method: string, params: unknown, token: string | null, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
}

const INIT_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0.0" },
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () =>
    new Response(JSON.stringify({ spaces: [{ id: "s1" }] }), { status: 200 }),
  );
});

afterEach(() => vi.clearAllMocks());

describe("/api/mcp (stateless)", () => {
  it("rejects requests without a valid bearer", async () => {
    expect((await POST(rpc("initialize", INIT_PARAMS, null))).status).toBe(401);
    expect((await POST(rpc("initialize", INIT_PARAMS, "forged"))).status).toBe(401);
  });

  it("initializes without issuing a session id", async () => {
    const res = await POST(rpc("initialize", INIT_PARAMS, "token-a"));
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("killbill");
  });

  it("serves tools/list, tools/call, resources and prompts on independent requests", async () => {
    const list = await (await POST(rpc("tools/list", {}, "token-a"))).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain("ping");

    const ping = await (await POST(rpc("tools/call", { name: "ping", arguments: {} }, "token-a"))).json();
    expect(ping.result.content[0].text).toBe("pong");

    const resource = await (await POST(rpc("resources/read", { uri: "kb://spaces" }, "token-a"))).json();
    expect(JSON.parse(resource.result.contents[0].text)).toEqual({ spaces: [{ id: "s1" }] });

    const prompt = await (
      await POST(rpc("prompts/get", { name: "settle_up_guide", arguments: { groupId: "g1" } }, "token-a"))
    ).json();
    expect(prompt.result.messages[0].content.text).toContain("g1");
  });

  it("binds every call to the bearer of THAT request, ignoring any session id", async () => {
    await POST(rpc("tools/call", { name: "list_spaces", arguments: {} }, "token-a"));
    // A request carrying another user's token plus a (stale/stolen) session id
    // must act as its own bearer, never as the session's original owner.
    await POST(
      rpc("tools/call", { name: "list_spaces", arguments: {} }, "token-b", { "mcp-session-id": "session-of-a" }),
    );
    const cookies = mockFetch.mock.calls.map((c) => (c[1] as RequestInit & { headers: Record<string, string> }).headers.Cookie);
    expect(cookies).toEqual(["session_token=token-a", "session_token=token-b"]);
  });

  it("answers GET and DELETE with 405 (no SSE stream, no sessions)", async () => {
    const auth = { headers: { Authorization: "Bearer token-a" } };
    const get = await GET(new Request("http://localhost/api/mcp", auth));
    const del = await DELETE(new Request("http://localhost/api/mcp", { ...auth, method: "DELETE" }));
    expect(get.status).toBe(405);
    expect(del.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await GET(new Request("http://localhost/api/mcp"))).status).toBe(401);
  });
});
