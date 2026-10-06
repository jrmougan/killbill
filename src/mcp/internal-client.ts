import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Internal API client for the MCP server.
 *
 * The MCP route handler authenticates the external caller (Hermes Agent) via
 * a Bearer JWT. This client takes that same JWT and injects it as the
 * `session_token` cookie when calling existing API routes over localhost HTTP.
 * This means every existing route handler — with all its validation, authz,
 * business logic and error mapping — is reused verbatim. No code duplication.
 */

export type ApiResult =
  | { ok: true; data: unknown; status: number }
  | {
      ok: false;
      status: number;
      error: string;
      /** Machine-readable code from the API body (`{ error, code }`), if any. */
      code?: string;
      /** The full JSON error body, so agents see every field the route returned. */
      body?: Record<string, unknown>;
    };

/** Deadline for ordinary loopback API calls. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Deadline for the OCR call: the route may try two vision providers with a
 * 30 s budget each (see PROVIDER_TIMEOUT_MS in receipt-ocr-ai.ts), so it must
 * outlive both plus upload/parse overhead.
 */
export const OCR_TIMEOUT_MS = 65_000;

/**
 * Tagged template that percent-encodes every interpolated value, so ids coming
 * from tool inputs can never inject extra path segments (`../`), a query (`?`)
 * or a fragment into an internal API URL:
 *
 *   apiPath`/api/spaces/${groupId}/lists/${listId}`
 */
export function apiPath(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  let out = strings[0];
  values.forEach((value, i) => {
    const raw = String(value);
    // "." / ".." survive encodeURIComponent and the URL parser would resolve
    // them as dot-segments, so they (and empty ids) are rejected outright.
    if (raw === "" || raw === "." || raw === "..") {
      throw new Error(`Invalid path parameter: ${JSON.stringify(raw)}`);
    }
    out += encodeURIComponent(raw) + strings[i + 1];
  });
  return out;
}

export class InternalApiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwt: string,
  ) {
    const port = process.env.PORT || 3000;
    this.baseUrl = `http://localhost:${port}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Cookie: `session_token=${this.jwt}`,
      ...extra,
    };
  }

  private buildUrl(path: string, params?: Record<string, string | undefined>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async do(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      params?: Record<string, string | undefined>;
      contentType?: string;
      rawBody?: BodyInit;
      timeoutMs?: number;
    },
  ): Promise<ApiResult> {
    try {
      const url = this.buildUrl(path, options?.params);
      const headers = this.headers(
        options?.rawBody ? {} : { "Content-Type": "application/json" },
      );

      const response = await fetch(url, {
        method,
        headers,
        body: options?.rawBody ?? (options?.body ? JSON.stringify(options.body) : undefined),
        signal: AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });

      const text = await response.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }

      if (!response.ok) {
        if (typeof data === "object" && data !== null && !Array.isArray(data)) {
          const body = data as Record<string, unknown>;
          return {
            ok: false,
            status: response.status,
            error: "error" in body ? String(body.error) : `HTTP ${response.status}`,
            ...(typeof body.code === "string" ? { code: body.code } : {}),
            body,
          };
        }
        const snippet = typeof data === "string" ? data.trim().slice(0, 300) : "";
        return { ok: false, status: response.status, error: snippet || `HTTP ${response.status}` };
      }

      return { ok: true, data, status: response.status };
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return {
          ok: false,
          status: 504,
          code: "UPSTREAM_TIMEOUT",
          error: `Internal API call timed out: ${method} ${path}`,
        };
      }
      return {
        ok: false,
        status: 500,
        code: "INTERNAL_FETCH_FAILED",
        error: err instanceof Error ? err.message : "Internal API call failed",
      };
    }
  }

  async get(
    path: string,
    params?: Record<string, string | undefined>,
  ): Promise<ApiResult> {
    const r = await this.do("GET", path, { params });
    return r as ApiResult;
  }

  async post(path: string, body?: unknown): Promise<ApiResult> {
    return this.do("POST", path, { body });
  }

  async patch(path: string, body?: unknown): Promise<ApiResult> {
    return this.do("PATCH", path, { body });
  }

  async delete(path: string, body?: unknown): Promise<ApiResult> {
    return this.do("DELETE", path, { body });
  }

  /** Submit multipart form data (used by the OCR tool). */
  async postForm(path: string, formData: FormData): Promise<ApiResult> {
    return this.do("POST", path, { rawBody: formData, timeoutMs: OCR_TIMEOUT_MS });
  }
}

function errorHeadline(result: Extract<ApiResult, { ok: false }>): string {
  const code = result.code ? ` ${result.code}` : "";
  return `API error (${result.status}${code}): ${result.error}`;
}

/**
 * Map an ApiResult to an MCP CallToolResult.
 * Success → JSON text content. Failure → isError + a readable headline followed
 * by the structured error (status, code, message and the API's full error
 * body) so the agent can branch on e.g. 409 SETTLEMENT_CHANGED.
 */
export function toToolResult(result: ApiResult): CallToolResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
    };
  }
  const structured = {
    error: {
      status: result.status,
      ...(result.code ? { code: result.code } : {}),
      message: result.error,
      ...(result.body ? { body: result.body } : {}),
    },
  };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `${errorHeadline(result)}\n${JSON.stringify(structured, null, 2)}`,
      },
    ],
  };
}

/**
 * Convenience: unwrap a successful ApiResult's data, or return a tool error.
 */
export function unwrapOrThrow(result: ApiResult): unknown {
  if (result.ok) return result.data;
  throw new Error(errorHeadline(result));
}
