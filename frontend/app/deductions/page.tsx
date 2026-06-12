"use client";
import useSWR from "swr";
import { fetcher, money } from "@/lib/api";
import { useEntity, withEntity } from "@/lib/entity-context";

export default function Deductions() {
  const { selected } = useEntity();
  const { data } = useSWR(withEntity("/api/dashboard/deductions", selected), fetcher);
  if (!data) return <div className="text-muted">Loading…</div>;
  const cats = Object.entries(data.by_category || {});

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold">Deductions (EOFY)</h1>
        <span className="text-sm text-muted">{data.period.start} → {data.period.end}</span>
      </div>

      <div className="card mb-6">
        <div className="stat-label">Total deductible this FY</div>
        <div className="stat-value text-good">{money(data.total_deductible_cents)}</div>
        <p className="text-xs text-muted mt-1">
          Claimable amounts already adjusted for business-use %.
        </p>
      </div>

      {cats.length === 0 && <div className="text-muted text-sm">No deductible expenses tagged yet.</div>}

      {cats.map(([cat, g]: any) => (
        <div key={cat} className="card mb-4">
          <div className="flex justify-between items-baseline mb-3">
            <div className="font-medium">{cat}</div>
            <div className="text-good font-semibold">{money(g.total_cents)}</div>
          </div>
          <table className="w-full">
            <thead><tr>
              <th className="th">Date</th><th className="th">Description</th>
              <th className="th text-right">Amount</th><th className="th text-right">Use %</th>
              <th className="th text-right">Claimable</th>
            </tr></thead>
            <tbody>
              {g.items.map((i: any, idx: number) => (
                <tr key={idx}>
                  <td className="td">{i.date}</td>
                  <td className="td">{i.description}</td>
                  <td className="td text-right">{money(i.amount_cents)}</td>
                  <td className="td text-right text-muted">{i.business_use_pct}%</td>
                  <td className="td text-right text-good">{money(i.claimable_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
