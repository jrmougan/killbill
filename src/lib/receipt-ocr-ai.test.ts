import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./secret-box";
import {
    analyzeReceiptImage,
    parseReceiptAIResponse,
    PROVIDER_TIMEOUT_MS,
    ReceiptAIError,
} from "./receipt-ocr-ai";

// Only the DB is faked: ai-settings and secret-box run for real, so these tests
// cover the precedence and decryption the OCR actually gets.
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { aiProviderConfig: { findMany } } }));

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

beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
});

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

    it("sends the Gemini key in the x-goog-api-key header, never in the URL", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-secret");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).not.toContain("gemini-secret");
        expect(url).not.toContain("key=");
        expect(init.headers["x-goog-api-key"]).toBe("gemini-secret");
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("treats a Gemini timeout as a failure and falls back to OpenRouter", async () => {
        vi.stubEnv("GEMINI_API_KEY", "gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
        // Gemini hangs until its deadline signal fires; OpenRouter answers.
        const fetchMock = vi.fn((url: string, init: RequestInit) => {
            if (url.includes("generativelanguage")) {
                return new Promise<Response>((_, reject) => {
                    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
                });
            }
            return Promise.resolve(openRouterResponse(JSON.stringify(RECEIPT)));
        });
        vi.stubGlobal("fetch", fetchMock);
        timeoutSpy.mockImplementationOnce(() => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), 5);
            return controller.signal;
        });

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);
        expect(timeoutSpy).toHaveBeenCalledWith(PROVIDER_TIMEOUT_MS);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
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

describe("analyzeReceiptImage with stored settings", () => {
    const row = (provider: "GEMINI" | "OPENROUTER", apiKey: string | null, model: string | null = null) => ({
        provider,
        encryptedApiKey: apiKey === null ? null : encryptSecret(apiKey, provider.toLowerCase()),
        model,
    });

    beforeEach(() => {
        vi.stubEnv("JWT_SECRET", "test-jwt-secret");
        vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
        vi.stubEnv("GEMINI_API_KEY", "env-gemini-key");
        vi.stubEnv("OPENROUTER_API_KEY", "env-openrouter-key");
        vi.stubEnv("OPENROUTER_OCR_MODEL", "env/model");
    });

    it("prefers the stored Gemini key and model over env, with the model in the URL", async () => {
        findMany.mockResolvedValue([row("GEMINI", "db-gemini-key", "gemini-2.5-pro")]);
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent");
        expect(init.headers["x-goog-api-key"]).toBe("db-gemini-key");
    });

    it("keeps the built-in Gemini model when none is stored", async () => {
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
        expect(init.headers["x-goog-api-key"]).toBe("env-gemini-key");
    });

    it("encodes the Gemini model so it cannot alter the URL path", async () => {
        findMany.mockResolvedValue([row("GEMINI", null, "../evil model?x=1")]);
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        expect(fetchMock.mock.calls[0][0]).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/..%2Fevil%20model%3Fx%3D1:generateContent",
        );
    });

    it("prefers the stored OpenRouter key and model, sending the model in the body", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        findMany.mockResolvedValue([row("OPENROUTER", "db-openrouter-key", "anthropic/claude:free")]);
        const fetchMock = vi.fn().mockResolvedValue(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(init.headers.Authorization).toBe("Bearer db-openrouter-key");
        expect(JSON.parse(init.body as string).model).toBe("anthropic/claude:free");
    });

    it("uses the env OpenRouter model when none is stored", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const fetchMock = vi.fn().mockResolvedValue(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await analyzeReceiptImage("base64", "image/jpeg");

        expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).model).toBe("env/model");
    });

    it("works with stored keys only, in the fallback order Gemini then OpenRouter", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        findMany.mockResolvedValue([row("OPENROUTER", "db-openrouter-key"), row("GEMINI", "db-gemini-key")]);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ error: "quota" }, 429))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);

        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("db-gemini-key");
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer db-openrouter-key");
    });

    it("falls back to the env key when a stored key cannot be decrypted, logging no secret", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const stored = row("GEMINI", "db-gemini-key");
        vi.stubEnv("JWT_SECRET", "rotated-jwt-secret");
        findMany.mockResolvedValue([stored]);
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);

        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("env-gemini-key");
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).not.toContain(stored.encryptedApiKey);
    });

    it("falls back to env when the DB read fails", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        findMany.mockRejectedValue(new Error("db down"));
        const fetchMock = vi.fn().mockResolvedValue(geminiResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg")).resolves.toEqual(RECEIPT);

        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("env-gemini-key");
    });

    it("keeps the error message when no provider has a key anywhere", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENROUTER_API_KEY", "");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("base64", "image/jpeg"))
            .rejects.toThrow(new ReceiptAIError("GEMINI_API_KEY or OPENROUTER_API_KEY must be configured"));
        expect(fetchMock).not.toHaveBeenCalled();
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

    it("never reads the DB while the seam is active, so a stored key cannot reach it", async () => {
        configureTestProvider();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        findMany.mockResolvedValue([{ provider: "GEMINI", encryptedApiKey: "stored", model: "stored-model" }]);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(geminiResponse("invalid"))
            .mockResolvedValueOnce(openRouterResponse(JSON.stringify(RECEIPT)));
        vi.stubGlobal("fetch", fetchMock);

        await expect(analyzeReceiptImage("image", "image/png")).resolves.toEqual(RECEIPT);

        expect(findMany).not.toHaveBeenCalled();
        expect(fetchMock.mock.calls[0][1].headers["x-goog-api-key"]).toBe("ocr-e2e-fake");
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer ocr-e2e-fake");
    });

    it("does not read the DB when the seam is misconfigured", async () => {
        configureTestProvider();
        vi.stubEnv("GEMINI_API_KEY", "real-secret");
        vi.stubGlobal("fetch", vi.fn());

        await expect(analyzeReceiptImage("image", "image/png")).rejects.toThrow(ReceiptAIError);

        expect(findMany).not.toHaveBeenCalled();
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
