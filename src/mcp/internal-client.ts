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
  | { ok: false; status: number; error: string };

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
      });

      const text = await response.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = text;
      }

      if (!response.ok) {
        const errorMsg =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as Record<string, unknown>).error)
            : `HTTP ${response.status}`;
        return { ok: false, status: response.status, error: errorMsg };
      }

      return { ok: true, data, status: response.status };
    } catch (err) {
      return {
        ok: false,
        status: 500,
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
    return this.do("POST", path, { rawBody: formData });
  }
}

/**
 * Map an ApiResult to an MCP CallToolResult.
 * Success → JSON text content. Failure → isError + error message.
 */
export function toToolResult(result: ApiResult): CallToolResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `API error (${result.status}): ${result.error}`,
      },
    ],
  };
}

/**
 * Convenience: unwrap a successful ApiResult's data, or return a tool error.
 */
export function unwrapOrThrow(result: ApiResult): unknown {
  if (result.ok) return result.data;
  throw new Error(`API error (${result.status}): ${result.error}`);
}
