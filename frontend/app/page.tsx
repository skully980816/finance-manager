"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher, api, money, moneyShort } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";

const COLORS = ["#5b8cff", "#3ecf8e", "#f5a623", "#c678ff", "#ff5c5c", "#38bdf8", "#fb923c", "#a3e635", "#e879f9", "#34d399"];

// Period helpers
function fyLabel(offset: number) {
  const today = new Date();
  const fyYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  const y = fyYear + offset;
  return { label: `FY${String(y + 1).slice(2)}`, start: `${y}-07-01`, end: `${y + 1}-06-30` };
}

function monthBounds() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return { label: today.toLocaleString("default", { month: "long" }), start: `${y}-${m}-01`, end: `${y}-${m}-${lastDay}` };
}

type Period = "month" | "fy0" | "fy-1";

function periodBounds(p: Period) {
  if (p === "month") return monthBounds();
  if (p === "fy-1") return fyLabel(-1);
  return fyLabel(0);
}

export default function Dashboard() {
  const { selected } = useEntity();
  const [period, setPeriod] = useState<Period>("fy0");
  const bounds = periodBounds(period);

  const url = withEntity(`/api/dashboard/summary?start=${bounds.start}&end=${bounds.end}`, selected);
  const REFRESH = { refreshInterval: 3_600_000 }; // 1 hour
  const { data, error } = useSWR(url, fetcher, REFRESH);
  // Always fetch the unfiltered summary so we can show business stats alongside personal
  const bizSummaryUrl = `/api/dashboard/summary?start=${bounds.start}&end=${bounds.end}`;
  const { data: bizSummary } = useSWR(bizSummaryUrl, fetcher, REFRESH);
  const { data: entities } = useSWR("/api/entities", fetcher, REFRESH);
  const { data: recurringData } = useSWR(withEntity("/api/transactions/recurring", selected), fetcher, REFRESH);
  const { data: balanceData } = useSWR(withEntity("/api/accounts/balances", selected), fetcher, REFRESH);
  const { data: categories } = useSWR("/api/categories", fetcher, REFRESH);
  const [payOpen, setPayOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<string | null>(null);

  // All transactions for the period — used for drill-down panels
  const allTxnsUrl = withEntity(
    `/api/transactions?limit=1000&start=${bounds.start}&end=${bounds.end}`, selected
  );
  const { data: allTxns } = useSWR(allTxnsUrl, fetcher, REFRESH);
  const incomeTxns = (allTxns || []).filter((t: any) => t.direction === "in");

  const [pinnedSources, setPinnedSources] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("pinned-income-sources") || "[]"); } catch { return []; }
  });
  function togglePin(name: string) {
    setPinnedSources((prev) => {
      const next = prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
      localStorage.setItem("pinned-income-sources", JSON.stringify(next));
      return next;
    });
  }

  if (error) return <Err />;
  if (!data) return <div className="text-muted">Loading…</div>;

  const viewingBusiness = data.viewing_business;
  const businessEntities = (entities || []).filter((e: any) => e.kind === "business");

  const monthData = Object.entries(data.by_month || {}).map(([m, v]: any) => ({
    month: m.slice(5),
    Income: v.in / 100,
    Expenses: v.out / 100,
  }));


  const allSourceData = Object.entries(data.by_income_type || {}).map(([k, v]: any) => ({
    name: k, value: (v as number) / 100,
  }));
  const pinned = allSourceData.filter((d) => pinnedSources.includes(d.name));
  const unpinned = allSourceData.filter((d) => !pinnedSources.includes(d.name));
  const typeData = [...pinned, ...unpinned.slice(0, Math.max(0, 5 - pinned.length))];

  const catData = Object.entries(data.by_category || {})
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]: any) => ({ name: k, value: v / 100 }))
    .slice(0, 10);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <div className="text-sm text-muted">
            {viewingBusiness ? "Business view" : selected === "all" ? "All income" : "Personal view"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={() => setPayOpen(!payOpen)}>Pay yourself</button>
          {/* Period selector */}
          <div className="flex rounded-lg overflow-hidden border border-border text-sm">
            {(["month", "fy0", "fy-1"] as Period[]).map((p) => {
              const labels: Record<Period, string> = { month: "This month", fy0: fyLabel(0).label, "fy-1": fyLabel(-1).label };
              return (
                <button
                  key={p}
                  className={`px-3 py-1.5 ${period === p ? "bg-accent text-white" : "text-muted hover:text-white"}`}
                  onClick={() => setPeriod(p)}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-muted">{bounds.start} → {bounds.end}</span>
        </div>
      </div>

      {payOpen && <PayYourself entities={entities} onDone={() => setPayOpen(false)} keyToRefresh={url} />}

      {viewingBusiness ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Business income" value={money(data.business_income_cents)} tone="good" sub="gross (incl. GST)" />
          <Stat label="Business expenses" value={money(data.business_expenses_cents)} />
          <Stat label="GST owed (BAS)" value={money(data.gst_owed_cents)} tone="warn" sub="collected − credits" />
          <Stat label="Retained in business" value={money(data.business_retained_cents - data.gst_owed_cents)} tone="accent" big
            sub="cash left after drawings & GST" />
        </div>
      ) : (
        <>
          {/* Personal stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <BalanceCard data={balanceData} />
            <Stat label="Personal income" value={money(data.personal_income_cents + (data.interest_income_cents || 0))} tone="good"
              sub={data.interest_income_cents > 0 ? `Incl. ${money(data.interest_income_cents)} interest` : "excl. savings & transfers"}
              onClick={() => setDrillDown(drillDown === "income" ? null : "income")}
              active={drillDown === "income"} />
            <Stat label="Personal expenses" value={money(data.personal_expenses_cents)}
              sub="excl. internal transfers"
              onClick={() => setDrillDown(drillDown === "expenses" ? null : "expenses")}
              active={drillDown === "expenses"} />
            <Stat label="Available to spend" value={money(data.available_to_spend_cents)} tone="accent" big
              sub={`Tax: ${money(data.tax_setaside_cents)} · Commitments: ${money(data.monthly_commitments_cents || 0)}/mo`}
              onClick={() => setDrillDown(drillDown === "available" ? null : "available")}
              active={drillDown === "available"} />
          </div>

          {/* Stat drill-down */}
          {drillDown && (
            <StatDrillDown
              type={drillDown}
              txns={allTxns || []}
              summary={data}
              categories={categories || []}
              onClose={() => setDrillDown(null)}
            />
          )}

          {/* Sole Trader section */}
          {bizSummary && (bizSummary.business_income_cents > 0 || bizSummary.business_expenses_cents > 0) && (
            <div className="card mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {businessEntities.length === 1 ? businessEntities[0].name : "Sole Trader"} · Business
                </div>
                {bizSummary.gst_owed_cents > 0 && (
                  <span className="text-xs text-warn">GST owed: {money(bizSummary.gst_owed_cents)}</span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div
                  className="cursor-pointer hover:bg-surface-2 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setDrillDown(drillDown === "biz_income" ? null : "biz_income")}
                >
                  <div className="stat-label">Revenue</div>
                  <div className="stat-value text-good">{money(bizSummary.business_income_cents)}</div>
                  <div className="text-xs text-muted mt-1">gross (incl. GST)</div>
                </div>
                <div
                  className="cursor-pointer hover:bg-surface-2 rounded-lg p-2 -m-2 transition-colors"
                  onClick={() => setDrillDown(drillDown === "biz_expenses" ? null : "biz_expenses")}
                >
                  <div className="stat-label">Expenses</div>
                  <div className="stat-value">{money(bizSummary.business_expenses_cents)}</div>
                </div>
                <div>
                  <div className="stat-label">Net profit</div>
                  <div className={`stat-value ${bizSummary.business_net_cents >= 0 ? "text-good" : "text-bad"}`}>
                    {money(bizSummary.business_net_cents)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Held in business</div>
                  <div className="stat-value">{money(bizSummary.business_retained_cents)}</div>
                  <div className="text-xs text-muted mt-1">
                    {bizSummary.drawings_cents > 0 ? `Drawn: ${money(bizSummary.drawings_cents)}` : "not yet drawn"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Monthly commitments */}
          {recurringData?.total_monthly_cents > 0 && (
            <div className="card mb-6 flex items-center justify-between">
              <div>
                <div className="stat-label">Monthly commitments</div>
                <div className="stat-value text-warn">{money(recurringData.total_monthly_cents)}</div>
                <div className="text-xs text-muted mt-1">
                  {recurringData.items?.length} recurring expenses · {money(recurringData.total_annual_cents)}/yr
                </div>
              </div>
              <a href="/recurring" className="btn-ghost text-sm">View all →</a>
            </div>
          )}
        </>
      )}

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className="card lg:col-span-2">
          <div className="stat-label mb-4">Income vs Expenses by month</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262c3a" />
              <XAxis dataKey="month" stroke="#8a93a6" fontSize={12} />
              <YAxis stroke="#8a93a6" fontSize={12} tickFormatter={(v) => "$" + v / 1000 + "k"} />
              <Tooltip
                contentStyle={{ background: "#141821", border: "1px solid #262c3a", borderRadius: 8 }}
                formatter={(v: any) => "$" + v.toLocaleString()}
              />
              <Bar dataKey="Income" fill="#3ecf8e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="#ff5c5c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="stat-label">Income by source</div>
            {allSourceData.length > 5 && (
              <span className="text-xs text-muted">top 5 of {allSourceData.length}</span>
            )}
          </div>
          {typeData.length === 0 ? (
            <div className="text-muted text-sm">Label income on the Transactions page for it to appear here.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={typeData} dataKey="value" nameKey="name"
                    innerRadius={45} outerRadius={75} paddingAngle={2}
                    onClick={(d: any) => setSelectedSource(selectedSource === d.name ? null : d.name)}
                    style={{ cursor: "pointer" }}
                  >
                    {typeData.map((t, i) => (
                      <Cell
                        key={i}
                        fill={COLORS[i % COLORS.length]}
                        opacity={selectedSource && selectedSource !== t.name ? 0.35 : 1}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#141821", border: "1px solid #262c3a", borderRadius: 8 }}
                    formatter={(v: any) => "$" + v.toLocaleString()}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-3">
                {typeData.map((t, i) => {
                  const isPinned = pinnedSources.includes(t.name);
                  const isSelected = selectedSource === t.name;
                  return (
                    <div
                      key={t.name}
                      className={`flex items-center gap-2 group rounded-lg px-2 py-1 cursor-pointer transition-colors ${isSelected ? "bg-surface-2" : "hover:bg-surface-2/50"}`}
                      onClick={() => setSelectedSource(isSelected ? null : t.name)}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-xs flex-1 truncate">{t.name}</span>
                      <span className="text-xs text-muted">{moneyShort(t.value * 100)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(t.name); }}
                        title={isPinned ? "Unpin" : "Pin to top"}
                        className={`text-xs transition-opacity ${isPinned ? "opacity-100 text-warn" : "opacity-0 group-hover:opacity-60 text-muted hover:text-warn"}`}
                      >★</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Income source drill-down */}
      {selectedSource && (
        <IncomeSourcePanel
          source={selectedSource}
          txns={incomeTxns || []}
          onClose={() => setSelectedSource(null)}
        />
      )}

      {/* Spending by category */}
      {catData.length > 0 && (
        <div className="card">
          <div className="stat-label mb-4">Spending by category ({bounds.label})</div>
          <div className="grid lg:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={catData} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262c3a" horizontal={false} />
                <XAxis type="number" stroke="#8a93a6" fontSize={11} tickFormatter={(v) => "$" + (v / 1000).toFixed(1) + "k"} />
                <YAxis type="category" dataKey="name" stroke="#8a93a6" fontSize={11} width={130} />
                <Tooltip
                  contentStyle={{ background: "#141821", border: "1px solid #262c3a", borderRadius: 8 }}
                  formatter={(v: any) => ["$" + v.toLocaleString(), "Spent"]}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {catData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="space-y-2">
              {catData.map((c, i) => {
                const total = catData.reduce((s, x) => s + x.value, 0);
                const pct = total > 0 ? Math.round((c.value / total) * 100) : 0;
                return (
                  <div key={c.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                        <span>{c.name}</span>
                      </div>
                      <span className="text-muted">{moneyShort(c.value * 100)} · {pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function BalanceCard({ data }: { data: any }) {
  return (
    <div className="card ring-1 ring-accent/40">
      <div className="stat-label">Total balance</div>
      <div className="stat-value text-accent">{data ? money(data.total_cents) : "…"}</div>
      {data?.accounts && data.accounts.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-1.5">
          {data.accounts.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted truncate">{a.name}</span>
              <span className="text-xs text-white flex-shrink-0">{money(a.balance_cents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone, big, onClick, active }: any) {
  const toneClass =
    tone === "good" ? "text-good" : tone === "warn" ? "text-warn" :
    tone === "accent" ? "text-accent" : tone === "bad" ? "text-bad" : "";
  return (
    <div
      className={`card transition-colors ${big ? "ring-1 ring-accent/40" : ""} ${onClick ? "cursor-pointer hover:bg-surface-2" : ""} ${active ? "ring-1 ring-accent/60 bg-surface-2" : ""}`}
      onClick={onClick}
    >
      <div className="stat-label flex items-center justify-between">
        {label}
        {onClick && <span className="text-muted text-xs opacity-50">{active ? "▲" : "▼"}</span>}
      </div>
      <div className={`stat-value ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}

function PayYourself({ entities, onDone, keyToRefresh }: any) {
  const businesses = (entities || []).filter((e: any) => e.kind === "business");
  const personal = (entities || []).find((e: any) => e.kind === "personal");
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");

  async function pay() {
    setErr("");
    try {
      await api("/api/transactions/drawing", {
        method: "POST",
        body: JSON.stringify({
          from_entity_id: Number(fromId || businesses[0]?.id),
          to_entity_id: personal?.id,
          amount_cents: Math.round(parseFloat(amount) * 100),
        }),
      });
      mutate(keyToRefresh);
      mutate((k: any) => typeof k === "string" && k.startsWith("/api/transactions"));
      onDone();
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  }

  if (!personal) return (
    <div className="card border-warn/40 mb-6 text-sm text-warn">
      Create a Personal entity first (Manage businesses) to record drawings.
    </div>
  );

  return (
    <div className="card mb-6">
      <div className="font-medium mb-1">Pay yourself (record a drawing)</div>
      <p className="text-xs text-muted mb-4">
        Moves money from a business to <b>{personal.name}</b>. Only drawn money counts as
        personal income & becomes spendable.
      </p>
      <div className="grid md:grid-cols-3 gap-3 items-end">
        <div>
          <div className="stat-label mb-1">From business</div>
          <select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {businesses.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <div className="stat-label mb-1">Amount ($)</div>
          <input className="input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={pay}>Pay</button>
          <button className="btn-ghost" onClick={onDone}>Cancel</button>
        </div>
      </div>
      {err && <div className="text-bad text-sm mt-2">{err}</div>}
    </div>
  );
}

function StatDrillDown({ type, txns, summary, categories, onClose }: any) {
  const catMap: Record<number, string> = Object.fromEntries(
    (categories || []).map((c: any) => [c.id, c.name])
  );

  const configs: Record<string, { title: string; filter: (t: any) => boolean; dir: "in" | "out" | null }> = {
    income:       { title: "Personal income",   filter: (t) => t.direction === "in",  dir: "in" },
    expenses:     { title: "Personal expenses", filter: (t) => t.direction === "out", dir: "out" },
    available:    { title: "Available to spend breakdown", filter: () => false, dir: null },
    biz_income:   { title: "Business revenue",  filter: (t) => t.direction === "in",  dir: "in" },
    biz_expenses: { title: "Business expenses", filter: (t) => t.direction === "out", dir: "out" },
  };

  const cfg = configs[type];
  if (!cfg) return null;

  // "available" shows a formula breakdown, not a list
  if (type === "available") {
    return (
      <div className="card mb-4 border border-accent/30">
        <div className="flex items-center justify-between mb-4">
          <div className="font-medium">Available to spend — breakdown</div>
          <button className="text-muted hover:text-white text-lg leading-none" onClick={onClose}>×</button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted">Personal income</span>
            <span className="text-good">{money(summary.personal_income_cents)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted">minus Personal expenses</span>
            <span className="text-bad">− {money(summary.personal_expenses_cents)}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-border">
            <span className="text-muted">minus Tax set aside</span>
            <span className="text-warn">− {money(summary.tax_setaside_cents)}</span>
          </div>
          <div className="flex justify-between py-2 font-medium text-base">
            <span>Available to spend</span>
            <span className="text-accent">{money(summary.available_to_spend_cents)}</span>
          </div>
        </div>
      </div>
    );
  }

  const rows = txns.filter(cfg.filter);
  const total = rows.reduce((s: number, t: any) => s + t.amount_cents, 0);

  // Group by category for expenses, by normalised source for income
  const groups: Record<string, { total: number; txns: any[] }> = {};
  for (const t of rows) {
    const label = cfg.dir === "out"
      ? (t.category_id ? (catMap[t.category_id] || `Category #${t.category_id}`) : "Uncategorised")
      : normaliseSource(t.description || "");
    if (!groups[label]) groups[label] = { total: 0, txns: [] };
    groups[label].total += t.amount_cents;
    groups[label].txns.push(t);
  }
  const sorted = Object.entries(groups).sort((a, b) => b[1].total - a[1].total);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card mb-4 border border-accent/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-medium">{cfg.title}</div>
          <div className="text-xs text-muted mt-0.5">
            {rows.length} transactions · total {money(total)}
          </div>
        </div>
        <button className="text-muted hover:text-white text-lg leading-none" onClick={onClose}>×</button>
      </div>

      <div className="space-y-1">
        {sorted.map(([label, group]) => (
          <div key={label} className="rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2 text-left transition-colors"
              onClick={() => setExpanded(expanded === label ? null : label)}
            >
              <span className="flex-1 text-sm font-medium truncate">{label}</span>
              <span className="text-xs text-muted">{group.txns.length} transactions</span>
              <span className={`text-sm font-medium ${cfg.dir === "in" ? "text-good" : "text-bad"}`}>
                {cfg.dir === "in" ? "+" : "−"}{money(group.total)}
              </span>
              <span className="text-muted text-xs">{expanded === label ? "▲" : "▼"}</span>
            </button>
            {expanded === label && (
              <div className="divide-y divide-border border-t border-border bg-surface-2/50">
                {group.txns.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-4 px-4 py-2">
                    <span className="text-xs text-muted w-24 flex-shrink-0">{t.date}</span>
                    <span className="text-xs flex-1 truncate text-muted">{t.description}</span>
                    <span className={`text-xs font-medium flex-shrink-0 ${cfg.dir === "in" ? "text-good" : "text-bad"}`}>
                      {cfg.dir === "in" ? "+" : "−"}{money(t.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="text-muted text-sm py-2">No transactions for this period.</div>
        )}
      </div>
    </div>
  );
}

// Mirror of backend _normalise_income_label for client-side matching
function normaliseSource(desc: string): string {
  let s = desc.split(/\s*[—–]\s*/)[0];
  s = s.replace(/\s+\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/, "");
  s = s.replace(/\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*\d{2,4}$/i, "");
  s = s.replace(/\s+\d{6,}$/, "");
  return s.trim().replace(/[ .,;:-]+$/, "").toLowerCase();
}

function IncomeSourcePanel({ source, txns, onClose }: { source: string; txns: any[]; onClose: () => void }) {
  const matched = txns.filter((t: any) => {
    if (t.income_type) return t.income_type.replace(/_/g, " ").toLowerCase() === source.toLowerCase();
    return normaliseSource(t.description || "") === normaliseSource(source);
  });

  const total = matched.reduce((s: number, t: any) => s + t.amount_cents, 0);

  return (
    <div className="card mb-4 border border-accent/30">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-medium">{source}</div>
          <div className="text-xs text-muted mt-0.5">
            {matched.length} transaction{matched.length !== 1 ? "s" : ""} · total {money(total)}
          </div>
        </div>
        <button className="text-muted hover:text-white text-lg leading-none" onClick={onClose}>×</button>
      </div>
      <div className="space-y-0 divide-y divide-border">
        {matched.length === 0 && (
          <div className="text-muted text-sm py-2">No transactions found for this period.</div>
        )}
        {matched.map((t: any) => (
          <div key={t.id} className="flex items-center gap-4 py-2.5">
            <span className="text-xs text-muted w-24 flex-shrink-0">{t.date}</span>
            <span className="text-sm flex-1 truncate">{t.description}</span>
            <span className="text-sm font-medium text-good flex-shrink-0">+{money(t.amount_cents)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Err() {
  return (
    <div className="card border-bad/40">
      <div className="text-bad font-medium">Can't reach the API.</div>
      <div className="text-sm text-muted mt-1">
        Start the backend: <code className="text-white">uvicorn app.main:app --port 8077</code>
      </div>
    </div>
  );
}
