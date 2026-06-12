"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, money } from "@/lib/api";

export default function Receipts() {
  const { data: receipts } = useSWR("/api/receipts", fetcher);
  const [busy, setBusy] = useState(false);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", f);
    await fetch("/api/receipts", { method: "POST", body: fd });
    setBusy(false);
    mutate("/api/receipts");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Receipts</h1>
      <p className="text-muted text-sm mb-6">
        Upload a receipt image/PDF — OCR extracts vendor, date, total & GST. (Set
        <code className="mx-1">OCR_PROVIDER=docai</code> for cloud extraction; text
        receipts are parsed locally without it.)
      </p>

      <label className="btn inline-block mb-6 cursor-pointer">
        {busy ? "Processing…" : "Upload receipt"}
        <input type="file" className="hidden" onChange={upload} />
      </label>

      <div className="grid md:grid-cols-3 gap-4">
        {receipts?.map((r: any) => (
          <div key={r.id} className="card">
            <div className="font-medium">{r.ocr_vendor || "Unknown vendor"}</div>
            <div className="text-sm text-muted">{r.ocr_date || "no date"}</div>
            <div className="text-xl font-semibold mt-2">{money(r.ocr_total_cents)}</div>
            <div className="text-xs text-muted">GST {money(r.ocr_gst_cents)}</div>
          </div>
        ))}
        {receipts?.length === 0 && <div className="text-muted text-sm">No receipts yet.</div>}
      </div>
    </div>
  );
}
