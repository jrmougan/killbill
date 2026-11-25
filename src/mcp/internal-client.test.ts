import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  apiPath,
  DEFAULT_TIMEOUT_MS,
  InternalApiClient,
  OCR_TIMEOUT_MS,
  toToolResult,
  type ApiResult,
} from "@/mcp/internal-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("InternalApiClient", () => {
  let client: InternalApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new InternalApiClient("fake.jwt.token");
  });

  it("sends a GET request with the session cookie", async () => {
    mockFetch.mockResolvedValue(makeResponse({ spaces: [] }));
    await client.get("/api/spaces");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/spaces");
    expect(init.method).toBe("GET");
    expect(init.headers.Cookie).toBe("session_token=fake.jwt.token");
  });

  it("builds query params correctly", async () => {
    mockFetch.mockResolvedValue(makeResponse({ expenses: [] }));
    await client.get("/api/expenses", { scope: "shared", limit: "10" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("scope=shared");
    expect(url).toContain("limit=10");
  });

  it("skips undefined query params", async () => {
    mockFetch.mockResolvedValue(makeResponse({ expenses: [] }));
    await client.get("/api/expenses", { scope: undefined, limit: "5" });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("limit=5");
    expect(url).not.toContain("scope=");
  });

  it("sends a POST with JSON body and Content-Type", async () => {
    mockFetch.mockResolvedValue(makeResponse({ success: true }));
    await client.post("/api/expenses", { description: "Test", amount: 10 });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ description: "Test", amount: 10 });
  });

  it("sends a PATCH with JSON body", async () => {
    mockFetch.mockResolvedValue(makeResponse({ success: true }));
    await client.patch("/api/expenses/123", { description: "Updated" });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ description: "Updated" });
  });

  it("sends a DELETE", async () => {
    mockFetch.mockResolvedValue(makeResponse({ success: true }));
    await client.delete("/api/expenses/123");
    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });

  it("returns ok result for 2xx responses", async () => {
    mockFetch.mockResolvedValue(makeResponse({ spaces: [{ id: "s1" }] }));
    const result = await client.get("/api/spaces");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ spaces: [{ id: "s1" }] });
      expect(result.status).toBe(200);
    }
  });

  it("returns error result for non-2xx responses", async () => {
    mockFetch.mockResolvedValue(makeResponse({ error: "Unauthorized" }, 401));
    const result = await client.get("/api/spaces");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("Unauthorized");
    }
  });

  it("handles network errors", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await client.get("/api/spaces");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toContain("ECONNREFUSED");
    }
  });

  it("handles non-JSON responses", async () => {
    mockFetch.mockResolvedValue(makeResponse("plain text", 200));
    const result = await client.get("/api/export");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe("plain text");
    }
  });
});

describe("toToolResult", () => {
  it("wraps successful data as text content", () => {
    const result: ApiResult = { ok: true, data: { spaces: [] }, status: 200 };
    const toolResult = toToolResult(result);
    expect(toolResult.isError).toBeUndefined();
    expect(toolResult.content).toHaveLength(1);
    expect(toolResult.content[0].type).toBe("text");
    const textItem = toolResult.content[0] as { type: "text"; text: string };
    expect(JSON.parse(textItem.text)).toEqual({ spaces: [] });
  });

  it("wraps errors as isError with message", () => {
    const result: ApiResult = { ok: false, status: 400, error: "Invalid amount" };
    const toolResult = toToolResult(result);
    expect(toolResult.isError).toBe(true);
    const textItem = toolResult.content[0] as { type: "text"; text: string };
    expect(textItem.text).toContain("400");
    expect(textItem.text).toContain("Invalid amount");
  });

  it("formats nested objects with indentation", () => {
    const result: ApiResult = {
      ok: true,
      data: { a: { b: { c: 1 } } },
      status: 200,
    };
    const toolResult = toToolResult(result);
    const textItem = toolResult.content[0] as { type: "text"; text: string };
    expect(textItem.text).toContain("\n");
  });
});

describe("InternalApiClient — timeouts and structured errors", () => {
  let client: InternalApiClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new InternalApiClient("fake.jwt.token");
  });

  it("passes a 15 s deadline signal on ordinary calls", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValue(makeResponse({}));
    await client.get("/api/spaces");
    expect(timeoutSpy).toHaveBeenCalledWith(DEFAULT_TIMEOUT_MS);
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it("gives the OCR form post a longer deadline than both providers combined", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValue(makeResponse({}));
    await client.postForm("/api/ocr", new FormData());
    expect(timeoutSpy).toHaveBeenCalledWith(OCR_TIMEOUT_MS);
    expect(OCR_TIMEOUT_MS).toBeGreaterThan(60_000);
    timeoutSpy.mockRestore();
  });

  it("maps a timed-out call to a 504 UPSTREAM_TIMEOUT error", async () => {
    mockFetch.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const result = await client.get("/api/spaces");
    expect(result).toMatchObject({ ok: false, status: 504, code: "UPSTREAM_TIMEOUT" });
  });

  it("keeps the API error code and full body", async () => {
    mockFetch.mockResolvedValue(
      makeResponse({ error: "El pago cambió", code: "SETTLEMENT_CHANGED", currentAmountCents: 500 }, 409),
    );
    const result = await client.patch("/api/settle/s1/status", { status: "CONFIRMED" });
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "El pago cambió",
      code: "SETTLEMENT_CHANGED",
      body: { error: "El pago cambió", code: "SETTLEMENT_CHANGED", currentAmountCents: 500 },
    });
  });

  it("surfaces a non-JSON error body instead of a bare status", async () => {
    mockFetch.mockResolvedValue(makeResponse("Bad Gateway from proxy", 502));
    const result = await client.get("/api/spaces");
    expect(result).toMatchObject({ ok: false, status: 502, error: "Bad Gateway from proxy" });
  });

  it("propagates status, code and body into the tool result", () => {
    const toolResult = toToolResult({
      ok: false,
      status: 409,
      error: "El pago cambió",
      code: "SETTLEMENT_CHANGED",
      body: { error: "El pago cambió", code: "SETTLEMENT_CHANGED" },
    });
    expect(toolResult.isError).toBe(true);
    const text = (toolResult.content[0] as { type: "text"; text: string }).text;
    expect(text.split("\n")[0]).toBe("API error (409 SETTLEMENT_CHANGED): El pago cambió");
    const structured = JSON.parse(text.slice(text.indexOf("\n") + 1));
    expect(structured.error).toMatchObject({ status: 409, code: "SETTLEMENT_CHANGED", message: "El pago cambió" });
  });
});

describe("apiPath", () => {
  it("percent-encodes every interpolated id", () => {
    expect(apiPath`/api/spaces/${"a/b?c#d"}/lists/${"x y"}`).toBe("/api/spaces/a%2Fb%3Fc%23d/lists/x%20y");
  });

  it("leaves ordinary ids untouched", () => {
    expect(apiPath`/api/expenses/${"clx123abc"}`).toBe("/api/expenses/clx123abc");
  });

  it.each(["", ".", ".."])("rejects the dot-segment / empty id %j", (bad) => {
    expect(() => apiPath`/api/expenses/${bad}`).toThrow(/Invalid path parameter/);
  });

  it("an encoded id cannot escape its path segment once resolved", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(makeResponse({}));
    await new InternalApiClient("t").delete(apiPath`/api/expenses/${"../admin/users"}`);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/api/expenses/..%2Fadmin%2Fusers");
  });
});
