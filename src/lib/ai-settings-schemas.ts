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

const API_KEY_MESSAGE = "La clave de API debe tener entre 8 y 512 caracteres, sin espacios";
const MODEL_MESSAGE = "El nombre del modelo no es válido";

// Printable ASCII without spaces: the key goes into an HTTP header.
const API_KEY_PATTERN = /^[\x21-\x7E]+$/;

// The Gemini model goes into a URL path (no slashes); OpenRouter ids are vendor/model.
const MODEL_PATTERNS: Record<AiProviderId, RegExp> = {
    gemini: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
    openrouter: /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/,
};

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
    if (typeof body.model === "string" && !MODEL_PATTERNS[body.provider].test(body.model)) {
        ctx.addIssue({ code: "custom", path: ["model"], message: MODEL_MESSAGE });
    }
});

export type UpdateAiSettingsInput = z.infer<typeof UpdateAiSettingsBody>;
