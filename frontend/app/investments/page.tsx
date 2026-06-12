"use client";
import useSWR from "swr";
import { fetcher, money } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";

export default function Investments() {
  const { selected } = useEntity();
  const { data: holdings } = useSWR(withEntity("/api/holdings", selected), fetcher);
  const { data: cgt } = useSWR(withEntity("/api/cgt-events", selected), fetcher);
  const { data: pack } = useSWR(withEntity("/api/dashboard/tax-pack", selected), fetcher);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Investments & Tax Pack</h1>

      {pack && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat label="Capital gains (gross)" value={money(pack.capital_gains_gross_cents)} />
          <Stat label="Taxable cap gains" value={money(pack.capital_gains_taxable_cents)} sub="after 50% discount" />
          <Stat label="Est. taxable income" value={money(pack.estimated_taxable_income_cents)} />
          <Stat label="Est. balance owing" value={money(pack.estimated_balance_owing_cents)} tone="warn"
            sub="tax − PAYG withheld" />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="stat-label mb-3">Holdings</div>
          <table className="w-full">
            <thead><tr><th className="th">Symbol</th><th className="th">Platform</th>
              <th className="th text-right">Qty</th><th className="th text-right">Avg cost</th></tr></thead>
            <tbody>
              {holdings?.map((h: any) => (
                <tr key={h.id}>
                  <td className="td font-medium">{h.symbol}</td>
                  <td className="td text-muted">{h.platform}</td>
                  <td className="td text-right">{h.qty}</td>
                  <td className="td text-right">{money(h.avg_cost_cents)}</td>
                </tr>
              ))}
              {holdings?.length === 0 && <tr><td className="td text-muted" colSpan={4}>No holdings.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="stat-label mb-3">CGT events</div>
          <table className="w-full">
            <thead><tr><th className="th">Date</th><th className="th">Symbol</th>
              <th className="th text-right">Gain</th><th className="th">Discount</th></tr></thead>
            <tbody>
              {cgt?.map((e: any) => (
                <tr key={e.id}>
                  <td className="td">{e.date}</td>
                  <td className="td">{e.symbol}</td>
                  <td className={`td text-right ${e.gain_cents >= 0 ? "text-good" : "text-bad"}`}>{money(e.gain_cents)}</td>
                  <td className="td text-muted">{e.discounted ? "50%" : "—"}</td>
                </tr>
              ))}
              {cgt?.length === 0 && <tr><td className="td text-muted" colSpan={4}>No CGT events.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: any) {
  const t = tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "";
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${t}`}>{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </div>
  );
}
