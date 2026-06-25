"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { useEntity } from "@/lib/entity-context";

const links = [
  ["/", "Dashboard"],
  ["/connections", "Connections"],
  ["/transactions", "Transactions"],
  ["/recurring", "Recurring"],
  ["/import", "Import CSV"],
  ["/receipts", "Receipts"],
  ["/commitments", "Commitments"],
  ["/deductions", "Deductions"],
  ["/invoices", "Invoices"],
  ["/clients", "Clients"],
  ["/investments", "Investments"],
  ["/networth", "Net Worth"],
];

export function Nav() {
  const path = usePathname();
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { selected, setSelected } = useEntity();

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-panel p-4 flex flex-col">
      <div className="px-3 py-2 mb-3">
        <div className="text-lg font-semibold">Ledger</div>
        <div className="text-xs text-muted">Finance Manager</div>
      </div>

      {/* Business switcher */}
      <div className="px-1 mb-4">
        <div className="stat-label mb-1">Business</div>
        <select
          className="input"
          value={String(selected)}
          onChange={(e) => setSelected(e.target.value === "all" ? "all" : Number(e.target.value))}
        >
          <option value="all">All income</option>
          {entities?.map((e: any) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {links.map(([href, label]) => (
          <Link key={href} href={href}
            className={`nav-link ${path === href ? "nav-link-active" : ""}`}>
            {label}
          </Link>
        ))}
      </nav>

      <Link href="/businesses"
        className={`nav-link mt-2 ${path === "/businesses" ? "nav-link-active" : ""}`}>
        ⚙ Manage businesses
      </Link>
    </aside>
  );
}
