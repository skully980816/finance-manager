"use client";
import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, money } from "@/lib/api";

export default function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: inv } = useSWR(`/api/invoices/${id}`, fetcher);
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { data: clients } = useSWR("/api/clients", fetcher);

  if (!inv) return <div className="text-muted">Loading…</div>;
  const entity = entities?.find((e: any) => e.id === inv.entity_id);
  const client = clients?.find((c: any) => c.id === inv.client_id);

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-4 print:hidden">
        <Link href="/invoices" className="text-muted hover:text-white text-sm">← Back to invoices</Link>
        <button className="btn" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      {/* The invoice sheet */}
      <div className="bg-white text-slate-900 rounded-xl p-10 print:p-0 print:rounded-none">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-2xl font-bold">{entity?.name || "Your Business"}</div>
            {entity?.abn && <div className="text-sm text-slate-500">ABN {entity.abn}</div>}
            {entity?.address && <div className="text-sm text-slate-500 whitespace-pre-line mt-1">{entity.address}</div>}
            <div className="text-sm text-slate-500">
              {entity?.email}{entity?.email && entity?.phone ? " · " : ""}{entity?.phone}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tracking-tight text-slate-400">INVOICE</div>
            <div className="text-sm mt-1"><b>{inv.number}</b></div>
            <div className="text-sm text-slate-500">Issued {inv.issue_date}</div>
            <div className="text-sm text-slate-500">Due {inv.due_date}</div>
            <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${
              inv.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {inv.status.toUpperCase()}
            </span>
          </div>
        </div>

        {client && (
          <div className="mt-8">
            <div className="text-xs uppercase tracking-wide text-slate-400">Bill to</div>
            <div className="font-medium">{client.name}</div>
            {client.email && <div className="text-sm text-slate-500">{client.email}</div>}
            {client.address && <div className="text-sm text-slate-500 whitespace-pre-line">{client.address}</div>}
          </div>
        )}

        <table className="w-full mt-8">
          <thead>
            <tr className="border-b-2 border-slate-200 text-slate-500 text-xs uppercase tracking-wide">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2">Qty</th>
              <th className="text-right py-2">Unit</th>
              <th className="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l: any) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right">{l.qty}</td>
                <td className="py-2 text-right">{money(l.unit_cents)}</td>
                <td className="py-2 text-right">{money(Math.round(l.unit_cents * l.qty))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-64 text-sm">
            <Row label="Subtotal" value={money(inv.subtotal_cents)} />
            {inv.gst_cents > 0 && <Row label="GST (10%)" value={money(inv.gst_cents)} />}
            <div className="flex justify-between py-2 mt-1 border-t-2 border-slate-200 font-bold text-base">
              <span>Total</span><span>{money(inv.total_cents)}</span>
            </div>
          </div>
        </div>

        {/* Payment details — auto-filled from business profile */}
        {entity?.bank_account_number && (
          <div className="mt-10 pt-5 border-t border-slate-200 text-sm">
            <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Payment details</div>
            <div>Pay by bank transfer to:</div>
            <div className="text-slate-700">
              {entity.bank_account_name || entity.name}
              {entity.bank_name ? ` · ${entity.bank_name}` : ""}
            </div>
            <div className="text-slate-700">BSB {entity.bsb || "—"} · Account {entity.bank_account_number}</div>
            <div className="text-slate-500 mt-1">Reference: {inv.number}</div>
          </div>
        )}

        {entity?.invoice_footer && (
          <div className="mt-6 text-sm text-slate-500">{entity.invoice_footer}</div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between py-1"><span className="text-slate-500">{label}</span><span>{value}</span></div>;
}
