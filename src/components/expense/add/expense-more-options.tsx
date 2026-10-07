"use client";

import type { Dispatch } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { EqChip } from "@/components/ui/eq";
import { MIN_EXPENSE_DATE } from "@/lib/expense-input";
import { SplitEditor } from "@/components/expense/split-editor";
import { MoreOptionsSheet, OptionSection } from "./more-options-sheet";
import { ReceiptItemsEditor } from "./receipt-items-editor";
import { TAG_PRESET_COLORS, type AddMember, type FormAction, type FormState, type FormTag, type RecurringInterval } from "./expense-form-state";

const INTERVALS: { value: RecurringInterval; label: string }[] = [
    { value: "weekly", label: "Semanal" },
    { value: "monthly", label: "Mensual" },
    { value: "yearly", label: "Anual" },
];

/**
 * "Más opciones" sheet of the expense form: date, custom split, receipt lines,
 * receipt photo, tags, recurrence and notes.
 */
export function ExpenseMoreOptions({
    state,
    dispatch,
    today,
    maxDate,
    userId,
    members,
    partner,
    isShared,
    isCouple,
    itemized,
    isPersonal,
    totalCents,
    visibleTags,
    canCreateTag,
    onCreateTag,
    onDiscardReceipt,
}: {
    state: FormState;
    dispatch: Dispatch<FormAction>;
    today: string;
    maxDate: string;
    userId: string;
    members: AddMember[];
    partner: AddMember | null;
    isShared: boolean;
    isCouple: boolean;
    itemized: boolean;
    isPersonal: boolean;
    totalCents: number;
    visibleTags: FormTag[];
    canCreateTag: boolean;
    onCreateTag: () => void;
    onDiscardReceipt: () => void;
}) {
    const { date, splitChoice, splitValue, receiptItems, receiptPreview, isRecurring, recurringInterval, notes } = state;
    return (
        <MoreOptionsSheet onClose={() => dispatch({ type: "moreClosed" })}>
            <OptionSection label="Fecha" htmlFor="expense-date">
                <input
                    id="expense-date"
                    data-testid="expense-date"
                    type="date"
                    value={date}
                    min={MIN_EXPENSE_DATE}
                    max={maxDate}
                    onChange={(e) => dispatch({ type: "dateChanged", date: e.target.value || today })}
                    className="w-full bg-transparent text-[15px] font-medium outline-none"
                />
            </OptionSection>

            {isShared && !itemized && (
                <OptionSection
                    label="Reparto personalizado"
                    aside={splitChoice === "custom" && (
                        <button type="button" onClick={() => dispatch({ type: "splitChoiceChanged", choice: "equal" })} className="text-xs font-semibold text-primary">Volver a rápido</button>
                    )}
                >
                    <SplitEditor
                        members={members}
                        currentUserId={userId}
                        totalCents={totalCents}
                        value={splitValue}
                        onChange={(v) => dispatch({ type: "customSplitEdited", value: v })}
                        isCouple={isCouple}
                    />
                </OptionSection>
            )}

            <OptionSection label="Desglose de ticket">
                <ReceiptItemsEditor
                    items={receiptItems}
                    onChange={(items) => dispatch({ type: "itemsChanged", items })}
                    userId={userId}
                    partner={partner ? { id: partner.id, name: partner.name } : null}
                    assignable={isShared && !!partner}
                    emptyHint={isShared && !partner
                        ? "Escanea un ticket o añade productos. El reparto por producto solo está disponible en espacios de dos personas."
                        : undefined}
                />
            </OptionSection>

            {receiptPreview && (
                <OptionSection label="Ticket" aside={<button type="button" onClick={onDiscardReceipt} className="text-xs font-semibold text-destructive">Quitar</button>}>
                    {/* oxlint-disable-next-line nextjs/no-img-element -- local object URL / uploaded receipt of unknown size */}
                    <img src={receiptPreview} alt="Ticket adjunto" decoding="async" className="max-h-60 w-full rounded-[10px] object-contain" />
                </OptionSection>
            )}

            <TagsSection
                visibleTags={visibleTags}
                selectedTagIds={state.selectedTagIds}
                draft={state.newTag}
                isPersonal={isPersonal}
                canCreateTag={canCreateTag}
                onToggle={(id) => dispatch({ type: "tagToggled", id })}
                onDraft={(draft) => dispatch({ type: "newTagDraft", draft })}
                onCreate={onCreateTag}
            />

            <OptionSection
                label="Recurrente"
                aside={
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isRecurring}
                        aria-label="¿Es un gasto recurrente?"
                        onClick={() => dispatch({ type: "recurringToggled" })}
                        className={cn("relative h-6 w-11 rounded-full transition-colors", isRecurring ? "bg-primary" : "bg-[var(--track)]")}
                    >
                        <span className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform", isRecurring && "translate-x-5")} />
                    </button>
                }
            >
                {isRecurring ? (
                    <div className="flex gap-1.5">
                        {INTERVALS.map((it) => (
                            <EqChip key={it.value} tone="accent" selected={recurringInterval === it.value} onClick={() => dispatch({ type: "intervalChanged", interval: it.value })}>
                                {it.label}
                            </EqChip>
                        ))}
                    </div>
                ) : (
                    <p className="text-[13px] text-muted-foreground">Se repetirá automáticamente cada semana, mes o año, contando desde la fecha del gasto.</p>
                )}
            </OptionSection>

            <OptionSection label="Notas" htmlFor="expense-notes">
                <textarea
                    id="expense-notes"
                    value={notes}
                    onChange={(e) => dispatch({ type: "notesChanged", notes: e.target.value })}
                    placeholder="Añade una nota opcional…"
                    rows={3}
                    className="w-full resize-none bg-transparent text-sm outline-none"
                />
                <span className="block text-right text-[10px] text-muted-foreground">{notes.length}/500</span>
            </OptionSection>
        </MoreOptionsSheet>
    );
}

/** Tag toggles of the expense's scope + inline "Nueva etiqueta". */
function TagsSection({
    visibleTags,
    selectedTagIds,
    draft,
    isPersonal,
    canCreateTag,
    onToggle,
    onDraft,
    onCreate,
}: {
    visibleTags: FormTag[];
    selectedTagIds: string[];
    draft: FormState["newTag"];
    isPersonal: boolean;
    canCreateTag: boolean;
    onToggle: (id: string) => void;
    onDraft: (draft: Partial<FormState["newTag"]>) => void;
    onCreate: () => void;
}) {
    const { open: newTagOpen, name: newTagName, color: newTagColor } = draft;
    return (
        <OptionSection label="Etiquetas">
            <div className="flex flex-wrap gap-2">
                {visibleTags.map((tag) => {
                    const on = selectedTagIds.includes(tag.id);
                    return (
                        <button
                            key={tag.id}
                            type="button"
                            onClick={() => onToggle(tag.id)}
                            aria-pressed={on}
                            title={tag.name}
                            className={cn("max-w-full truncate rounded-full border px-3 py-1 text-xs font-semibold", on ? "text-white" : "border-[color:var(--line)] bg-card text-muted-foreground")}
                            style={on ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                        >
                            {tag.name}
                        </button>
                    );
                })}
                {visibleTags.length === 0 && !newTagOpen && (
                    <span className="text-[13px] text-muted-foreground">
                        {isPersonal ? "Sin etiquetas personales." : "Sin etiquetas en este espacio."}
                    </span>
                )}
            </div>
            {canCreateTag ? (newTagOpen ? (
                <div className="mt-3 space-y-2.5">
                    <input
                        value={newTagName}
                        onChange={(e) => onDraft({ name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCreate(); } }}
                        placeholder="Nombre de la etiqueta"
                        aria-label="Nombre de la etiqueta"
                        maxLength={40}
                        className="h-10 w-full rounded-[10px] border border-[color:var(--line)] bg-card px-3 text-sm outline-none focus:border-[color:var(--accent-border)]"
                    />
                    <div className="flex flex-wrap gap-2">
                        {TAG_PRESET_COLORS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                aria-label={`Color ${c}`}
                                aria-pressed={newTagColor === c}
                                onClick={() => onDraft({ color: c })}
                                className={cn("h-7 w-7 rounded-full border-2", newTagColor === c ? "border-foreground" : "border-transparent")}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>
                    <div className="flex gap-3">
                        <button type="button" onClick={onCreate} disabled={!newTagName.trim()} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary disabled:opacity-40">
                            <Check className="h-3.5 w-3.5" /> Crear
                        </button>
                        <button type="button" onClick={() => onDraft({ open: false, name: "" })} className="text-[13px] font-semibold text-muted-foreground">Cancelar</button>
                    </div>
                </div>
            ) : (
                <button type="button" onClick={() => onDraft({ open: true })} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary">
                    <Plus className="h-4 w-4" /> Nueva etiqueta
                </button>
            )) : (
                <p className="mt-3 text-[12px] text-muted-foreground">Las etiquetas nuevas se crean desde el espacio activo.</p>
            )}
        </OptionSection>
    );
}
