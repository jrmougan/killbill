import prisma from "@/lib/db";
import type { AiProvider } from "@/generated/prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import {
    AI_PROVIDERS,
    type AiProviderId,
    type AiProviderView,
    type AiSettingsView,
    type KeySource,
    type ModelSource,
} from "@/lib/ai-settings-schemas";

/**
 * Instance-wide LLM configuration (server only). Per provider, key: DB > env >
 * none; model: DB > env > built-in default. Nothing is cached: OCR is rare and the
 * DB stays the source of truth across instances. Keys are never logged and never
 * returned by the view (only source + last-4 hint).
 */
export const DEFAULT_MODELS: Record<AiProviderId, string> = {
    gemini: "gemini-flash-latest",
    openrouter: "xiaomi/mimo-v2.6-flash",
};

const DB_PROVIDER: Record<AiProviderId, AiProvider> = {
    gemini: "GEMINI",
    openrouter: "OPENROUTER",
};

interface StoredConfig {
    encryptedApiKey: string | null;
    model: string | null;
}

interface ResolvedProvider {
    apiKey: string | null;
    keySource: KeySource;
    keyUndecryptable: boolean;
    model: string;
    modelSource: ModelSource;
    fallbackModel: string;
}

// Empty-string env vars count as unset (`|| null`).
function envApiKey(provider: AiProviderId): string | null {
    const value = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY;
    return value || null;
}

function envModel(provider: AiProviderId): string | null {
    return provider === "openrouter" ? process.env.OPENROUTER_OCR_MODEL || null : null;
}

// Only the error's name is logged: the message is not needed to fall back and
// may carry connection details.
async function readStoredConfigs(): Promise<Map<AiProvider, StoredConfig>> {
    try {
        const rows = await prisma.aiProviderConfig.findMany({
            select: { provider: true, encryptedApiKey: true, model: true },
        });
        return new Map(rows.map((row) => [row.provider, row]));
    } catch (error) {
        const name = error instanceof Error ? error.name : "unknown error";
        console.warn(`AI settings: could not read the database (${name}), falling back to environment`);
        return new Map();
    }
}

function decryptStoredKey(provider: AiProviderId, payload: string): string | null {
    try {
        return decryptSecret(payload, provider);
    } catch {
        console.warn(`AI settings: stored ${provider} key could not be decrypted, falling back to environment`);
        return null;
    }
}

function resolveProvider(provider: AiProviderId, stored: StoredConfig | undefined): ResolvedProvider {
    const storedKey = stored?.encryptedApiKey ? decryptStoredKey(provider, stored.encryptedApiKey) : null;
    const environmentKey = envApiKey(provider);
    const environmentModel = envModel(provider);
    const fallbackModel = environmentModel || DEFAULT_MODELS[provider];

    return {
        apiKey: storedKey ?? environmentKey,
        keySource: storedKey ? "database" : environmentKey ? "environment" : "none",
        keyUndecryptable: Boolean(stored?.encryptedApiKey) && storedKey === null,
        model: stored?.model || fallbackModel,
        modelSource: stored?.model ? "database" : environmentModel ? "environment" : "default",
        fallbackModel,
    };
}

async function resolveAll(): Promise<Record<AiProviderId, ResolvedProvider>> {
    const stored = await readStoredConfigs();
    return {
        gemini: resolveProvider("gemini", stored.get(DB_PROVIDER.gemini)),
        openrouter: resolveProvider("openrouter", stored.get(DB_PROVIDER.openrouter)),
    };
}

export async function getAiRuntimeConfig(): Promise<Record<AiProviderId, { apiKey: string | null; model: string }>> {
    const { gemini, openrouter } = await resolveAll();
    return {
        gemini: { apiKey: gemini.apiKey, model: gemini.model },
        openrouter: { apiKey: openrouter.apiKey, model: openrouter.model },
    };
}

export async function getAiSettingsView(): Promise<AiSettingsView> {
    const resolved = await resolveAll();
    const providers = AI_PROVIDERS.map((provider): AiProviderView => {
        const { apiKey, keySource, keyUndecryptable, model, modelSource, fallbackModel } = resolved[provider];
        return {
            provider,
            keySource,
            keyHint: apiKey ? apiKey.slice(-4) : null,
            keyUndecryptable,
            model,
            modelSource,
            defaultModel: DEFAULT_MODELS[provider],
            fallbackModel,
        };
    });
    return { providers };
}

/** undefined leaves a field untouched; null clears it (falling back to env/default). */
export async function updateAiProviderSettings(
    provider: AiProviderId,
    patch: { apiKey?: string | null; model?: string | null },
): Promise<void> {
    const encryptedApiKey =
        typeof patch.apiKey === "string" ? encryptSecret(patch.apiKey, provider) : patch.apiKey;
    const data = { encryptedApiKey, model: patch.model };
    await prisma.aiProviderConfig.upsert({
        where: { provider: DB_PROVIDER[provider] },
        create: { provider: DB_PROVIDER[provider], ...data },
        update: data,
    });
}
