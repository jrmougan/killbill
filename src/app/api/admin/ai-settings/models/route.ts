import { NextResponse } from "next/server";
import { HttpError, enforceRateLimit, noStore, route } from "@/lib/http";
import { AiModelsError, listVisionModels, type AiModelsFailure } from "@/lib/ai-models";
import { AI_MODELS_ERROR_CODES, AiModelsQuery, type AiModelsView } from "@/lib/ai-settings-schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// auth: 'admin', like the sibling settings route. Lists the provider's
// vision-capable models for the selector at /admin/ai. The provider is called
// server-side with the effective key (DB > env); neither the key nor the
// provider's error text reaches the response.

// 401/403 are never used for a provider failure: they mean the admin's own session.
const FAILURES: Record<AiModelsFailure, { status: number; message: string; code: string }> = {
    "key-missing": {
        status: 409,
        message: "Configura primero una clave de API para ver los modelos",
        code: AI_MODELS_ERROR_CODES.keyMissing,
    },
    "key-rejected": {
        status: 422,
        message: "El proveedor ha rechazado la clave de API: no es válida o no tiene permiso",
        code: AI_MODELS_ERROR_CODES.keyRejected,
    },
    "rate-limited": {
        status: 503,
        message: "El proveedor ha limitado las solicitudes. Inténtalo más tarde",
        code: AI_MODELS_ERROR_CODES.rateLimited,
    },
    unavailable: {
        status: 502,
        message: "No se pudo obtener la lista de modelos del proveedor",
        code: AI_MODELS_ERROR_CODES.unavailable,
    },
};

export const GET = noStore(
    route(
        {
            auth: "admin",
            query: AiModelsQuery,
            errorMessage: "Error al obtener los modelos de IA",
            logLabel: "Error listing AI models:",
        },
        async ({ ctx, query: { provider } }) => {
            // Each call goes out to the provider: 30 per minute per admin.
            enforceRateLimit(`ai-models:user:${ctx.userId}`, 30, 60 * 1000);
            try {
                const view: AiModelsView = { provider, models: await listVisionModels(provider) };
                return NextResponse.json(view);
            } catch (error) {
                if (!(error instanceof AiModelsError)) throw error;
                const failure = FAILURES[error.reason];
                throw new HttpError(failure.status, failure.message, failure.code);
            }
        },
    ),
);
