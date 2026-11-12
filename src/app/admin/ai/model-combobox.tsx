"use client";

import { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/hooks/api-request";
import type { AiModelOption, AiModelsView, AiProviderId } from "@/lib/ai-settings-schemas";

const MODELS_ENDPOINT = "/api/admin/ai-settings/models";
const MODELS_ERROR = "No se pudo cargar la lista de modelos";
/** Rows painted at once; the rest are reached by typing. */
const MAX_VISIBLE_MODELS = 50;

export type ModelList =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; models: AiModelOption[] }
    | { status: "error"; message: string };

/**
 * The provider's vision models, loaded on demand (each load is a server-side call
 * to the provider). A newer load or a reset discards the answer of an older one.
 */
export function useModelList(provider: AiProviderId) {
    const [list, setList] = useState<ModelList>({ status: "idle" });
    const latest = useRef(0);
    // Whether a list was asked for since the last reset. A ref, not `list.status`:
    // a caller that awaits something else would read the status of an old render.
    const requested = useRef(false);

    const load = useCallback(async () => {
        const request = ++latest.current;
        requested.current = true;
        setList({ status: "loading" });
        const result = await apiRequest<AiModelsView>(`${MODELS_ENDPOINT}?provider=${provider}`, {
            method: "GET",
            errorMessage: MODELS_ERROR,
        });
        if (latest.current !== request) return;
        if (!result.ok) {
            setList({ status: "error", message: result.error });
            return;
        }
        const models = Array.isArray(result.data?.models) ? result.data.models : [];
        setList({ status: "loaded", models });
    }, [provider]);

    const reset = useCallback(() => {
        latest.current++;
        requested.current = false;
        setList({ status: "idle" });
    }, []);

    /** Asks again only when a list was already requested; otherwise it stays on demand. */
    const reloadIfRequested = useCallback(() => {
        if (requested.current) void load();
    }, [load]);

    return { list, load, reset, reloadIfRequested };
}

type Row = { id: string; label: string; value: string; note?: string };

function matches(model: AiModelOption, query: string): boolean {
    return model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query);
}

/**
 * Text input with a filterable list of the provider's vision models. The input
 * stays a plain text field: what is typed is what gets saved, so a model that is
 * not listed (or any model, when the list cannot be loaded) can still be entered.
 */
export function ModelCombobox({
    id,
    value,
    onChange,
    placeholder,
    currentModel,
    fallbackModel,
    canList,
    list,
    onLoad,
}: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    /** What an empty field resolves to. */
    placeholder: string;
    /** The model in use now; listed even when the provider does not offer it. */
    currentModel: string;
    fallbackModel: string;
    /** False when the provider needs a key that is not configured. */
    canList: boolean;
    list: ModelList;
    onLoad: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const listId = `${id}-list`;

    const models = list.status === "loaded" ? list.models : [];
    const query = value.trim().toLowerCase();
    // An exact id (or the model in use) is a selection, not a search: keep the whole list around it.
    const isSelection = value.trim() === currentModel || models.some((model) => model.id.toLowerCase() === query);
    const filtering = query !== "" && !isSelection;
    const found = filtering ? models.filter((model) => matches(model, query)) : models;

    const rows: Row[] = [];
    if (!filtering) {
        rows.push({ id: `${listId}-default`, label: "Usar el predeterminado", value: "", note: fallbackModel });
        if (!models.some((model) => model.id === currentModel)) {
            rows.push({ id: `${listId}-current`, label: currentModel, value: currentModel });
        }
    }
    const visible = found.slice(0, MAX_VISIBLE_MODELS);
    visible.forEach((model, index) => rows.push({ id: `${listId}-${index}`, label: model.label, value: model.id }));

    const showList = open && list.status === "loaded";
    const activeRow = showList ? rows[active] : undefined;

    const openList = () => {
        setOpen(true);
        if (canList && list.status === "idle") onLoad();
    };

    const close = () => {
        setOpen(false);
        setActive(-1);
    };

    const select = (row: Row) => {
        onChange(row.value);
        close();
    };

    const move = (step: number) => {
        if (!showList || rows.length === 0) return;
        const next = Math.min(Math.max(active + step, 0), rows.length - 1);
        setActive(next);
        document.getElementById(rows[next].id)?.scrollIntoView?.({ block: "nearest" });
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openList();
            else move(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Enter" && activeRow) {
            // Picks the highlighted model instead of submitting the form.
            event.preventDefault();
            select(activeRow);
        } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
        }
    };

    return (
        // The list is inline and stays open on blur: closing it there would move the
        // "Guardar" button from under a tap that is already on its way.
        <div className="flex flex-col gap-1.5">
            <Input
                id={id}
                type="text"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Input renders an <input>; the role makes it an ARIA combobox
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showList}
                aria-controls={showList ? listId : undefined}
                aria-activedescendant={activeRow?.id}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={128}
                placeholder={placeholder}
                value={value}
                onFocus={openList}
                onChange={(event) => {
                    onChange(event.target.value);
                    setOpen(true);
                    setActive(-1);
                }}
                onKeyDown={onKeyDown}
            />

            {!canList && (
                <p className="text-[13px] text-muted-foreground text-pretty">
                    Guarda una clave de API para ver los modelos disponibles. Mientras tanto, puedes escribir el modelo a
                    mano.
                </p>
            )}

            {canList && list.status === "loading" && (
                <output className="block text-[13px] text-muted-foreground">Cargando modelos…</output>
            )}

            {canList && list.status === "error" && (
                <div className="rounded-[14px] bg-[var(--negative-tint)] px-3.5 py-2 text-[13px] font-medium text-[color:var(--negative-ink)] text-pretty">
                    {/* Only the message is announced; the button stays outside the live region. */}
                    <output className="block pt-1">
                        {list.message.replace(/\.$/, "")}. Puedes escribir el modelo a mano.
                    </output>
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(true);
                            onLoad();
                        }}
                        className="min-h-11 text-sm font-semibold underline"
                    >
                        Reintentar
                    </button>
                </div>
            )}

            {canList && (list.status === "idle" || list.status === "loaded") && (
                <button
                    type="button"
                    aria-expanded={showList}
                    aria-controls={showList ? listId : undefined}
                    onClick={() => (open ? close() : openList())}
                    className="self-start min-h-11 text-left text-sm font-semibold text-primary"
                >
                    {showList ? "Ocultar modelos" : "Ver modelos"}
                </button>
            )}

            {showList && (
                <>
                    {/* ARIA listbox driven from the input (aria-activedescendant): a native <datalist> cannot
                        show the name and the id of each model, nor rows of 44 px. */}
                    <div
                        id={listId}
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
                        role="listbox"
                        tabIndex={-1}
                        aria-label="Modelos con visión"
                        // Keeps the focus in the input, so the keyboard can go on from a tapped row.
                        onMouseDown={(event) => event.preventDefault()}
                        className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--line)] bg-card"
                    >
                        {rows.map((row, index) => {
                            const selected = row.value === value.trim();
                            return (
                                // Keyboard users pick a row from the input (arrows + Enter).
                                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                                <div
                                    key={row.id}
                                    id={row.id}
                                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native <option> cannot hold two lines
                                    role="option"
                                    tabIndex={-1}
                                    aria-selected={selected}
                                    onClick={() => select(row)}
                                    className={`flex min-h-11 cursor-pointer flex-col justify-center px-3.5 py-2 [overflow-wrap:anywhere] ${
                                        index === active ? "bg-[var(--track)]" : ""
                                    }`}
                                >
                                    <span className={`text-sm ${selected ? "font-bold" : "font-medium"}`}>
                                        {row.label}
                                        {row.value !== "" && row.value === currentModel && (
                                            <>
                                                {" "}
                                                <span className="font-normal text-muted-foreground">(actual)</span>
                                            </>
                                        )}
                                    </span>
                                    {(row.note ?? row.value) !== row.label && (
                                        <span className="font-mono text-[12px] text-muted-foreground">{row.note ?? row.value}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <output className="block text-[13px] text-muted-foreground text-pretty">
                        {models.length === 0
                            ? "El proveedor no ha devuelto modelos que acepten imágenes. Puedes escribir el modelo a mano."
                            : found.length === 0
                            ? "Ningún modelo coincide. Se guardará lo que has escrito."
                            : found.length > visible.length
                              ? `Mostrando ${visible.length} de ${found.length}. Escribe para filtrar.`
                              : "Solo se listan modelos que aceptan imágenes."}
                    </output>
                </>
            )}
        </div>
    );
}
