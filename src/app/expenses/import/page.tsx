"use client";

import { useMemo, useState, useEffect } from "react";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { EqCard, EqCta, EqHeader, EqLabel } from "@/components/ui/eq";
import { normalizeRow, type ColumnMapping, type DateFormat } from "@/lib/bank-csv";
import { formatEuros } from "@/lib/currency";
import { CategoryPicker } from "@/components/category/category-picker";

const PRESET_KEY = "equil.csvImportMapping";

type Parsed = { headers: string[]; rows: Record<string, string>[] };

function guessCol(headers: string[], re: RegExp): string {
    return headers.find((h) => re.test(h)) ?? headers[0] ?? "";
}

export default function ImportCsvPage() {
    const router = useRouter();
    const [parsed, setParsed] = useState<Parsed | null>(null);
    const [fileName, setFileName] = useState<string>("");
    const [mapping, setMapping] = useState<ColumnMapping | null>(null);
    const [excluded, setExcluded] = useState<Set<number>>(new Set());
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Default category applied to every imported (personal) expense; editable later.
    const [defaultCategory, setDefaultCategory] = useState("other");

    function handleFile(file: File) {
        setError(null);
        setFileName(file.name);
        Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: (res) => {
                const headers = (res.meta.fields ?? []).filter(Boolean);
                if (headers.length === 0) {
                    setError("No se detectaron columnas. ¿Es un CSV con cabecera?");
                    return;
                }
                setParsed({ headers, rows: res.data });
                // Restore a saved preset if its columns still exist, else guess.
                let base: ColumnMapping | null = null;
                try {
                    const saved = JSON.parse(localStorage.getItem(PRESET_KEY) || "null") as ColumnMapping | null;
                    if (saved && [saved.dateCol, saved.amountCol, saved.descriptionCol].every((c) => headers.includes(c))) {
                        base = saved;
                    }
                } catch { /* ignore */ }
                setMapping(base ?? {
                    dateCol: guessCol(headers, /fecha|date/i),
                    amountCol: guessCol(headers, /importe|amount|euro|cargo|movimiento/i),
                    descriptionCol: guessCol(headers, /concepto|descrip|concept|detalle|beneficiario/i),
                    dateFormat: "DMY",
                    decimalSep: ",",
                    expenseSign: "negative",
                });
                setExcluded(new Set());
                setResult(null);
            },
            error: () => setError("No se pudo leer el CSV."),
        });
    }

    // Live normalization preview.
    const normalized = useMemo(() => {
        if (!parsed || !mapping) return [];
        return parsed.rows.map((r) => normalizeRow(r, mapping));
    }, [parsed, mapping]);

    const expenses = useMemo(
        () => normalized.map((n, i) => ({ ...n, i })).filter((n) => n.isExpense && !n.error),
        [normalized]
    );
    const skippedCount = normalized.length - expenses.length;
    const toImport = expenses.filter((e) => !excluded.has(e.i));

    async function doImport() {
        setImporting(true);
        setError(null);
        try {
            const res = await fetch("/api/expenses/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rows: toImport.map((e) => ({ dateISO: e.dateISO, amountCents: e.amountCents, description: e.description })),
                    defaultCategory,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Error al importar");
                return;
            }
            const body = await res.json();
            setResult(body);
            if (mapping) localStorage.setItem(PRESET_KEY, JSON.stringify(mapping));
        } catch {
            setError("Error de red al importar.");
        } finally {
            setImporting(false);
        }
    }

    // Refresh the dashboard's feed once the import succeeds.
    useEffect(() => {
        if (result) router.refresh();
    }, [result, router]);

    return (
        <div className="eq-in flex flex-col min-h-screen pt-3 pb-10 w-full">
            <EqHeader title="Importar movimientos" back="/settings" />
            <div className="flex flex-col gap-4 px-5 pt-5">

            {result ? (
                <EqCard className="text-center py-10 px-6 space-y-4">
                    <CheckCircle2 className="h-12 w-12 text-[color:var(--positive)] mx-auto" />
                    <div className="space-y-1">
                        <h2 className="text-lg font-bold">Importación completada</h2>
                        <p className="text-sm text-muted-foreground">
                            {result.created} {result.created === 1 ? "gasto añadido" : "gastos añadidos"} como personales
                            {result.skipped > 0 && ` · ${result.skipped} omitidos (duplicados o ingresos)`}.
                        </p>
                    </div>
                    <Link href="/expenses/list?scope=personal" className="flex h-14 w-full items-center justify-center rounded-[18px] bg-primary text-base font-semibold text-primary-foreground">Ver mis gastos</Link>
                </EqCard>
            ) : !parsed ? (
                <EqCard className="py-10 px-6 text-center space-y-4">
                    <Upload className="h-10 w-10 text-primary mx-auto" />
                    <div className="space-y-1">
                        <h2 className="font-bold text-foreground">Sube el CSV de tu banco</h2>
                        <p className="text-sm text-muted-foreground">Los movimientos entran como gastos personales; luego puedes promover los que quieras a compartidos.</p>
                    </div>
                    <label className="block">
                        <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                        />
                        <span className="inline-flex items-center justify-center gap-2 w-full h-14 rounded-[18px] bg-primary text-primary-foreground text-base font-semibold cursor-pointer transition-transform active:scale-[0.98]">
                            <Upload className="h-4 w-4" /> Elegir archivo
                        </span>
                    </label>
                </EqCard>
            ) : (
                <>
                    <EqCard className="p-4 space-y-3">
                        <p className="text-[13px] text-muted-foreground truncate">{fileName} · {parsed.rows.length} filas</p>
                        {mapping && (
                            <div className="space-y-3">
                                <Field label="Columna de fecha">
                                    <Select value={mapping.dateCol} options={parsed.headers} onChange={(v) => setMapping({ ...mapping, dateCol: v })} />
                                </Field>
                                <Field label="Columna de importe">
                                    <Select value={mapping.amountCol} options={parsed.headers} onChange={(v) => setMapping({ ...mapping, amountCol: v })} />
                                </Field>
                                <Field label="Columna de concepto">
                                    <Select value={mapping.descriptionCol} options={parsed.headers} onChange={(v) => setMapping({ ...mapping, descriptionCol: v })} />
                                </Field>
                                <div className="grid grid-cols-3 gap-2">
                                    <Field label="Formato fecha">
                                        <Select value={mapping.dateFormat} options={["DMY", "YMD", "MDY"]} onChange={(v) => setMapping({ ...mapping, dateFormat: v as DateFormat })} />
                                    </Field>
                                    <Field label="Decimal">
                                        <Select value={mapping.decimalSep} options={[",", "."]} onChange={(v) => setMapping({ ...mapping, decimalSep: v as "," | "." })} />
                                    </Field>
                                    <Field label="Gasto = signo">
                                        <Select value={mapping.expenseSign} options={["negative", "positive"]} labels={{ negative: "negativo", positive: "positivo" }} onChange={(v) => setMapping({ ...mapping, expenseSign: v as "negative" | "positive" })} />
                                    </Field>
                                </div>
                            </div>
                        )}
                    </EqCard>

                    <EqCard className="p-4 space-y-3">
                        <div className="space-y-0.5">
                            <h2 className="text-sm font-semibold text-foreground">Categoría por defecto</h2>
                            <p className="text-[12px] text-muted-foreground">Se aplica a todos los gastos importados; puedes cambiarla en cada uno después.</p>
                        </div>
                        <CategoryPicker
                            context={{ kind: "personal" }}
                            value={defaultCategory}
                            onChange={setDefaultCategory}
                        />
                    </EqCard>

                    <div className="flex items-center justify-between px-1">
                        <h2 className="text-xs font-semibold text-muted-foreground">
                            {toImport.length} de {expenses.length} a importar
                        </h2>
                        {skippedCount > 0 && (
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> {skippedCount} omitidos
                            </span>
                        )}
                    </div>

                    <div className="space-y-2">
                        {expenses.slice(0, 100).map((e) => (
                            <label key={e.i} className="flex items-center gap-3 p-3 rounded-[14px] bg-card border border-[color:var(--line-2)] cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={!excluded.has(e.i)}
                                    onChange={() => {
                                        const next = new Set(excluded);
                                        if (next.has(e.i)) next.delete(e.i); else next.add(e.i);
                                        setExcluded(next);
                                    }}
                                    className="h-4 w-4 accent-primary"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] text-foreground truncate">{e.description}</p>
                                    <p className="text-[11px] text-muted-foreground">{e.dateISO}</p>
                                </div>
                                <span className="text-[15px] font-semibold tabular-nums text-foreground shrink-0">{formatEuros(e.amountCents / 100)}</span>
                            </label>
                        ))}
                        {expenses.length > 100 && (
                            <p className="text-center text-[12px] text-muted-foreground">…y {expenses.length - 100} más (se importarán todas).</p>
                        )}
                        {expenses.length === 0 && (
                            <p className="text-center text-[13px] text-muted-foreground py-6">Ninguna fila coincide con "gasto". Revisa el mapeo (signo/columnas).</p>
                        )}
                    </div>

                    {error && <p className="text-sm text-destructive text-center">{error}</p>}

                    <div className="sticky bottom-0 pt-2 pb-4 bg-background">
                        <EqCta disabled={importing || toImport.length === 0} onClick={doImport}>
                            {importing ? "Importando…" : `Importar ${toImport.length} ${toImport.length === 1 ? "gasto" : "gastos"}`}
                        </EqCta>
                    </div>
                </>
            )}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <EqLabel>{label}</EqLabel>
            {children}
        </div>
    );
}

function Select({ value, options, labels, onChange }: { value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-10 rounded-[10px] bg-card border border-[color:var(--line)] px-2 text-[13px] text-foreground focus:outline-none focus:border-[color:var(--accent-border)]"
        >
            {options.map((o) => (
                <option key={o} value={o}>{labels?.[o] ?? o}</option>
            ))}
        </select>
    );
}
