import { NextResponse } from "next/server";
import { route, type RouteContext } from "@/lib/http";
import { getAiSettingsView, updateAiProviderSettings } from "@/lib/ai-settings";
import { UpdateAiSettingsBody } from "@/lib/ai-settings-schemas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// auth: 'admin' — regular browser session whose User.isAdmin is read from the DB
// (401 "No autorizado" / 403 "Acceso denegado"). Responses only expose source +
// last-4 hint; the submitted key never reaches a response or a log line.

type Handler = (req: Request, context?: RouteContext) => Promise<Response>;

// Applied around route() so error responses are covered too.
const noStore =
    (handler: Handler): Handler =>
    async (req, context) => {
        const res = await handler(req, context);
        res.headers.set("Cache-Control", "no-store");
        return res;
    };

export const GET = noStore(
    route({ auth: "admin", errorMessage: "Error al obtener la configuración de IA", logLabel: "Error fetching AI settings:" }, async () =>
        NextResponse.json(await getAiSettingsView()),
    ),
);

export const PATCH = noStore(
    route(
        {
            auth: "admin",
            body: UpdateAiSettingsBody,
            errorMessage: "Error al guardar la configuración de IA",
            logLabel: "Error updating AI settings:",
        },
        async ({ body: { provider, apiKey, model } }) => {
            await updateAiProviderSettings(provider, { apiKey, model });
            return NextResponse.json(await getAiSettingsView());
        },
    ),
);
