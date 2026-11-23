import { DEFAULT_MODELS, getAiRuntimeConfig } from "@/lib/ai-settings";
import { isValidModelId, type AiModelOption, type AiProviderId } from "@/lib/ai-settings-schemas";
import { testProviderBase } from "@/lib/receipt-ocr-ai";

/**
 * Lists the models of each OCR provider that can read an image (server only),
 * for the selector at /admin/ai. The hosts are fixed; nothing here takes a URL
 * from a request. The key travels in a header, never in the URL, and is never
 * logged or returned: a failure only logs the provider, the HTTP status and the
 * error name.
 */

/** Interactive admin call: much shorter than the OCR deadline. One deadline for the whole listing, pages included. */
export const MODEL_LIST_TIMEOUT_MS = 10_000;
/** Upper bound of followed pages per listing. */
export const MODEL_LIST_MAX_PAGES = 5;
const MAX_MODELS = 1000;
const MAX_LABEL_LENGTH = 128;

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models";
const OPENROUTER_ORIGIN = "https://openrouter.ai";
const OPENROUTER_PATH = "/api/v1/models";
const OPENROUTER_CHAT_ENDPOINT = "/api/v1/chat/completions";

/**
 * HEURISTIC. The Gemini API exposes no input-modality field, so vision support is
 * inferred from the id: `gemini-*` models that answer `generateContent` are
 * multimodal except these families (embeddings, TTS, speech-to-text, live/native
 * audio, image and video generation, robotics, computer use, decision). A new
 * non-vision family has to be added here by hand.
 */
export const GEMINI_NON_VISION_PATTERN =
    /(embedding|-tts|transcribe|-live|native-audio|-image|nano-banana|omni|robotics|computer-use|decision|-audio|-dialog)/i;

export type AiModelsFailure = "key-missing" | "key-rejected" | "rate-limited" | "unavailable";

/** Why a listing failed. The message is the reason only: no provider text, no key. */
export class AiModelsError extends Error {
    constructor(public readonly reason: AiModelsFailure) {
        super(`AI model listing failed: ${reason}`);
        this.name = "AiModelsError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function label(value: unknown, id: string): string {
    const text = typeof value === "string" ? value.trim().slice(0, MAX_LABEL_LENGTH) : "";
    return text || id;
}

function failureForStatus(status: number): AiModelsFailure {
    if (status === 401 || status === 403) return "key-rejected";
    if (status === 429) return "rate-limited";
    return "unavailable";
}

// Google answers an invalid key with 400 INVALID_ARGUMENT + reason API_KEY_INVALID, not 401.
function isGeminiInvalidKey(body: unknown): boolean {
    const error = isRecord(body) ? body.error : null;
    const details = isRecord(error) && Array.isArray(error.details) ? error.details : [];
    return details.some((detail) => isRecord(detail) && detail.reason === "API_KEY_INVALID");
}

/**
 * One GET that resolves to the parsed JSON or throws AiModelsError. Redirects are
 * refused: a redirect would carry the key header to wherever the answer points.
 */
async function getJson(
    provider: AiProviderId,
    url: URL,
    headers: Record<string, string>,
    signal: AbortSignal,
): Promise<unknown> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json", ...headers },
            redirect: "error",
            cache: "no-store",
            signal,
        });
    } catch (error) {
        const name = error instanceof Error ? error.name : "unknown error";
        console.warn(`AI models: ${provider} listing failed (${name})`);
        throw new AiModelsError("unavailable");
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
        console.warn(`AI models: ${provider} listing failed (HTTP ${response.status})`);
        if (provider === "gemini" && response.status === 400 && isGeminiInvalidKey(body)) {
            throw new AiModelsError("key-rejected");
        }
        throw new AiModelsError(failureForStatus(response.status));
    }
    if (body === undefined) {
        console.warn(`AI models: ${provider} listing failed (invalid JSON)`);
        throw new AiModelsError("unavailable");
    }
    return body;
}

function unique(models: AiModelOption[]): AiModelOption[] {
    const seen = new Set<string>();
    return models.filter((model) => !seen.has(model.id) && Boolean(seen.add(model.id))).slice(0, MAX_MODELS);
}

/** Vision filter + id normalization for one page of Gemini `models.list`. */
export function geminiVisionModels(models: unknown): AiModelOption[] {
    if (!Array.isArray(models)) return [];
    const result: AiModelOption[] = [];
    for (const model of models) {
        if (!isRecord(model) || typeof model.name !== "string") continue;
        // `name` is "models/<id>"; the id is what callGemini puts in the URL path.
        // `baseModelId` is not used: it collapses versions and aliases.
        const id = model.name.replace(/^models\//, "");
        if (!stringArray(model.supportedGenerationMethods).includes("generateContent")) continue;
        if (!/^gemini-/.test(id) || GEMINI_NON_VISION_PATTERN.test(id)) continue;
        if (!isValidModelId("gemini", id)) continue;
        result.push({ id, label: label(model.displayName, id) });
    }
    return result;
}

/** `*-latest` aliases first, then newest version first. */
export function sortGeminiModels(models: AiModelOption[]): AiModelOption[] {
    const isAlias = (id: string) => id.endsWith("-latest");
    return [...models].sort((a, b) => {
        if (isAlias(a.id) !== isAlias(b.id)) return isAlias(a.id) ? -1 : 1;
        return b.id.localeCompare(a.id, undefined, { numeric: true });
    });
}

/**
 * Vision filter for one page of OpenRouter `/models`. The query already asks for
 * image input, but every condition is re-checked here. `structured_outputs` is
 * required because the OCR call sends a strict JSON schema with
 * `require_parameters`; a model without it would fail every scan.
 */
export function openRouterVisionModels(models: unknown): AiModelOption[] {
    if (!Array.isArray(models)) return [];
    const result: AiModelOption[] = [];
    for (const model of models) {
        if (!isRecord(model) || typeof model.id !== "string") continue;
        const { id } = model;
        const architecture = isRecord(model.architecture) ? model.architecture : {};
        const output = stringArray(architecture.output_modalities);
        if (!stringArray(architecture.input_modalities).includes("image")) continue;
        // Exactly text: drops image/audio/video generators and the auto routers.
        if (output.length !== 1 || output[0] !== "text") continue;
        if (!stringArray(model.supported_parameters).includes("structured_outputs")) continue;
        if (!stringArray(model.endpoints).includes(OPENROUTER_CHAT_ENDPOINT)) continue;
        // Batch variants cannot serve a synchronous call; `~alias` ids fail the stored pattern.
        if (id.endsWith(":batch") || !isValidModelId("openrouter", id)) continue;
        result.push({ id, label: label(model.name, id) });
    }
    return result;
}

async function listGeminiModels(apiKey: string, testBase: string | null, signal: AbortSignal): Promise<AiModelOption[]> {
    const models: AiModelOption[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MODEL_LIST_MAX_PAGES; page++) {
        const url = new URL(testBase ? `${testBase}/gemini/models` : `${GEMINI_ORIGIN}${GEMINI_PATH}`);
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const body = await getJson("gemini", url, { "x-goog-api-key": apiKey }, signal);
        const data = isRecord(body) ? body : {};
        models.push(...geminiVisionModels(data.models));
        pageToken = typeof data.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : null;
        if (!pageToken) break;
    }
    // The built-in default is an alias known to work; keep it selectable even if unlisted.
    if (!models.some((model) => model.id === DEFAULT_MODELS.gemini)) {
        models.push({ id: DEFAULT_MODELS.gemini, label: DEFAULT_MODELS.gemini });
    }
    return unique(sortGeminiModels(models));
}

// The endpoint is public and does not validate a bearer, so no key is sent: the
// stored key never leaves the server for a listing.
async function listOpenRouterModels(testBase: string | null, signal: AbortSignal): Promise<AiModelOption[]> {
    const first = new URL(testBase ? `${testBase}/openrouter/models` : `${OPENROUTER_ORIGIN}${OPENROUTER_PATH}`);
    first.searchParams.set("input_modalities", "image");
    first.searchParams.set("output_modalities", "text");

    const models: AiModelOption[] = [];
    let url: URL | null = first;
    for (let page = 0; url && page < MODEL_LIST_MAX_PAGES; page++) {
        const body = await getJson("openrouter", url, { "X-OpenRouter-Title": "Kill Bill" }, signal);
        const data = isRecord(body) ? body : {};
        // API order is newest first; it is kept.
        models.push(...openRouterVisionModels(data.data));
        url = nextOpenRouterPage(data.links, url, first);
    }
    return unique(models);
}

// `links.next` comes from the provider: only the same host and path are followed.
function nextOpenRouterPage(links: unknown, current: URL, first: URL): URL | null {
    const next = isRecord(links) ? links.next : null;
    if (typeof next !== "string" || !next) return null;
    let url: URL;
    try {
        url = new URL(next, current);
    } catch {
        return null;
    }
    if (url.origin !== first.origin || url.pathname !== first.pathname || url.username || url.password) return null;
    return url.href === current.href ? null : url;
}

/**
 * Vision-capable models of one provider, with ids ready to be stored. Throws
 * AiModelsError. While the OCR test seam is active the loopback stub is used and
 * the DB is never read, so only the env fake key can reach it.
 */
export async function listVisionModels(provider: AiProviderId): Promise<AiModelOption[]> {
    const testBase = testProviderBase();
    if (provider === "openrouter") {
        return listOpenRouterModels(testBase, AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS));
    }

    const apiKey = testBase ? process.env.GEMINI_API_KEY || null : (await getAiRuntimeConfig()).gemini.apiKey;
    if (!apiKey) throw new AiModelsError("key-missing");
    // Created after the key lookup: the deadline covers the provider calls, every page of them.
    return listGeminiModels(apiKey, testBase, AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS));
}
