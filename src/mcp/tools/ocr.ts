import { z } from "zod";
import type { ToolRegistrar } from "@/mcp/server";
import { toToolResult } from "@/mcp/internal-client";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/receipt-image";

/**
 * Upper bound on the base64 payload: 8 MB of image bytes encode to ~11.2 M
 * chars. Enforced by zod BEFORE anything is decoded so an oversized argument
 * is never turned into a second large buffer.
 */
export const MAX_IMAGE_BASE64_CHARS = 11_000_000;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function toolError(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export const registerOcrTools: ToolRegistrar = (server, api) => {
  server.registerTool(
    "parse_receipt",
    {
      description:
        "Parse a receipt/ticket image using vision AI. Uploads the image and extracts structured data: store name, suggested category, line items (description, quantity, price, total), and grand total. The image must be base64-encoded (without data URI prefix). Accepts PNG, JPEG, WEBP up to 8MB. Rate limited to 10 calls per 5 minutes.",
      inputSchema: {
        imageBase64: z
          .string()
          .min(1)
          .max(MAX_IMAGE_BASE64_CHARS)
          .describe(
            "Base64-encoded image data of the receipt, without a data URI prefix (max 8MB decoded).",
          ),
        mimeType: z
          .enum(ALLOWED_IMAGE_TYPES as [string, ...string[]])
          .optional()
          .describe(
            'MIME type of the image ("image/png", "image/jpeg" or "image/webp"). Defaults to "image/jpeg".',
          ),
      },
    },
    async (args) => {
      const mimeType = args.mimeType ?? "image/jpeg";

      // Tolerate line-wrapped base64, but reject anything that is not base64
      // before decoding (Buffer.from silently skips invalid characters).
      const base64 = args.imageBase64.replace(/\s+/g, "");
      if (!BASE64_RE.test(base64)) {
        return toolError("Invalid imageBase64: not valid base64 (omit any data: URI prefix).");
      }

      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > MAX_IMAGE_BYTES) {
        return toolError("Image too large: the maximum is 8MB.");
      }

      const file = new File([new Uint8Array(buffer)], "receipt", { type: mimeType });

      const fd = new FormData();
      fd.append("image", file);

      const result = await api.postForm("/api/ocr", fd);
      return toToolResult(result);
    },
  );
};
