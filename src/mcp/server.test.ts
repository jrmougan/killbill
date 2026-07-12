import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn(),
}));

import { createServer } from "@/mcp/server";

function getTools(server: ReturnType<typeof createServer>) {
  const registered = (server as unknown as { _registeredTools: Record<string, { description?: string }> })._registeredTools;
  return registered;
}

describe("createServer", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("{}"),
    });
  });

  it("creates a server with the killbill name", () => {
    const server = createServer("fake.jwt");
    expect(server).toBeDefined();
    expect(server.isConnected()).toBe(false);
  });

  it("registers the ping tool", () => {
    const server = createServer("fake.jwt");
    const tools = getTools(server);
    expect("ping" in tools).toBe(true);
  });

  it("registers all finance tools", () => {
    const server = createServer("fake.jwt");
    const names = Object.keys(getTools(server));
    expect(names).toContain("list_spaces");
    expect(names).toContain("get_balance");
    expect(names).toContain("list_expenses");
    expect(names).toContain("create_expense");
    expect(names).toContain("update_expense");
    expect(names).toContain("delete_expense");
    expect(names).toContain("create_settlement");
    expect(names).toContain("confirm_settlement");
    expect(names).toContain("get_expense_receipt_breakdown");
  });

  it("registers budget and shopping tools", () => {
    const server = createServer("fake.jwt");
    const names = Object.keys(getTools(server));
    expect(names).toContain("get_budgets");
    expect(names).toContain("get_categories");
    expect(names).toContain("list_shopping_lists");
    expect(names).toContain("create_shopping_list");
    expect(names).toContain("add_shopping_item");
    expect(names).toContain("check_shopping_item");
    expect(names).toContain("clear_checked_items");
  });

  it("registers the OCR tool", () => {
    const server = createServer("fake.jwt");
    const tools = getTools(server);
    expect("parse_receipt" in tools).toBe(true);
  });

  it("registers a total of 18+ tools", () => {
    const server = createServer("fake.jwt");
    const tools = getTools(server);
    expect(Object.keys(tools).length).toBeGreaterThanOrEqual(18);
  });

  it("every tool has a description", () => {
    const server = createServer("fake.jwt");
    const tools = getTools(server);
    for (const [, tool] of Object.entries(tools)) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(10);
    }
  });
});
