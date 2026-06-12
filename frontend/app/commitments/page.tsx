"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money } from "@/lib/api";

const refresh = () => mutate((k) => typeof k === "string" &&
  (k.startsWith("/api/commitments") || k.startsWith("/api/dashboard")));

export default function Commitments() {
  const { data: items } = useSWR("/api/commitments", fetcher);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const total = (items || []).reduce((s: number, c: any) => s + (c.active ? c.amount_cents : 0), 0);

  async function add() {
    if (!name.trim() || !amount) return;
    await api("/api/commitments", {
      method: "POST",
      body: JSON.stringify({ name, amount_cents: Math.round(parseFloat(amount) * 100) }),
    });
    setName(""); setAmount(""); refresh();
  }
  async function toggle(c: any) {
    await api(`/api/commitments/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: c.name, amount_cents: c.amount_cents, entity_id: c.entity_id, active: !c.active }),
    });
    refresh();
  }
  async function del(id: number) {
    await api(`/api/commitments/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-2">Monthly commitments</h1>
      <p className="text-muted text-sm mb-6">
        Recurring fixed costs (rent, loan repayments, subscriptions). These are
        subtracted from your available-to-spend, scaled to the timeframe selected
        on the dashboard.
      </p>

      <div className="card mb-6 grid grid-cols-12 gap-3 items-end">
        <div className="col-span-6">
          <div className="stat-label mb-1">Name</div>
          <input className="input" placeholder="e.g. Rent" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="col-span-4">
          <div className="stat-label mb-1">Amount / month ($)</div>
          <input className="input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button className="btn col-span-2 h-9" onClick={add}>Add</button>
      </div>

      <div className="card p-0 overflow-hidden mb-4">
        <table className="w-full">
          <thead><tr><th className="th">Commitment</th><th className="th text-right">Per month</th><th className="th text-right">Actions</th></tr></thead>
          <tbody>
            {items?.map((c: any) => (
              <tr key={c.id} className={c.active ? "" : "opacity-40"}>
                <td className="td">{c.name}</td>
                <td className="td text-right">{money(c.amount_cents)}</td>
                <td className="td text-right space-x-3">
                  <button className="text-muted hover:text-white text-xs" onClick={() => toggle(c)}>
                    {c.active ? "pause" : "resume"}
                  </button>
                  <button className="text-muted hover:text-bad text-xs" onClick={() => del(c.id)}>delete</button>
                </td>
              </tr>
            ))}
            {items?.length === 0 && <tr><td className="td text-muted" colSpan={3}>No commitments yet — add one above.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card flex justify-between items-center">
        <span className="stat-label">Total per month</span>
        <span className="text-xl font-semibold">{money(total)}</span>
      </div>
    </div>
  );
}
