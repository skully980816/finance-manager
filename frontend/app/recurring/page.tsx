"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher, api, money, moneyShort } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";

const FREQS = ["weekly", "fortnightly", "monthly", "quarterly", "annual"];

function monthlyFromFreq(cents: number, freq: string) {
  const m: Record<string, number> = {
    weekly: 52 / 12, fortnightly: 26 / 12, monthly: 1,
    quarterly: 1 / 3, annual: 1 / 12,
  };
  return Math.round(cents * (m[freq] ?? 1));
}

export default function Recurring() {
  const { selected } = useEntity();
  const { data: entities } = useSWR("/api/entities", fetcher);
  const url = withEntity("/api/transactions/recurring", selected);
  const { data, mutate } = useSWR(url, fetcher);

  const [form, setForm] = useState({
    description: "", amount: "", freq: "monthly",
    date: new Date().toISOString().slice(0, 10),
  });
  const [err, setErr] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<{ marked: number; groups_detected: number } | null>(null);

  const defaultEntity = selected !== "all" ? selected : entities?.[0]?.id;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const cents = Math.round(parseFloat(form.amount) * 100);
    if (!form.description || isNaN(cents) || cents <= 0) {
      setErr("Enter a description and amount.");
      return;
    }
    try {
      await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          entity_id: Number(defaultEntity),
          date: form.date,
          amount_cents: cents,
          direction: "out",
          description: form.description,
          is_recurring: true,
          recurrence_freq: form.freq,
        }),
      });
      setForm({ ...form, description: "", amount: "" });
      mutate();
    } catch (e: any) { setErr(String(e.message || e)); }
  }

  async function detect() {
    setDetecting(true);
    setDetectResult(null);
    try {
      const entityParam = selected !== "all" ? `?entity_id=${selected}` : "";
      const result = await api(`/api/transactions/detect-recurring${entityParam}`, { method: "POST" });
      setDetectResult(result);
      mutate();
    } finally {
      setDetecting(false);
    }
  }

  async function remove(id: number) {
    await api(`/api/transactions/${id}/recurring`, {
      method: "PATCH",
      body: JSON.stringify({ is_recurring: false, recurrence_freq: null }),
    });
    mutate();
  }

  const items: any[] = data?.items ?? [];
  const totalMonthly: number = data?.total_monthly_cents ?? 0;
  const totalAnnual: number = data?.total_annual_cents ?? 0;

  return (
    <div className="max-w-3xl">
      <div className="flex items-baseline justify-between mb-2">
        <h1 className="text-2xl font-semibold">Recurring expenses</h1>
        <div className="text-sm text-muted">
          {moneyShort(totalMonthly)}/mo · {moneyShort(totalAnnual)}/yr
        </div>
      </div>
      <p className="text-muted text-sm mb-4">
        Ongoing commitments factored into your available-to-spend. Recurring payments are
        auto-detected after every UP sync, or run detection manually below.
      </p>
      <div className="flex items-center gap-3 mb-6">
        <button className="btn" onClick={detect} disabled={detecting}>
          {detecting ? "Detecting…" : "Auto-detect recurring"}
        </button>
        {detectResult && (
          <span className="text-xs text-good">
            Found {detectResult.groups_detected} patterns · {detectResult.marked} transactions updated
          </span>
        )}
      </div>

      {/* Add manual recurring expense */}
      <form onSubmit={add} className="card mb-6">
        <div className="stat-label mb-3">Add recurring expense</div>
        <div className="grid md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <div className="stat-label mb-1">Description</div>
            <input className="input" placeholder="e.g. Spotify, Rent, Gym"
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <div className="stat-label mb-1">Amount ($)</div>
            <input className="input" placeholder="0.00"
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <div className="stat-label mb-1">Frequency</div>
            <select className="input" value={form.freq}
              onChange={(e) => setForm({ ...form, freq: e.target.value })}>
              {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div>
            <div className="stat-label mb-1">Date (first occurrence)</div>
            <input type="date" className="input text-sm" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <button className="btn mt-5">Add</button>
        </div>
        {err && <div className="text-bad text-xs mt-2">{err}</div>}
      </form>

      {/* Recurring list */}
      {items.length === 0 ? (
        <div className="text-muted text-sm card">
          No recurring expenses yet. Mark transactions as recurring from the{" "}
          <a href="/transactions" className="text-accent underline">Transactions</a> page using the ↻ button,
          or add one manually above.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Description</th>
                <th className="th">Category</th>
                <th className="th">Frequency</th>
                <th className="th text-right">Per occurrence</th>
                <th className="th text-right">Monthly equiv.</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id}>
                  <td className="td font-medium">{item.description}</td>
                  <td className="td text-muted text-xs">{item.category}</td>
                  <td className="td">
                    <FreqBadge freq={item.recurrence_freq} />
                  </td>
                  <td className="td text-right">{money(item.amount_cents)}</td>
                  <td className="td text-right font-medium text-bad">
                    {moneyShort(item.monthly_cents)}
                  </td>
                  <td className="td text-right">
                    <button onClick={() => remove(item.id)}
                      className="text-xs text-muted hover:text-bad">remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={4} className="px-4 py-3 text-sm font-medium">Total</td>
                <td className="px-4 py-3 text-right font-semibold text-bad">
                  {moneyShort(totalMonthly)}/mo
                </td>
                <td className="px-4 py-3 text-right text-muted text-xs">
                  {moneyShort(totalAnnual)}/yr
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function FreqBadge({ freq }: { freq: string | null }) {
  const colors: Record<string, string> = {
    weekly: "bg-bad/20 text-bad",
    fortnightly: "bg-warn/20 text-warn",
    monthly: "bg-accent/20 text-accent",
    quarterly: "bg-good/20 text-good",
    annual: "bg-muted/20 text-muted",
  };
  const f = freq || "monthly";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[f] ?? "bg-muted/20 text-muted"}`}>
      {f}
    </span>
  );
}
