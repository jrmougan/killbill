import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./secret-box";
import {
    AiModelsError,
    GEMINI_NON_VISION_PATTERN,
    MODEL_LIST_MAX_PAGES,
    MODEL_LIST_TIMEOUT_MS,
    geminiVisionModels,
    listVisionModels,
    openRouterVisionModels,
    sortGeminiModels,
} from "./ai-models";
import { ReceiptAIError } from "./receipt-ocr-ai";

// Only the DB is faked: ai-settings and secret-box run for real.
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { aiProviderConfig: { findMany } } }));

const ENV_KEY = "env-gemini-key-SECRET-1234";
const DB_KEY = "db-gemini-key-SECRET-9876";
const CHAT = "/api/v1/chat/completions";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const gem = (id: string, methods = ["generateContent"], displayName?: string) => ({
    name: `models/${id}`,
    displayName,
    supportedGenerationMethods: methods,
});

const router = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: `Name of ${id}`,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["structured_outputs"],
    endpoints: [CHAT],
    ...over,
});

const callUrl = (index: number) => new URL(String(fetchMock.mock.calls[index][0]));
const callInit = (index: number) => fetchMock.mock.calls[index][1] as RequestInit & { headers: Record<string, string> };
const failure = (promise: Promise<unknown>) =>
    promise.then(
        () => {
            throw new Error("expected a rejection");
        },
        (error: unknown) => error,
    );

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
    vi.stubEnv("JWT_SECRET", "jwt-secret-for-tests");
    vi.stubEnv("GEMINI_API_KEY", ENV_KEY);
    vi.stubEnv("OPENROUTER_API_KEY", "env-openrouter-key-SECRET");
    vi.stubEnv("OCR_TEST_PROVIDER_URL", "");
    vi.stubEnv("TEST_ROUTES_ENABLED", "");
    findMany.mockResolvedValue([]);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    warn.mockRestore();
});

describe("geminiVisionModels", () => {
    it("keeps gemini generateContent models and strips the models/ prefix", () => {
        expect(
            geminiVisionModels([
                gem("gemini-2.5-flash", ["generateContent", "countTokens"], "Gemini 2.5 Flash"),
                gem("gemini-pro-latest"),
            ]),
        ).toEqual([
            { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { id: "gemini-pro-latest", label: "gemini-pro-latest" },
        ]);
    });

    it.each([
        ["an embedding model", gem("gemini-embedding-001", ["embedContent"])],
        ["a predict-only model", gem("gemini-2.5-flash", ["predict"])],
        ["a model without methods", { name: "models/gemini-2.5-flash" }],
        ["a non-gemini family", gem("gemma-3-27b-it")],
        ["a TTS model", gem("gemini-2.5-flash-preview-tts")],
        ["an image generator", gem("gemini-2.5-flash-image")],
        ["a live model", gem("gemini-3.1-flash-live-preview")],
        ["a native audio model", gem("gemini-2.5-flash-native-audio-latest")],
        ["a robotics model", gem("gemini-robotics-er-1.5-preview")],
        ["a computer-use model", gem("gemini-2.5-computer-use-preview")],
        ["an id the PATCH schema would refuse", gem("gemini-bad/slash")],
        ["an over-long id", gem(`gemini-${"x".repeat(130)}`)],
        ["an entry without a name", { supportedGenerationMethods: ["generateContent"] }],
        ["a non-object entry", "gemini-2.5-flash"],
    ])("drops %s", (_name, model) => {
        expect(geminiVisionModels([model])).toEqual([]);
    });

    it("treats a missing or non-array list as empty", () => {
        expect(geminiVisionModels(undefined)).toEqual([]);
        expect(geminiVisionModels({ models: [] })).toEqual([]);
    });

    it("the deny pattern is case-insensitive", () => {
        expect(GEMINI_NON_VISION_PATTERN.test("gemini-2.5-Flash-TTS")).toBe(true);
        expect(GEMINI_NON_VISION_PATTERN.test("gemini-2.5-flash-lite")).toBe(false);
    });
});

describe("sortGeminiModels", () => {
    it("puts -latest aliases first, then the newest version first", () => {
        const ids = ["gemini-2.5-flash", "gemini-10.0-pro", "gemini-flash-latest", "gemini-3.1-pro", "gemini-pro-latest"];
        expect(sortGeminiModels(ids.map((id) => ({ id, label: id }))).map((model) => model.id)).toEqual([
            "gemini-pro-latest",
            "gemini-flash-latest",
            "gemini-10.0-pro",
            "gemini-3.1-pro",
            "gemini-2.5-flash",
        ]);
    });
});

describe("openRouterVisionModels", () => {
    it("keeps a vision model with structured outputs, id verbatim (including :free)", () => {
        expect(openRouterVisionModels([router("xiaomi/mimo-v2.6-flash"), router("google/gemma-3:free")])).toEqual([
            { id: "xiaomi/mimo-v2.6-flash", label: "Name of xiaomi/mimo-v2.6-flash" },
            { id: "google/gemma-3:free", label: "Name of google/gemma-3:free" },
        ]);
    });

    it.each([
        ["a text-only model", router("a/b", { architecture: { input_modalities: ["text"], output_modalities: ["text"] } })],
        ["a model that also outputs images", router("a/b", { architecture: { input_modalities: ["image"], output_modalities: ["image", "text"] } })],
        ["a model without architecture", router("a/b", { architecture: undefined })],
        ["a model without structured_outputs", router("a/b", { supported_parameters: ["temperature"] })],
        ["a model without the chat endpoint", router("a/b", { endpoints: ["/api/v1/embeddings"] })],
        ["a :batch variant", router("a/b:batch")],
        ["a ~alias id", router("~google/gemini-flash-latest")],
        ["an entry without id", { ...router("a/b"), id: undefined }],
    ])("drops %s", (_name, model) => {
        expect(openRouterVisionModels([model])).toEqual([]);
    });

    it("falls back to the id when the name is missing", () => {
        expect(openRouterVisionModels([router("a/b", { name: "  " })])).toEqual([{ id: "a/b", label: "a/b" }]);
    });
});

describe("listVisionModels('gemini')", () => {
    it("calls the fixed Google host with the key in a header, never in the URL", async () => {
        fetchMock.mockResolvedValueOnce(json({ models: [gem("gemini-2.5-flash"), gem("gemini-flash-latest")] }));

        const models = await listVisionModels("gemini");

        expect(models.map((model) => model.id)).toEqual(["gemini-flash-latest", "gemini-2.5-flash"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = callUrl(0);
        expect(url.origin + url.pathname).toBe("https://generativelanguage.googleapis.com/v1beta/models");
        expect(url.searchParams.get("pageSize")).toBe("1000");
        expect(url.href).not.toContain(ENV_KEY);
        expect(url.searchParams.has("key")).toBe(false);
        const init = callInit(0);
        expect(init.method).toBe("GET");
        expect(init.headers["x-goog-api-key"]).toBe(ENV_KEY);
        expect(init.redirect).toBe("error");
        expect(init.cache).toBe("no-store");
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it("uses the stored key over the env one", async () => {
        findMany.mockResolvedValue([{ provider: "GEMINI", encryptedApiKey: encryptSecret(DB_KEY, "gemini"), model: null }]);
        fetchMock.mockResolvedValueOnce(json({ models: [] }));

        await listVisionModels("gemini");

        expect(callInit(0).headers["x-goog-api-key"]).toBe(DB_KEY);
    });

    it("follows nextPageToken and merges the pages", async () => {
        fetchMock
            .mockResolvedValueOnce(json({ models: [gem("gemini-2.5-flash")], nextPageToken: "tok 2" }))
            .mockResolvedValueOnce(json({ models: [gem("gemini-3.1-pro"), gem("gemini-2.5-flash")] }));

        const models = await listVisionModels("gemini");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(callUrl(0).searchParams.has("pageToken")).toBe(false);
        expect(callUrl(1).searchParams.get("pageToken")).toBe("tok 2");
        expect(callUrl(1).searchParams.get("pageSize")).toBe("1000");
        // Duplicates collapse; the default alias is always offered.
        expect(models.map((model) => model.id)).toEqual(["gemini-flash-latest", "gemini-3.1-pro", "gemini-2.5-flash"]);
    });

    it("stops after the page cap even if the provider keeps paginating", async () => {
        fetchMock.mockImplementation(async () => json({ models: [], nextPageToken: "again" }));
        await listVisionModels("gemini");
        expect(fetchMock).toHaveBeenCalledTimes(MODEL_LIST_MAX_PAGES);
    });

    it("always offers the default model, even on a 200 without a models array", async () => {
        fetchMock.mockResolvedValueOnce(json({}));
        expect(await listVisionModels("gemini")).toEqual([{ id: "gemini-flash-latest", label: "gemini-flash-latest" }]);
    });

    it("fails with key-missing, without calling Google, when no key is configured", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const error = await failure(listVisionModels("gemini"));
        expect(error).toBeInstanceOf(AiModelsError);
        expect((error as AiModelsError).reason).toBe("key-missing");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ["400 API_KEY_INVALID", 400, { error: { code: 400, status: "INVALID_ARGUMENT", message: `bad ${ENV_KEY}`, details: [{ reason: "API_KEY_INVALID" }] } }, "key-rejected"],
        ["401", 401, { error: { message: "nope" } }, "key-rejected"],
        ["403 PERMISSION_DENIED", 403, { error: { status: "PERMISSION_DENIED" } }, "key-rejected"],
        ["429", 429, { error: { status: "RESOURCE_EXHAUSTED" } }, "rate-limited"],
        ["another 400", 400, { error: { status: "INVALID_ARGUMENT" } }, "unavailable"],
        ["500", 500, { error: {} }, "unavailable"],
        ["503 with a non-JSON body", 503, "<html>", "unavailable"],
    ])("maps %s to %s without leaking the provider body or the key", async (_name, status, body, reason) => {
        fetchMock.mockResolvedValueOnce(
            typeof body === "string" ? new Response(body, { status }) : json(body, status),
        );

        const error = (await failure(listVisionModels("gemini"))) as AiModelsError;

        expect(error).toBeInstanceOf(AiModelsError);
        expect(error.reason).toBe(reason);
        expect(error.message).not.toContain(ENV_KEY);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(ENV_KEY);
        expect(JSON.stringify(warn.mock.calls)).toContain(`HTTP ${status}`);
    });

    it("maps a timeout or a network failure to unavailable, logging only the error name", async () => {
        const timeout = new DOMException(`timed out calling with ${ENV_KEY}`, "TimeoutError");
        fetchMock.mockRejectedValueOnce(timeout).mockRejectedValueOnce(new TypeError(`fetch failed ${ENV_KEY}`));

        for (const name of ["TimeoutError", "TypeError"]) {
            const error = (await failure(listVisionModels("gemini"))) as AiModelsError;
            expect(error.reason).toBe("unavailable");
            expect(error.message).not.toContain(ENV_KEY);
            expect(JSON.stringify(warn.mock.calls)).toContain(name);
        }
        expect(JSON.stringify(warn.mock.calls)).not.toContain(ENV_KEY);
    });

    it("maps a 200 that is not JSON to unavailable", async () => {
        fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
        expect(((await failure(listVisionModels("gemini"))) as AiModelsError).reason).toBe("unavailable");
    });

    it("uses a 10 s deadline", async () => {
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
        fetchMock.mockResolvedValueOnce(json({ models: [] }));
        await listVisionModels("gemini");
        expect(MODEL_LIST_TIMEOUT_MS).toBe(10_000);
        expect(timeoutSpy).toHaveBeenCalledWith(MODEL_LIST_TIMEOUT_MS);
        timeoutSpy.mockRestore();
    });

    it.each(["gemini", "openrouter"] as const)("shares one deadline across every page (%s)", async (provider) => {
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
        let page = 0;
        fetchMock.mockImplementation(async () => {
            page++;
            return json({ models: [], nextPageToken: "again", data: [], links: { next: `?page=${page}` } });
        });
        await listVisionModels(provider);
        expect(fetchMock).toHaveBeenCalledTimes(MODEL_LIST_MAX_PAGES);
        expect(timeoutSpy).toHaveBeenCalledTimes(1);
        const signals = fetchMock.mock.calls.map((call) => (call[1] as RequestInit).signal);
        expect(new Set(signals).size).toBe(1);
        expect(signals[0]).toBe(timeoutSpy.mock.results[0].value);
        timeoutSpy.mockRestore();
    });
});

describe("listVisionModels('openrouter')", () => {
    it("asks the fixed host for image-input models and sends no credentials", async () => {
        fetchMock.mockResolvedValueOnce(
            json({ data: [router("b/newer"), router("a/text", { supported_parameters: [] }), router("a/older")], links: { next: null } }),
        );

        const models = await listVisionModels("openrouter");

        // Provider order (newest first) is kept.
        expect(models.map((model) => model.id)).toEqual(["b/newer", "a/older"]);
        const url = callUrl(0);
        expect(url.origin + url.pathname).toBe("https://openrouter.ai/api/v1/models");
        expect(url.searchParams.get("input_modalities")).toBe("image");
        expect(url.searchParams.get("output_modalities")).toBe("text");
        const headers = callInit(0).headers;
        expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("authorization");
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("env-openrouter-key-SECRET");
        expect(callInit(0).redirect).toBe("error");
    });

    it("lists without any key configured and without reading the database", async () => {
        vi.stubEnv("OPENROUTER_API_KEY", "");
        fetchMock.mockResolvedValueOnce(json({ data: [router("a/b")] }));
        expect(await listVisionModels("openrouter")).toHaveLength(1);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("follows links.next on the same host and path only", async () => {
        fetchMock
            .mockResolvedValueOnce(json({ data: [router("a/one")], links: { next: "https://openrouter.ai/api/v1/models?offset=1" } }))
            .mockResolvedValueOnce(json({ data: [router("a/two")], links: { next: "https://evil.example/api/v1/models?offset=2" } }));

        const models = await listVisionModels("openrouter");

        expect(models.map((model) => model.id)).toEqual(["a/one", "a/two"]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(callUrl(1).href).toBe("https://openrouter.ai/api/v1/models?offset=1");
    });

    it.each(["https://openrouter.ai/api/v1/key", "http://openrouter.ai/api/v1/models?offset=1", "https://user@openrouter.ai/api/v1/models?offset=1", "http://["])(
        "does not follow links.next %s",
        async (next) => {
            fetchMock.mockResolvedValueOnce(json({ data: [router("a/one")], links: { next } }));
            await listVisionModels("openrouter");
            expect(fetchMock).toHaveBeenCalledTimes(1);
        },
    );

    it("stops after the page cap", async () => {
        let offset = 0;
        fetchMock.mockImplementation(async () =>
            json({ data: [], links: { next: `https://openrouter.ai/api/v1/models?offset=${++offset}` } }),
        );
        await listVisionModels("openrouter");
        expect(fetchMock).toHaveBeenCalledTimes(MODEL_LIST_MAX_PAGES);
    });

    it.each([
        [429, "rate-limited"],
        [408, "unavailable"],
        [502, "unavailable"],
    ])("maps HTTP %i to %s", async (status, reason) => {
        fetchMock.mockResolvedValueOnce(json({ error: { code: status, message: "x" } }, status));
        expect(((await failure(listVisionModels("openrouter"))) as AiModelsError).reason).toBe(reason);
    });
});

describe("with the OCR test seam active", () => {
    const BASE = "http://127.0.0.1:4567";

    beforeEach(() => {
        vi.stubEnv("OCR_TEST_PROVIDER_URL", BASE);
        vi.stubEnv("TEST_ROUTES_ENABLED", "true");
        vi.stubEnv("GEMINI_API_KEY", "ocr-e2e-fake");
        vi.stubEnv("OPENROUTER_API_KEY", "ocr-e2e-fake");
        findMany.mockResolvedValue([{ provider: "GEMINI", encryptedApiKey: encryptSecret(DB_KEY, "gemini"), model: null }]);
    });

    it("lists Gemini from the loopback stub with the env fake key, never the stored one", async () => {
        fetchMock.mockResolvedValueOnce(json({ models: [gem("gemini-e2e-flash")] }));

        await listVisionModels("gemini");

        expect(callUrl(0).origin + callUrl(0).pathname).toBe(`${BASE}/gemini/models`);
        expect(callInit(0).headers["x-goog-api-key"]).toBe("ocr-e2e-fake");
        expect(callInit(0).redirect).toBe("error");
        expect(findMany).not.toHaveBeenCalled();
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(DB_KEY);
    });

    it("lists OpenRouter from the loopback stub and keeps pagination on it", async () => {
        fetchMock
            .mockResolvedValueOnce(json({ data: [router("a/one")], links: { next: `${BASE}/openrouter/models?offset=1` } }))
            .mockResolvedValueOnce(json({ data: [], links: { next: "https://openrouter.ai/api/v1/models?offset=2" } }));

        await listVisionModels("openrouter");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(callUrl(0).origin + callUrl(0).pathname).toBe(`${BASE}/openrouter/models`);
        expect(callUrl(1).origin).toBe(BASE);
    });

    it("refuses a misconfigured seam before any request", async () => {
        vi.stubEnv("GEMINI_API_KEY", "real-secret");
        await expect(listVisionModels("gemini")).rejects.toThrow(ReceiptAIError);
        await expect(listVisionModels("openrouter")).rejects.toThrow(ReceiptAIError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
