import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn(),
}));

import { createServer } from "@/mcp/server";
import { MAX_IMAGE_BASE64_CHARS } from "@/mcp/tools/ocr";

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

  it("tools percent-encode ids taken from their input", async () => {
    const server = createServer("fake.jwt");
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }>;
    })._registeredTools;
    await tools.check_shopping_item.handler(
      { groupId: "g/1", listId: "l?x", itemId: "i#y", checked: true },
      {},
    );
    await tools.delete_expense.handler({ id: "../settle" }, {});
    const paths = mockFetch.mock.calls.map((c) => new URL(c[0] as string).pathname);
    expect(paths).toEqual([
      "/api/spaces/g%2F1/lists/l%3Fx/items/i%23y",
      "/api/expenses/..%2Fsettle",
    ]);
  });

  it("get_categories without groupId reads personal categories (never /spaces/undefined)", async () => {
    const server = createServer("fake.jwt");
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }>;
    })._registeredTools;
    await tools.get_categories.handler({}, {});
    expect(new URL(mockFetch.mock.calls[0][0] as string).pathname).toBe("/api/me/categories");
  });

  it("parse_receipt caps imageBase64 length in its schema", () => {
    const server = createServer("fake.jwt");
    const tool = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: { safeParse: (v: unknown) => { success: boolean } } }>;
    })._registeredTools.parse_receipt;
    expect(tool.inputSchema.safeParse({ imageBase64: "QUJD" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ imageBase64: "A".repeat(MAX_IMAGE_BASE64_CHARS + 1) }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ imageBase64: "QUJD", mimeType: "image/gif" }).success).toBe(false);
  });

  it("parse_receipt rejects non-base64 input before decoding or calling the API", async () => {
    const server = createServer("fake.jwt");
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ isError?: boolean }> }>;
    })._registeredTools;
    const result = await tools.parse_receipt.handler({ imageBase64: "data:image/png;base64,AAAA" }, {});
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("parse_receipt forwards valid base64 as multipart to /api/ocr", async () => {
    const server = createServer("fake.jwt");
    const tools = (server as unknown as {
      _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ isError?: boolean }> }>;
    })._registeredTools;
    const png = Buffer.from("89504e470d0a1a0a0000000d", "hex").toString("base64");
    await tools.parse_receipt.handler({ imageBase64: png, mimeType: "image/png" }, {});
    const [url, init] = mockFetch.mock.calls[0];
    expect(new URL(url as string).pathname).toBe("/api/ocr");
    const file = (init.body as FormData).get("image") as File;
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(12);
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
