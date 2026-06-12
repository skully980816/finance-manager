"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useEntity } from "@/lib/entity-context";

export default function ImportPage() {
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { selected } = useEntity();
  const [file, setFile] = useState<File | null>(null);
  const [entityId, setEntityId] = useState("");
  const effectiveEntity = entityId || (selected !== "all" ? String(selected) : String(entities?.[0]?.id || ""));
  const [mapping, setMapping] = useState(
    JSON.stringify({ date: "Date", description: "Description", amount: "Amount" }, null, 2)
  );
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("entity_id", effectiveEntity);
    fd.append("mapping", mapping);
    fd.append("file", file);
    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    setResult(await res.json());
    setBusy(false);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Import CSV</h1>
      <p className="text-muted text-sm mb-6">
        Upload a bank, payroll, or Stripe export. Map your columns below — the
        importer dedupes on re-import and auto-applies your categorisation rules.
      </p>

      <form onSubmit={submit} className="card flex flex-col gap-4">
        <div>
          <div className="stat-label mb-1">Entity</div>
          <select className="input" value={effectiveEntity} onChange={(e) => setEntityId(e.target.value)}>
            {entities?.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <div className="stat-label mb-1">CSV file</div>
          <input type="file" accept=".csv" className="input"
            onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <div>
          <div className="stat-label mb-1">Column mapping (JSON)</div>
          <textarea className="input font-mono h-40" value={mapping}
            onChange={(e) => setMapping(e.target.value)} />
          <p className="text-xs text-muted mt-1">
            Use <code>amount</code> for a single signed column, or <code>debit</code>/<code>credit</code> for split
            columns. Optional <code>date_format</code> (strptime).
          </p>
        </div>
        <button className="btn self-start" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </button>
      </form>

      {result && (
        <div className="card mt-4">
          <div className="text-good font-medium">Import complete</div>
          <div className="text-sm mt-1">
            Created <b>{result.created}</b> · Skipped (dupes/blank) <b>{result.skipped}</b>
          </div>
        </div>
      )}
    </div>
  );
}
