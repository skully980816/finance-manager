"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api } from "@/lib/api";
import { BusinessProfile } from "@/components/BusinessProfile";
import { UpBanking } from "@/components/UpBanking";
import { useEntity } from "@/lib/entity-context";

export default function Businesses() {
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { selected, setSelected } = useEntity();
  const [open, setOpen] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", type: "sole_trader" });

  const businesses = (entities || []).filter((e: any) => e.kind === "business");
  const personals = (entities || []).filter((e: any) => e.kind === "personal");

  async function add() {
    setErr("");
    if (!form.name.trim()) { setErr("Enter a business name."); return; }
    const kind = form.type === "personal" ? "personal" : "business";
    const gst = form.type === "company";
    try {
      const created = await api("/api/entities", {
        method: "POST",
        body: JSON.stringify({ name: form.name, type: form.type, kind, gst_registered: gst }),
      });
      setForm({ name: "", type: "sole_trader" });
      setAdding(false);
      await mutate("/api/entities");
      setOpen(created.id);
      setSelected(created.id);
    } catch (e: any) { setErr(String(e.message || e)); }
  }

  async function remove(id: number) {
    setErr("");
    try {
      await api(`/api/entities/${id}`, { method: "DELETE" });
      if (selected === id) setSelected("all");
      setConfirmId(null);
      mutate("/api/entities");
    } catch (e: any) { setErr(String(e.message || e)); }
  }

  const Row = ({ e }: any) => (
    <div>
      <div className="card flex items-center justify-between">
        <div>
          <div className="font-medium">
            {e.name}
            {selected === e.id && <span className="ml-2 text-xs text-accent">● active</span>}
          </div>
          <div className="text-xs text-muted">
            {e.type === "company" ? "Company" : e.type === "sole_trader" ? "Sole trader" : "Personal"}
            {e.kind === "business" ? ` · ${e.gst_registered ? "GST registered" : "no GST"}` : " · not a business"}
            {e.abn ? ` · ABN ${e.abn}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected !== e.id && <button className="btn-ghost" onClick={() => setSelected(e.id)}>Use</button>}
          <button className="btn-ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
            {open === e.id ? "Close" : "Edit details"}
          </button>
          {confirmId === e.id ? (
            <span className="flex items-center gap-1 text-sm">
              <button className="text-bad font-medium" onClick={() => remove(e.id)}>Confirm</button>
              <button className="text-muted" onClick={() => setConfirmId(null)}>cancel</button>
            </span>
          ) : (
            <button className="text-muted hover:text-bad text-sm px-2" onClick={() => setConfirmId(e.id)}>Delete</button>
          )}
        </div>
      </div>
      {open === e.id && (
        <div className="mt-2 space-y-2">
          <BusinessProfile entity={e} />
          <UpBanking entity={e} />
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-2xl font-semibold">Businesses & accounts</h1>
        <button className="btn" onClick={() => { setAdding(!adding); setErr(""); }}>+ Add</button>
      </div>
      <p className="text-muted text-sm mb-6">
        <b>Personal</b> holds your take-home money (payroll, the salary you pay yourself, interest, Raiz).
        <b> Businesses</b> (sole trader, company) track their own income/expenses — that money only becomes
        personal income when you <i>pay yourself</i> (a drawing). Invoices are issued from a business.
      </p>

      {err && <div className="card border-bad/40 text-bad text-sm mb-4">{err}</div>}

      {adding && (
        <div className="card mb-6 grid md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <div className="stat-label mb-1">Name</div>
            <input className="input" placeholder="e.g. Acme Pty Ltd" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <div className="stat-label mb-1">Type</div>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="sole_trader">Sole trader (business)</option>
              <option value="company">Company (business, GST)</option>
              <option value="personal">Personal (not a business)</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={add}>Create</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="stat-label mb-2">Businesses</div>
      <div className="flex flex-col gap-3 mb-8">
        {businesses.map((e: any) => <Row key={e.id} e={e} />)}
        {businesses.length === 0 && <div className="text-muted text-sm">No businesses yet — add one above.</div>}
      </div>

      <div className="stat-label mb-2">Personal</div>
      <div className="flex flex-col gap-3">
        {personals.map((e: any) => <Row key={e.id} e={e} />)}
        {personals.length === 0 && <div className="text-muted text-sm">No personal account yet — add one (type “Personal”).</div>}
      </div>
    </div>
  );
}
