import { z } from "zod";
import type { ToolRegistrar } from "@/mcp/server";
import { toToolResult } from "@/mcp/internal-client";

export const registerOcrTools: ToolRegistrar = (server, api) => {
  server.registerTool(
    "parse_receipt",
    {
      description:
        "Parse a receipt/ticket image using Gemini Vision AI. Uploads the image and extracts structured data: store name, suggested category, line items (description, quantity, price, total), and grand total. The image must be base64-encoded (without data URI prefix). Accepts PNG, JPEG, WEBP up to 8MB. Rate limited to 10 calls per 5 minutes.",
      inputSchema: {
        imageBase64: z
          .string()
          .describe(
            "Base64-encoded image data of the receipt, without a data URI prefix.",
          ),
        mimeType: z
          .string()
          .optional()
          .describe(
            'MIME type of the image (e.g. "image/png", "image/jpeg", "image/webp"). Defaults to "image/jpeg".',
          ),
      },
    },
    async (args) => {
      const mimeType = args.mimeType ?? "image/jpeg";

      const buffer = Buffer.from(args.imageBase64, "base64");
      const blob = new Blob([buffer], { type: mimeType });
      const file = new File([blob], "receipt.jpg", { type: mimeType });

      const fd = new FormData();
      fd.append("image", file);

      const result = await api.postForm("/api/ocr", fd);
      return toToolResult(result);
    },
  );
};
