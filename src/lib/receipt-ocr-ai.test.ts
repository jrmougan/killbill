import { afterEach, describe, expect, it, vi } from "vitest";
import {
    analyzeReceiptImage,
    parseReceiptAIResponse,
    ReceiptAIError,
} from "./receipt-ocr-ai";

const RECEIPT = {
    store: "MERCADONA",
    category: "shopping",
    items: [{ description: "LECHE", quantity: 1, price: 1.2, total: 1.2 }],
    total: 1.2,
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function geminiResponse(content: string): Response {
    return jsonResponse({ candidates: [{ content: { parts: [{ text: content }] } }] });
}

function openRouterResponse(content: string): Response {
    return jsonResponse({ choices: [{ message: { content } }] });
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("parseReceiptAIResponse", () => {
    it("parses JSON wrapped in a markdown fence", () => {
        expect(parseReceiptAIResponse(`\`\`\`json\n${JSON.stringify(RECEIPT)}\n\`\`\``)).toEqual(RECEIPT);
    });

    it("repairs a response truncated after a complete item", () => {
        const truncated = '{"store":"SHOP","category":"shopping","items":[{"description":"PAN","quantity":1,"price":1,"total":1},{"description":"LE';

        expect(parseReceiptAIResponse(truncated)).toEqual({
            store: "SHOP",
            category: "shopping",
            items: [{ description: "PAN", quantity: 1, price: 1, total: 1 }],
            total: 0,
        });
    });

    it("rejects JSON with an invalid receipt shape", () => {
        expect(() => parseReceiptAIResponse('{"items":"not-an-array"}')).toThrow(ReceiptAIError);
    });
});

describe("analyzeReceiptImage", () => {
    it("uses Gemini without calling OpenRouter when the primary succeeds", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    });

    it("falls back to OpenRouter after a Gemini HTTP error", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: "quota" }, 429))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/png")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");

        const request = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        expect(request.model).toBe("qwen/qwen3-vl-235b-a22b-instruct");
        expect(request.provider).toEqual({ require_parameters: true, data_collection: "deny" });
        expect(request.response_format.json_schema.strict).toBe(true);
        expect(request.messages[0].content[1].image_url.url).toBe("data:image/png;base64,base64");
    });

    it("falls back when Gemini returns invalid JSON", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(geminiResponse("not json"))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/webp")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("falls back when Gemini returns an empty response", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ candidates: [] }))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("can use OpenRouter when Gemini is not configured", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        const fetchMock = vi.fn().mockResolvedValue(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    });

    it("returns a provider error when both attempts fail", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

        await expect(analyzeReceiptImage("base64", "image/jpeg")).rejects.toThrow(ReceiptAIError);
    });
});
