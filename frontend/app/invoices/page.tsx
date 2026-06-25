"use client";
import { useState } from "react";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";
import { BusinessProfile } from "@/components/BusinessProfile";
import { useEntity, withEntity } from "@/lib/entity-context";

const STATUS: Record<string, string> = {
  draft: "bg-panel2 text-muted", sent: "bg-accent/15 text-accent",
  viewed: "bg-accent/15 text-accent", paid: "bg-good/15 text-good",
  overdue: "bg-bad/15 text-bad",
};

const refreshInvoices = () =>
  mutate((key) => typeof key === "string" &&
    (key.startsWith("/api/invoices") || key.startsWith("/api/dashboard")));

export default function Invoices() {
  const { selected } = useEntity();
  const { data: invoices } = useSWR(withEntity("/api/invoices", selected), fetcher);
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { data: clients } = useSWR("/api/clients", fetcher);

  // Business to invoice FROM (personal entities can't issue invoices).
  const businesses = (entities || []).filter((e: any) => e.kind === "business");
  const [fromId, setFromId] = useState<string>("");
  const from =
    businesses.find((e: any) => String(e.id) === fromId) ||
    businesses.find((e: any) => String(e.id) === String(selected)) ||
    businesses[0];

  const [showProfile, setShowProfile] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [clientId, setClientId] = useState("");
  const [lines, setLines] = useState([{ description: "", qty: 1, unit: "" }]);

  // Inline "add new client" form
  const [showClientForm, setShowClientForm] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [clientErr, setClientErr] = useState("");
  const emptyClient = { name: "", email: "", phone: "", address: "" };
  const [newClient, setNewClient] = useState(emptyClient);

  async function createClient() {
    if (!newClient.name.trim() || !from) return;
    setClientErr(""); setSavingClient(true);
    try {
      const c = await api("/api/clients", {
        method: "POST",
        body: JSON.stringify({ entity_id: Number(from.id), ...newClient }),
      });
      await mutate("/api/clients");
      setClientId(String(c.id));        // auto-select the new client
      setNewClient(emptyClient);
      setShowClientForm(false);
    } catch (e: any) { setClientErr(String(e.message || e)); }
    finally { setSavingClient(false); }
  }

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.unit || "0") * Number(l.qty || 0)), 0);
  const gst = from?.gst_registered ? subtotal * 0.1 : 0;
  const total = subtotal + gst;

  // Deposit + reminders
  const [depositType, setDepositType] = useState<"none" | "percent" | "amount">("none");
  const [depositValue, setDepositValue] = useState("");
  const [reminderFreq, setReminderFreq] = useState("none");

  const depositDue =
    depositType === "percent" ? (total * (parseFloat(depositValue || "0") / 100)) :
    depositType === "amount" ? Math.min(parseFloat(depositValue || "0"), total) : 0;

  async function create() {
    await api("/api/invoices", {
      method: "POST",
      body: JSON.stringify({
        entity_id: Number(from.id),
        client_id: clientId ? Number(clientId) : null,
        deposit_pct: depositType === "percent" && depositValue ? Number(depositValue) : null,
        deposit_cents: depositType === "amount" && depositValue
          ? Math.round(parseFloat(depositValue) * 100) : null,
        reminder_freq: reminderFreq !== "none" ? reminderFreq : null,
        lines: lines.filter((l) => l.description).map((l) => ({
          description: l.description, qty: Number(l.qty),
          unit_cents: Math.round(parseFloat(l.unit || "0") * 100),
          gst_applicable: true,
        })),
      }),
    });
    setShowCreate(false);
    setLines([{ description: "", qty: 1, unit: "" }]);
    setDepositType("none"); setDepositValue(""); setReminderFreq("none");
    refreshInvoices();
  }

  async function send(id: number) { await api(`/api/invoices/${id}/send`, { method: "POST" }); refreshInvoices(); }
  async function markPaid(id: number) { await api(`/api/invoices/${id}/mark-paid`, { method: "POST" }); refreshInvoices(); }

  const profileReady = from?.abn && from?.bank_account_number;

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <div className="text-sm text-muted">
            {selected === "all"
              ? "Showing all income"
              : `Showing ${entities?.find((e: any) => e.id === selected)?.name ?? ""}`}
          </div>
        </div>
        <button className="btn" onClick={() => { setShowCreate(!showCreate); setShowProfile(false); }}>
          + New invoice
        </button>
      </div>

      {showCreate && (
        <div className="card mb-6">
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            <div>
              <div className="stat-label mb-1">Invoice from</div>
              <select className="input" value={String(from?.id ?? "")}
                onChange={(e) => setFromId(e.target.value)}>
                {businesses.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.name}{e.gst_registered ? " · GST" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="stat-label">Bill to (client)</div>
                <button type="button" className="text-xs text-accent hover:underline"
                  onClick={() => { setShowClientForm(!showClientForm); setClientErr(""); }}>
                  {showClientForm ? "Cancel" : "+ New client"}
                </button>
              </div>
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">No client / ad-hoc</option>
                {clients?.filter((c: any) => c.entity_id === from?.id).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {showClientForm && (
            <div className="card bg-panel2/40 mb-4">
              <div className="stat-label mb-2">New client {from ? `for ${from.name}` : ""}</div>
              <div className="grid md:grid-cols-2 gap-2">
                <input className="input" placeholder="Name *" value={newClient.name}
                  onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                <input className="input" placeholder="Email" value={newClient.email}
                  onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} />
                <input className="input" placeholder="Phone" value={newClient.phone}
                  onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} />
                <input className="input" placeholder="Address" value={newClient.address}
                  onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} />
              </div>
              {clientErr && <div className="text-bad text-xs mt-2">{clientErr}</div>}
              <div className="flex justify-end gap-2 mt-3">
                <button className="btn" onClick={createClient} disabled={savingClient || !newClient.name.trim()}>
                  {savingClient ? "Saving…" : "Save client"}
                </button>
              </div>
            </div>
          )}

          {!profileReady && (
            <button onClick={() => setShowProfile(!showProfile)}
              className="w-full text-left mb-4 text-sm text-warn hover:underline">
              ⚠ {from?.name} has no ABN/bank details yet — click to add (one-time, auto-fills invoices)
            </button>
          )}
          {showProfile && from && <div className="mb-4"><BusinessProfile entity={from} /></div>}

          <div className="stat-label mb-2">Line items</div>
          <div className="grid grid-cols-12 gap-2 mb-1 text-xs text-muted px-1">
            <div className="col-span-7">Description</div><div className="col-span-2">Qty</div><div className="col-span-2">Unit $</div>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <input className="input col-span-7" placeholder="e.g. Consulting — 10 hrs" value={l.description}
                onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <input className="input col-span-2" value={l.qty}
                onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value as any } : x))} />
              <input className="input col-span-2" placeholder="0.00" value={l.unit}
                onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
              {lines.length > 1 && (
                <button className="col-span-1 text-muted hover:text-bad text-sm"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
          <button className="btn-ghost mt-1" onClick={() => setLines([...lines, { description: "", qty: 1, unit: "" }])}>
            + Add line
          </button>

          {/* Deposit + reminders */}
          <div className="grid md:grid-cols-2 gap-3 mt-5 pt-4 border-t border-border">
            <div>
              <div className="stat-label mb-1">Deposit required</div>
              <div className="flex gap-2">
                <select className="input w-32" value={depositType}
                  onChange={(e) => { setDepositType(e.target.value as any); setDepositValue(""); }}>
                  <option value="none">None</option>
                  <option value="percent">% of total</option>
                  <option value="amount">Fixed $</option>
                </select>
                {depositType !== "none" && (
                  <input className="input flex-1" placeholder={depositType === "percent" ? "e.g. 50" : "0.00"}
                    value={depositValue} onChange={(e) => setDepositValue(e.target.value)} />
                )}
              </div>
              {depositType !== "none" && depositValue && (
                <div className="text-xs text-muted mt-1">Deposit due: {money(Math.round(depositDue * 100))}</div>
              )}
            </div>
            <div>
              <div className="stat-label mb-1">Payment reminders</div>
              <select className="input" value={reminderFreq} onChange={(e) => setReminderFreq(e.target.value)}>
                <option value="none">No reminders</option>
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div className="flex justify-between items-end mt-5 pt-4 border-t border-border">
            <div className="text-sm text-muted">{from?.gst_registered ? "Includes 10% GST" : "No GST (not registered)"}</div>
            <div className="text-right">
              <div className="text-sm text-muted">Subtotal {money(subtotal * 100)}{from?.gst_registered && ` · GST ${money(gst * 100)}`}</div>
              <div className="text-xl font-semibold">Total {money((subtotal + gst) * 100)}</div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn" onClick={create}>Create invoice</button>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead><tr>
            <th className="th">Number</th><th className="th">From</th><th className="th">Issued</th>
            <th className="th">Due</th><th className="th text-right">Total</th>
            <th className="th">Status</th><th className="th text-right">Actions</th>
          </tr></thead>
          <tbody>
            {invoices?.map((inv: any) => (
              <tr key={inv.id} className="hover:bg-panel2/50">
                <td className="td font-medium">
                  <Link href={`/invoices/${inv.id}`} className="hover:text-accent">{inv.number}</Link>
                </td>
                <td className="td text-muted">{entities?.find((e: any) => e.id === inv.entity_id)?.name}</td>
                <td className="td">{inv.issue_date}</td>
                <td className="td">{inv.due_date}</td>
                <td className="td text-right font-semibold">{money(inv.total_cents)}</td>
                <td className="td"><span className={`px-2 py-0.5 rounded text-xs ${STATUS[inv.status]}`}>{inv.status}</span></td>
                <td className="td text-right space-x-3 whitespace-nowrap">
                  <Link href={`/invoices/${inv.id}`} className="text-accent text-xs">view</Link>
                  {inv.status === "draft" && <button className="text-accent text-xs" onClick={() => send(inv.id)}>send</button>}
                  {inv.hosted_url && inv.status !== "paid" && (
                    <a href={inv.hosted_url} target="_blank" rel="noreferrer" className="text-accent text-xs">pay</a>
                  )}
                  {inv.status !== "paid" && <button className="text-good text-xs" onClick={() => markPaid(inv.id)}>mark paid</button>}
                </td>
              </tr>
            ))}
            {invoices?.length === 0 && <tr><td className="td text-muted" colSpan={7}>No invoices yet — create your first above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
