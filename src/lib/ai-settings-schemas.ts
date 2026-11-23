/**
 * Contract of the admin AI settings API (pure: zod and types only, safe for
 * `import type` from client components). Error messages never echo the submitted
 * value, since it may be an API key.
 */
import { z } from "zod";
import { jsonObject } from "@/lib/http/schemas";

export const AI_PROVIDERS = ["gemini", "openrouter"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export type KeySource = "database" | "environment" | "none";
export type ModelSource = "database" | "environment" | "default";

export interface AiProviderView {
    provider: AiProviderId;
    keySource: KeySource;
    /** Last 4 characters of the effective key; never the key itself. */
    keyHint: string | null;
    /** A stored key exists but cannot be decrypted (secret rotated). */
    keyUndecryptable: boolean;
    model: string;
    modelSource: ModelSource;
    defaultModel: string;
    /** What a cleared model resolves to: the env model if set, else defaultModel. */
    fallbackModel: string;
}

export interface AiSettingsView {
    providers: AiProviderView[];
}

/** One vision-capable model a provider offers; `id` is exactly what PATCH stores. */
export interface AiModelOption {
    id: string;
    label: string;
}

/** `GET /api/admin/ai-settings/models?provider=…` */
export interface AiModelsView {
    provider: AiProviderId;
    models: AiModelOption[];
}

/** `code` of the model-listing errors (API contract, `docs/agents/ocr-llm.md`). The form only shows the message. */
export const AI_MODELS_ERROR_CODES = {
    keyMissing: "AI_KEY_MISSING",
    keyRejected: "AI_KEY_REJECTED",
    rateLimited: "AI_PROVIDER_RATE_LIMITED",
    unavailable: "AI_PROVIDER_UNAVAILABLE",
} as const;

const API_KEY_MESSAGE = "La clave de API debe tener entre 8 y 512 caracteres, sin espacios";
const MODEL_MESSAGE = "El nombre del modelo no es válido";

// Printable ASCII without spaces: the key goes into an HTTP header.
const API_KEY_PATTERN = /^[\x21-\x7E]+$/;

// The Gemini model goes into a URL path (no slashes); OpenRouter ids are vendor/model.
const MODEL_PATTERNS: Record<AiProviderId, RegExp> = {
    gemini: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    openrouter: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/,
};

/** Whether PATCH would accept this id as the provider's model. */
export function isValidModelId(provider: AiProviderId, id: string): boolean {
    return MODEL_PATTERNS[provider].test(id);
}

export const AiModelsQuery = z.object({
    provider: z.enum(AI_PROVIDERS, { error: "Proveedor no válido" }),
});

/** undefined = leave unchanged, null = clear. At least one of apiKey/model is required. */
export const UpdateAiSettingsBody = jsonObject({
    provider: z.enum(AI_PROVIDERS, { error: "Proveedor no válido" }),
    apiKey: z
        .string({ error: API_KEY_MESSAGE })
        .trim()
        .min(8, API_KEY_MESSAGE)
        .max(512, API_KEY_MESSAGE)
        .regex(API_KEY_PATTERN, API_KEY_MESSAGE)
        .nullable()
        .optional(),
    model: z.string({ error: MODEL_MESSAGE }).nullable().optional(),
}).superRefine((body, ctx) => {
    if (body.apiKey === undefined && body.model === undefined) {
        ctx.addIssue({ code: "custom", message: "Indica una clave de API o un modelo" });
    }
    if (typeof body.model === "string" && !isValidModelId(body.provider, body.model)) {
        ctx.addIssue({ code: "custom", path: ["model"], message: MODEL_MESSAGE });
    }
});

export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsBody>;
