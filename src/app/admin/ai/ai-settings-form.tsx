"use client";

import { useId, useState } from "react";
import { AuthError } from "@/components/auth/auth-shell";
import { CriticalActionSheet } from "@/components/ui/critical-action-sheet";
import { EqCard, EqCta, EqHeader, EqToast, useEqToast } from "@/components/ui/eq";
import { Input } from "@/components/ui/input";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { ModelCombobox, useModelList } from "./model-combobox";
import type { AiProviderId, AiProviderView, AiSettingsView, KeySource, ModelSource } from "@/lib/ai-settings-schemas";

const ENDPOINT = "/api/admin/ai-settings";
const SAVE_ERROR = "No se pudo guardar la configuración";

const PROVIDER_COPY: Record<AiProviderId, { name: string; role: string }> = {
    gemini: { name: "Google Gemini", role: "Se usa primero para leer los tickets." },
    openrouter: { name: "OpenRouter", role: "Se usa si Gemini falla o no está configurado." },
};

const KEY_STATUS: Record<KeySource, string> = {
    database: "Clave guardada aquí",
    environment: "Clave de variable de entorno",
    none: "Sin configurar",
};

const MODEL_STATUS: Record<ModelSource, string> = {
    database: "guardado aquí",
    environment: "de variable de entorno",
    default: "predeterminado",
};

type Patch = { apiKey?: string | null; model?: string | null };

// Google only lists models for a key; OpenRouter's list is public.
const canListModels = (view: AiProviderView) => view.provider !== "gemini" || view.keySource !== "none";

/**
 * Admin form for the OCR provider keys and models. The model field is a combobox
 * over the provider's vision models (`model-combobox.tsx`), loaded on demand. The API answers each save with
 * the whole view, which replaces the local state; a key is write-only, so the only
 * thing that ever comes back is its source and last-4 hint.
 */
export function AiSettingsForm({ settings: initial }: { settings: AiSettingsView }) {
    const [settings, setSettings] = useState(initial);
    const [toast, showToast] = useEqToast();

    return (
        <div className="min-h-dvh flex flex-col gap-5 pb-10 pt-3 eq-in">
            <EqHeader title="IA de los tickets" back="/admin" />

            <div className="px-5 flex flex-col gap-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    Claves y modelos para leer los tickets, comunes a toda la instancia. Las claves se guardan cifradas y no
                    se vuelven a mostrar. Si quitas un valor, se usa el de las variables de entorno o el predeterminado.
                </p>

                {settings.providers.map((view) => (
                    <ProviderCard key={view.provider} view={view} onSaved={setSettings} showToast={showToast} />
                ))}
            </div>
            {toast && <EqToast>{toast}</EqToast>}
        </div>
    );
}

function ProviderCard({
    view,
    onSaved,
    showToast,
}: {
    view: AiProviderView;
    onSaved: (settings: AiSettingsView) => void;
    showToast: (message: string) => void;
}) {
    // The refresh keeps the router cache honest for a later back navigation; what
    // this screen shows comes from the PATCH answer.
    const { mutate, busy, error, setError } = useApiMutation();
    const [apiKey, setApiKey] = useState("");
    // null = untouched: the input follows the saved value until the admin edits it.
    const [modelDraft, setModelDraft] = useState<string | null>(null);
    const [confirmingRemoval, setConfirmingRemoval] = useState(false);
    const { list: modelList, load: loadModels, reset: resetModels, reloadIfRequested } = useModelList(view.provider);
    const uid = useId();
    const copy = PROVIDER_COPY[view.provider];

    const savedModel = view.modelSource === "database" ? view.model : "";
    const typedKey = apiKey.trim();
    const typedModel = (modelDraft ?? savedModel).trim();
    const keyChanged = typedKey !== "";
    const modelChanged = typedModel !== savedModel;
    const hasStoredKey = view.keySource === "database" || view.keyUndecryptable;

    const save = async (patch: Patch, successMessage: string) => {
        const result = await mutate<AiSettingsView>(ENDPOINT, {
            method: "PATCH",
            body: { provider: view.provider, ...patch },
            errorMessage: SAVE_ERROR,
        });
        if (!result.ok) return false;
        // Only what was sent is reset: a draft of the other field stays unsaved.
        if (patch.apiKey !== undefined) setApiKey("");
        if (patch.model !== undefined) setModelDraft(null);
        onSaved(result.data);
        // A list that was requested (even while this save was in flight) belongs to
        // the previous key: drop it, and ask again if the provider can still list.
        if (patch.apiKey !== undefined) {
            const saved = result.data.providers.find((provider) => provider.provider === view.provider) ?? view;
            if (canListModels(saved)) reloadIfRequested();
            else resetModels();
        }
        showToast(successMessage);
        return true;
    };

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || (!keyChanged && !modelChanged)) return;
        void save(
            {
                ...(keyChanged && { apiKey: typedKey }),
                ...(modelChanged && { model: typedModel || null }),
            },
            "Configuración guardada",
        );
    };

    const removeKey = async () => {
        if (await save({ apiKey: null }, "Clave quitada")) setConfirmingRemoval(false);
    };

    const openRemoval = () => {
        setError(null);
        setConfirmingRemoval(true);
    };

    const closeRemoval = () => {
        setError(null);
        setConfirmingRemoval(false);
    };

    return (
        <section aria-labelledby={`${uid}-title`}>
            <EqCard className="p-4">
                <form onSubmit={submit} className="flex flex-col gap-4">
                    <div>
                        <h2 id={`${uid}-title`} className="text-[17px] font-bold">{copy.name}</h2>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{copy.role}</p>
                    </div>

                    {view.keyUndecryptable && (
                        <div className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-3 text-sm font-medium text-[color:var(--negative-ink)] text-pretty">
                            La clave guardada no se puede descifrar porque ha cambiado el secreto del servidor. No se está
                            usando: guarda una nueva o quítala.
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${uid}-key`} className="text-sm font-semibold">Clave de API</label>
                        <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                            {KEY_STATUS[view.keySource]}
                            {view.keyHint && <span className="font-mono"> ••••{view.keyHint}</span>}
                        </p>
                        <Input
                            id={`${uid}-key`}
                            type="password"
                            autoComplete="new-password"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            placeholder={view.keySource === "none" ? "Pega la clave" : "Pega una clave para sustituirla"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                        {hasStoredKey && (
                            <button
                                type="button"
                                onClick={openRemoval}
                                disabled={busy}
                                className="self-start min-h-11 text-sm font-semibold text-destructive disabled:opacity-50"
                            >
                                Quitar clave
                            </button>
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${uid}-model`} className="text-sm font-semibold">Modelo</label>
                        <p className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
                            En uso: <span className="font-mono">{view.model}</span> ({MODEL_STATUS[view.modelSource]})
                        </p>
                        <ModelCombobox
                            id={`${uid}-model`}
                            // What an empty field resolves to.
                            placeholder={view.fallbackModel}
                            value={modelDraft ?? savedModel}
                            onChange={setModelDraft}
                            currentModel={view.model}
                            fallbackModel={view.fallbackModel}
                            canList={canListModels(view)}
                            list={modelList}
                            onLoad={() => void loadModels()}
                        />
                        {view.modelSource === "database" && (
                            <button
                                type="button"
                                onClick={() => void save({ model: null }, "Modelo restablecido")}
                                disabled={busy}
                                className="self-start min-h-11 text-left text-sm font-semibold text-primary disabled:opacity-50"
                            >
                                Restablecer modelo
                            </button>
                        )}
                    </div>

                    {error && !confirmingRemoval && <AuthError>{error}</AuthError>}

                    <EqCta type="submit" disabled={busy || (!keyChanged && !modelChanged)} aria-busy={busy}>
                        {busy ? "Guardando…" : "Guardar"}
                    </EqCta>
                </form>
            </EqCard>

            {confirmingRemoval && (
                <CriticalActionSheet
                    tone="danger"
                    testId="ai-key-remove-sheet"
                    title={`¿Quitar la clave de ${copy.name}?`}
                    consequences={[
                        "Se usará la clave de las variables de entorno, si la hay. Si no, este proveedor dejará de leer tickets.",
                    ]}
                    reversible={false}
                    confirmLabel="Quitar clave"
                    busy={busy}
                    error={error}
                    onConfirm={() => void removeKey()}
                    onClose={closeRemoval}
                />
            )}
        </section>
    );
}
