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

    it("rejects a receipt with a total but no line items", () => {
        expect(() => parseReceiptAIResponse('{"store":"ALCAMPO","category":"shopping","items":[],"total":60.39}'))
            .toThrow(ReceiptAIError);
    });

    it("accepts an empty receipt with a zero total", () => {
        expect(parseReceiptAIResponse('{"store":"","category":"","items":[],"total":0}').items).toEqual([]);
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

    it("sends Gemini a schema without additionalProperties", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        const body = fetchMock.mock.calls[0][1].body as string;
        expect(body).not.toContain("additionalProperties");
        expect(JSON.parse(body).generationConfig.responseSchema.properties.items.items.required)
            .toEqual(["description", "quantity", "price", "total"]);
    });

    it("keeps additionalProperties in the OpenRouter strict schema", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        const fetchMock = vi.fn().mockResolvedValue(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        const schema = JSON.parse(fetchMock.mock.calls[0][1].body as string).response_format.json_schema.schema;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.properties.items.items.additionalProperties).toBe(false);
    });

    it("logs the provider error body, not only the status", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: { message: "Unknown name \"additionalProperties\"" } }, 400))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        expect(warn.mock.calls[0][0]).toContain("Gemini HTTP 400");
        expect(warn.mock.calls[0][0]).toContain("additionalProperties");
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
        expect(request.model).toBe("xiaomi/mimo-v2.6-flash");
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

    it("falls back when Gemini returns a total without line items", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(geminiResponse(JSON.stringify({ ...RECEIPT, items: [] })))
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

describe("OCR test provider gate", () => {
    function configureTestProvider() {
        vi.stubEnv("OCR_TEST_PROVIDER_URL", "http://127.0.0.1:4567");
        vi.stubEnv("TEST_ROUTES_ENABLED", "true");
        vi.stubEnv("GEMINI_API_KEY", "ocr-e2e-fake");
        vi.stubEnv("OPENROUTER_API_KEY", "ocr-e2e-fake");
    }

    it.each(["", "false", "TRUE"])("rejects a configured seam when test routes are %s", async flag => {
        configureTestProvider();
        vi.stubEnv("TEST_ROUTES_ENABLED", flag);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).rejects.toThrow(ReceiptAIError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        "https://127.0.0.1:4567", "http://example.com:4567", "http://localhost:4567",
        "http://127.0.0.1", "http://secret@127.0.0.1:4567", "http://127.0.0.1:4567/path",
        "http://127.0.0.1:4567?key=secret", "http://127.0.0.1:4567#secret", "invalid",
    ])("rejects unsafe provider URL %s before any request", async url => {
        configureTestProvider();
        vi.stubEnv("OCR_TEST_PROVIDER_URL", url);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).rejects.toThrow(ReceiptAIError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(["GEMINI_API_KEY", "OPENROUTER_API_KEY"])("rejects real %s credentials before fetch", async key => {
        configureTestProvider();
        vi.stubEnv(key, "real-secret");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).rejects.toThrow(ReceiptAIError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the local Gemini response through the normal parser", async () => {
        configureTestProvider();
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).resolves.toEqual(RECEIPT);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4567/gemini");
        expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
    });

    it("keeps validation and fallback local when Gemini JSON is invalid", async () => {
        configureTestProvider();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(geminiResponse("invalid"))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).resolves.toEqual(RECEIPT);
        expect(fetchMock.mock.calls.map(call => call[0]))
            .toEqual(["http://127.0.0.1:4567/gemini", "http://127.0.0.1:4567/openrouter"]);
        expect(fetchMock.mock.calls[1][1].redirect).toBe("error");
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer ocr-e2e-fake");
    });

    it("does not escape to a real provider if the local server is unavailable", async () => {
        configureTestProvider();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const fetchMock = vi.fn().mockRejectedValue(new Error("Connection refused"));
        vi.stubGlobal("fetch", fetchMock);
        await expect(analyzeReceiptImage("image", "image/png")).rejects.toThrow(ReceiptAIError);
        expect(fetchMock.mock.calls.map(call => call[0]))
            .toEqual(["http://127.0.0.1:4567/gemini", "http://127.0.0.1:4567/openrouter"]);
    });
});
