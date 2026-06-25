"use client";
import React, { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";
import { useEntity } from "@/lib/entity-context";

type InvoiceLine = { description: string; qty: number; unit_cents: number; gst_applicable: boolean };
type Invoice = {
  id: number; entity_id: number; client_id: number | null; number: string;
  issue_date: string; due_date: string | null; status: string;
  subtotal_cents: number; gst_cents: number; total_cents: number; amount_paid_cents: number;
  document_type: string; notes: string | null; hosted_url: string | null; lines: InvoiceLine[];
};
type Client = { id: number; name: string; email: string | null };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-700",
  viewed: "bg-purple-100 text-purple-700",
  partial: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

const emptyLine = (): InvoiceLine => ({ description: "", qty: 1, unit_cents: 0, gst_applicable: true });

export default function InvoicesPage() {
  const { entityId } = useEntity();
  const [tab, setTab] = useState<"invoices" | "quotes">("invoices");
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"invoice" | "quote">("invoice");
  const [payModal, setPayModal] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const { data: invoices = [] } = useSWR<Invoice[]>(
    entityId ? `/api/invoices?entity_id=${entityId}` : null, fetcher, { refreshInterval: 30_000 }
  );
  const { data: clients = [] } = useSWR<Client[]>(
    entityId ? `/api/clients?entity_id=${entityId}` : null, fetcher
  );

  const visible = invoices.filter((i) =>
    tab === "quotes" ? i.document_type === "quote" : i.document_type !== "quote"
  );

  // ---- Form state ----
  const [form, setForm] = useState({
    client_id: "" as string | number,
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    notes: "",
    lines: [emptyLine()],
  });

  function openNew(type: "invoice" | "quote") {
    setFormType(type);
    setForm({
      client_id: "",
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: "",
      notes: "",
      lines: [emptyLine()],
    });
    setShowForm(true);
    setError("");
  }

  function setLine(i: number, field: keyof InvoiceLine, value: string | number | boolean) {
    setForm((f) => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [field]: value };
      return { ...f, lines };
    });
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  }

  function removeLine(i: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));
  }

  const subtotal = form.lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cents), 0);
  const gst = form.lines.reduce((s, l) => s + (l.gst_applicable ? Math.round(l.qty * l.unit_cents * 0.1) : 0), 0);
  const total = subtotal + gst;

  async function submit() {
    setSaving(true); setError("");
    try {
      await api("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          entity_id: entityId,
          client_id: form.client_id || null,
          issue_date: form.issue_date || null,
          due_date: form.due_date || null,
          notes: form.notes || null,
          document_type: formType,
          lines: form.lines.map((l) => ({
            ...l,
            unit_cents: Math.round(Number(l.unit_cents)),
            qty: Number(l.qty),
          })),
        }),
      });
      mutate(`/api/invoices?entity_id=${entityId}`);
      setShowForm(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally { setSaving(false); }
  }

  async function convertToInvoice(inv: Invoice) {
    await api(`/api/invoices/${inv.id}/convert-to-invoice`, { method: "POST" });
    mutate(`/api/invoices?entity_id=${entityId}`);
    setTab("invoices");
  }

  async function markPaid(inv: Invoice) {
    await api(`/api/invoices/${inv.id}/mark-paid`, { method: "POST" });
    mutate(`/api/invoices?entity_id=${entityId}`);
  }

  async function recordPayment() {
    if (!payModal) return;
    const cents = Math.round(parseFloat(payAmount) * 100);
    if (!cents || cents <= 0) return;
    await api(`/api/invoices/${payModal.id}/payment`, {
      method: "POST",
      body: JSON.stringify({ amount_cents: cents }),
    });
    mutate(`/api/invoices?entity_id=${entityId}`);
    setPayModal(null); setPayAmount("");
  }

  async function deleteDoc(inv: Invoice) {
    if (!confirm(`Delete ${inv.document_type} ${inv.number}?`)) return;
    await api(`/api/invoices/${inv.id}`, { method: "DELETE" });
    mutate(`/api/invoices?entity_id=${entityId}`);
  }

  function openPrint(inv: Invoice) {
    window.open(`/api/invoices/${inv.id}/print`, "_blank");
  }

  const clientName = (id: number | null) => clients.find((c) => c.id === id)?.name ?? "—";
  const balance = (inv: Invoice) => inv.total_cents - (inv.amount_paid_cents || 0);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoicing</h1>
        <div className="flex gap-2">
          <button onClick={() => openNew("quote")}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
            + New Quote
          </button>
          <button onClick={() => openNew("invoice")}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800">
            + New Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(["invoices", "quotes"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="ml-1.5 text-xs bg-gray-100 rounded-full px-1.5 py-0.5">
              {invoices.filter((i) => (t === "quotes" ? i.document_type === "quote" : i.document_type !== "quote")).length}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            No {tab} yet.{" "}
            <button className="text-gray-900 underline" onClick={() => openNew(tab === "quotes" ? "quote" : "invoice")}>
              Create one
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Number</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Due</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Balance</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{inv.number}</td>
                  <td className="px-4 py-3">{clientName(inv.client_id)}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.issue_date}</td>
                  <td className="px-4 py-3 text-gray-500">{inv.due_date ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium">{money(inv.total_cents)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${balance(inv) > 0 && inv.status === "overdue" ? "text-red-600" : ""}`}>
                    {money(balance(inv))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      {inv.document_type === "quote" && inv.status !== "paid" && (
                        <button onClick={() => convertToInvoice(inv)}
                          className="text-xs text-blue-600 hover:underline">Convert</button>
                      )}
                      {inv.document_type !== "quote" && inv.status !== "paid" && (
                        <>
                          <button onClick={() => { setPayModal(inv); setPayAmount(""); }}
                            className="text-xs text-green-600 hover:underline">Pay</button>
                          <button onClick={() => markPaid(inv)}
                            className="text-xs text-gray-500 hover:underline">Full paid</button>
                        </>
                      )}
                      <button onClick={() => openPrint(inv)}
                        className="text-xs text-gray-500 hover:underline">PDF</button>
                      {(inv.status === "draft" || inv.document_type === "quote") && (
                        <button onClick={() => deleteDoc(inv)}
                          className="text-xs text-red-500 hover:underline">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto py-8">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">New {formType === "quote" ? "Quote" : "Invoice"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                  <option value="">— No client —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Issue Date</label>
                <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.issue_date} onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Due Date</label>
                <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Payment via EFT"
                  value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            {/* Line items */}
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">Description</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">Qty</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Unit ($)</th>
                    <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">GST</th>
                    <th className="text-right px-3 py-2 font-medium text-gray-600 w-24">Total</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.lines.map((line, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input type="text" className="w-full border-0 focus:outline-none text-sm"
                          placeholder="Description" value={line.description}
                          onChange={(e) => setLine(i, "description", e.target.value)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01"
                          className="w-full border-0 focus:outline-none text-sm text-center"
                          value={line.qty} onChange={(e) => setLine(i, "qty", parseFloat(e.target.value) || 0)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="0.01"
                          className="w-full border-0 focus:outline-none text-sm text-right"
                          value={(line.unit_cents / 100).toFixed(2)}
                          onChange={(e) => setLine(i, "unit_cents", Math.round(parseFloat(e.target.value) * 100) || 0)} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={line.gst_applicable}
                          onChange={(e) => setLine(i, "gst_applicable", e.target.checked)} />
                      </td>
                      <td className="px-2 py-1.5 text-right text-gray-600">
                        ${(line.qty * line.unit_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t border-gray-100">
                <button onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add line</button>
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end mb-6">
              <div className="w-48 space-y-1 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span><span>${(subtotal / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>GST (10%)</span><span>${(gst / 100).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-base border-t border-gray-200 pt-1">
                  <span>Total</span><span>${(total / 100).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={submit} disabled={saving}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50">
                {saving ? "Saving…" : `Create ${formType === "quote" ? "Quote" : "Invoice"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold mb-1">Record Payment</h2>
            <p className="text-sm text-gray-500 mb-4">
              {payModal.number} · Balance {money(balance(payModal))}
            </p>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount ($)</label>
            <input type="number" min="0" step="0.01" autoFocus
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4"
              placeholder="0.00" value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)} />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPayModal(null)} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={recordPayment}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm hover:bg-gray-800">
                Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
