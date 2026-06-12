"use client";
import { useState, useEffect } from "react";
import { mutate } from "swr";
import { api } from "@/lib/api";

const FIELDS: [string, string, string?][] = [
  ["name", "Business name", "Your name or company name"],
  ["abn", "ABN", "00 000 000 000"],
  ["email", "Email", "you@business.com"],
  ["phone", "Phone", "0400 000 000"],
  ["address", "Business address", "Street, suburb, state, postcode"],
  ["bank_account_name", "Account name", "Acct holder name"],
  ["bsb", "BSB", "000-000"],
  ["bank_account_number", "Account number", "00000000"],
  ["bank_name", "Bank", "e.g. CommBank"],
  ["invoice_footer", "Invoice footer note", "Thanks for your business!"],
];

export function BusinessProfile({ entity }: { entity: any }) {
  const [form, setForm] = useState<any>(entity);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(entity), [entity?.id]);

  if (!form) return null;
  const set = (k: string, v: any) => { setForm({ ...form, [k]: v }); setSaved(false); };

  async function save() {
    await api(`/api/entities/${entity.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: form.name, type: form.type, kind: form.kind ?? entity.kind ?? "business",
        gst_registered: form.gst_registered, abn: form.abn,
        tax_rate_default: form.tax_rate_default,
        email: form.email, phone: form.phone, address: form.address,
        bank_name: form.bank_name, bsb: form.bsb,
        bank_account_name: form.bank_account_name,
        bank_account_number: form.bank_account_number,
        payment_terms_days: Number(form.payment_terms_days) || 30,
        invoice_footer: form.invoice_footer,
      }),
    });
    setSaved(true);
    mutate("/api/entities");
  }

  const complete = form.abn && form.bank_account_number;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium">Your business details</div>
        <span className={`text-xs ${complete ? "text-good" : "text-warn"}`}>
          {complete ? "✓ Ready — auto-added to invoices" : "Enter once to auto-fill invoices"}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">
        {form.gst_registered ? "GST-registered — invoices add 10% GST." : "Not GST-registered — no GST on invoices."}
      </p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {FIELDS.map(([key, label, ph]) => (
          <div key={key} className={key === "address" || key === "invoice_footer" ? "md:col-span-2 lg:col-span-3" : ""}>
            <div className="stat-label mb-1">{label}</div>
            <input className="input" placeholder={ph} value={form[key] ?? ""}
              onChange={(e) => set(key, e.target.value)} />
          </div>
        ))}
        <div>
          <div className="stat-label mb-1">Payment terms (days)</div>
          <input className="input" type="number" value={form.payment_terms_days ?? 30}
            onChange={(e) => set("payment_terms_days", e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button className="btn" onClick={save}>Save details</button>
        {saved && <span className="text-good text-sm">Saved ✓</span>}
      </div>
    </div>
  );
}
