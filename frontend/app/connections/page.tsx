"use client";
import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher, api, money } from "@/lib/api";

// ── Quick-add presets ──────────────────────────────────────────────────────────
const PRESETS = [
  { name: "Raiz Invest",     type: "investment", emoji: "🌱" },
  { name: "Stake",           type: "investment", emoji: "📈" },
  { name: "Pearler",         type: "investment", emoji: "📊" },
  { name: "CommBank",        type: "savings",    emoji: "🏦" },
  { name: "ANZ",             type: "savings",    emoji: "🏦" },
  { name: "NAB",             type: "savings",    emoji: "🏦" },
  { name: "Westpac",         type: "savings",    emoji: "🏦" },
  { name: "ING",             type: "savings",    emoji: "🏦" },
  { name: "Macquarie",       type: "savings",    emoji: "🏦" },
  { name: "Super",           type: "investment", emoji: "🔒" },
  { name: "Cash",            type: "everyday",   emoji: "💵" },
];

const TYPE_LABELS: Record<string, string> = {
  everyday:   "Everyday",
  savings:    "Savings",
  investment: "Investment",
  loan:       "Loan",
  credit:     "Credit",
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Connections() {
  const { data: entities } = useSWR("/api/entities", fetcher);
  const { data: allAccounts, mutate: mutateAccounts } = useSWR("/api/accounts", fetcher);
  const [adding, setAdding] = useState<{ name: string; type: string } | null>(null);
  const [addEntityId, setAddEntityId] = useState<string>("");

  const personalEntities = (entities || []).filter((e: any) => e.kind === "personal");
  const businessEntities = (entities || []).filter((e: any) => e.kind === "business");
  const defaultEntityId = personalEntities[0]?.id ?? entities?.[0]?.id;

  // Accounts NOT linked to UP (manual)
  const manualAccounts = (allAccounts || []).filter((a: any) => !a.up_account_id);
  // Accounts linked to UP (live)
  const liveAccounts = (allAccounts || []).filter((a: any) => a.up_account_id);

  async function addAccount(name: string, type: string, entityId: number) {
    await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ name, type, entity_id: entityId, balance_cents: 0 }),
    });
    await mutateAccounts();
    setAdding(null);
  }

  function startPreset(preset: { name: string; type: string }) {
    setAdding(preset);
    setAddEntityId(String(defaultEntityId || ""));
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="text-sm text-muted mt-1">
          Manage bank and app connections. Live connections sync automatically; manual accounts let you track any balance by updating it yourself.
        </p>
      </div>

      {/* ── Live connections ── */}
      <section className="mb-8">
        <div className="stat-label mb-3">Live connections</div>
        <div className="flex flex-col gap-3">
          {[...personalEntities, ...businessEntities].map((entity: any) => (
            <UpCard key={entity.id} entity={entity} liveAccounts={liveAccounts} />
          ))}
          {entities?.length === 0 && (
            <div className="text-muted text-sm">No entities yet — create one in Businesses &amp; accounts first.</div>
          )}
        </div>
      </section>

      {/* ── Manual accounts ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="stat-label">Manual accounts</div>
          <button className="btn-ghost text-sm" onClick={() => startPreset({ name: "", type: "savings" })}>
            + Add custom
          </button>
        </div>

        {/* Quick-add presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {PRESETS.map((p) => {
            const alreadyAdded = manualAccounts.some(
              (a: any) => a.name.toLowerCase() === p.name.toLowerCase()
            );
            return (
              <button
                key={p.name}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  alreadyAdded
                    ? "border-border text-muted cursor-default"
                    : "border-border hover:border-accent hover:text-white text-muted"
                }`}
                onClick={() => !alreadyAdded && startPreset(p)}
                disabled={alreadyAdded}
              >
                <span>{p.emoji}</span>
                <span>{p.name}</span>
                {alreadyAdded && <span className="text-good text-xs">✓</span>}
              </button>
            );
          })}
        </div>

        {/* Add form */}
        {adding !== null && (
          <div className="card mb-4">
            <div className="stat-label mb-3">New account</div>
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-1">
                <div className="stat-label mb-1">Name</div>
                <input
                  className="input"
                  placeholder="e.g. Raiz Invest"
                  value={adding.name}
                  onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                />
              </div>
              <div>
                <div className="stat-label mb-1">Type</div>
                <select
                  className="input"
                  value={adding.type}
                  onChange={(e) => setAdding({ ...adding, type: e.target.value })}
                >
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="stat-label mb-1">Under</div>
                <select
                  className="input"
                  value={addEntityId}
                  onChange={(e) => setAddEntityId(e.target.value)}
                >
                  {(entities || []).map((e: any) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => adding.name.trim() && addAccount(adding.name.trim(), adding.type, Number(addEntityId))}
                >
                  Add
                </button>
                <button className="btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* Manual account list */}
        <div className="flex flex-col gap-2">
          {manualAccounts.map((a: any) => (
            <ManualAccountRow key={a.id} account={a} entities={entities} onUpdate={mutateAccounts} />
          ))}
          {manualAccounts.length === 0 && !adding && (
            <div className="text-muted text-sm">
              No manual accounts yet — click a quick-add button above or use "+ Add custom".
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── UP Banking card per entity ─────────────────────────────────────────────────
function UpCard({ entity, liveAccounts }: { entity: any; liveAccounts: any[] }) {
  const connected = !!entity.up_connected;
  const [token, setToken] = useState("");
  const [tokenErr, setTokenErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncErr, setSyncErr] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [since, setSince] = useState("");
  const [showSince, setShowSince] = useState(false);

  const { data: localAccounts, mutate: mutateLocal } = useSWR(
    `/api/accounts?entity_id=${entity.id}`, fetcher
  );
  const { data: upAccounts, mutate: mutateUp } = useSWR(
    connected ? `/api/up/accounts/${entity.id}` : null, fetcher
  );

  const myLiveAccounts = liveAccounts.filter((a: any) => a.entity_id === entity.id);

  async function connect() {
    if (!token.trim()) return;
    setTokenErr(""); setLoading(true);
    try {
      await api("/api/up/connect", {
        method: "POST",
        body: JSON.stringify({ entity_id: entity.id, token: token.trim() }),
      });
      setToken("");
      globalMutate("/api/entities");
      mutateUp();
    } catch (e: any) { setTokenErr(String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function disconnect() {
    await api(`/api/up/connect/${entity.id}`, { method: "DELETE" });
    globalMutate("/api/entities");
    mutateUp();
  }

  async function backfillTransfers() {
    setBackfilling(true); setBackfillResult(null);
    try {
      const res = await api("/api/up/backfill-transfers", { method: "POST" });
      setBackfillResult(res);
      globalMutate((k: any) => typeof k === "string" && k.startsWith("/api/"));
    } finally { setBackfilling(false); }
  }

  async function sync() {
    setSyncErr(""); setSyncResult(null); setSyncing(true);
    try {
      const result = await api("/api/up/sync", {
        method: "POST",
        body: JSON.stringify({ entity_id: entity.id, since: since || undefined }),
      });
      setSyncResult(result);
      globalMutate((k: any) => typeof k === "string" && k.startsWith("/api/"));
    } catch (e: any) { setSyncErr(String(e.message || e)); }
    finally { setSyncing(false); }
  }

  async function linkAccount(upAccountId: string, localAccountId: number | "") {
    if (!localAccountId) return;
    await api("/api/up/link", {
      method: "POST",
      body: JSON.stringify({ account_id: localAccountId, up_account_id: upAccountId }),
    });
    mutateUp(); mutateLocal();
  }

  async function unlinkAccount(localAccountId: number) {
    await api(`/api/up/unlink/${localAccountId}`, { method: "POST" });
    mutateUp(); mutateLocal();
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#FF4B31]/20 flex items-center justify-center text-sm font-bold text-[#FF4B31]">
            UP
          </div>
          <div>
            <div className="font-medium text-sm">UP Banking</div>
            <div className="text-xs text-muted">{entity.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="text-xs px-2 py-0.5 rounded-full bg-good/15 text-good">Connected</span>
              <button className="btn text-sm" onClick={sync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <button className="text-xs text-muted hover:text-bad ml-1" onClick={disconnect}>Disconnect</button>
            </>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-muted">Not connected</span>
          )}
        </div>
      </div>

      {connected && (
        <div className="mt-3 space-y-3">
          {/* Live account balances */}
          {myLiveAccounts.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {myLiveAccounts.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-sm bg-surface-2 rounded-lg px-3 py-1.5">
                  <span className="text-good text-xs">●</span>
                  <span>{a.name}</span>
                  <span className="text-white font-medium">{money(a.balance_cents)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Account linking */}
          {upAccounts && upAccounts.length > 0 && (
            <div>
              <div className="stat-label mb-1.5">Link UP accounts</div>
              {upAccounts.map((ua: any) => {
                const linked = ua.linked_local_account_id;
                return (
                  <div key={ua.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                    <div className="flex-1 text-sm">
                      {ua.name}
                      <span className="text-xs text-muted ml-2">${ua.balance} {ua.type}</span>
                    </div>
                    {linked ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-good">
                          → {localAccounts?.find((a: any) => a.id === linked)?.name ?? `#${linked}`}
                        </span>
                        <button className="text-xs text-muted hover:text-bad" onClick={() => unlinkAccount(linked)}>unlink</button>
                      </div>
                    ) : (
                      <select
                        className="input text-xs w-44"
                        defaultValue=""
                        onChange={(e) => e.target.value && linkAccount(ua.id, Number(e.target.value))}
                      >
                        <option value="">Link to account…</option>
                        {(localAccounts || []).map((la: any) => (
                          <option key={la.id} value={la.id}>{la.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Sync options */}
          <div className="flex items-center gap-3 pt-1">
            <button
              className="text-xs text-muted hover:text-white"
              onClick={() => setShowSince(!showSince)}
            >
              {showSince ? "Hide options" : "Sync options"}
            </button>
            {showSince && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Sync from:</span>
                <input
                  type="date"
                  className="input text-xs py-1"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                />
              </div>
            )}
          </div>

          {syncResult && (
            <div className="text-xs text-good">
              Done — {syncResult.imported} imported, {syncResult.skipped} already synced
              {syncResult.pending > 0 && `, ${syncResult.pending} pending settlement`}.
            </div>
          )}
          {syncErr && <div className="text-xs text-bad">{syncErr}</div>}

          {/* Backfill transfers */}
          <div className="flex items-center gap-3 pt-1 border-t border-border">
            <button
              className="text-xs text-muted hover:text-white"
              onClick={backfillTransfers}
              disabled={backfilling}
            >
              {backfilling ? "Fixing…" : "Fix existing transfers"}
            </button>
            <span className="text-xs text-muted">— marks internal UP transfers so they don't count as income</span>
            {backfillResult && (
              <span className="text-xs text-good">{backfillResult.marked} transactions fixed</span>
            )}
          </div>
        </div>
      )}

      {!connected && (
        <div className="mt-3">
          <p className="text-xs text-muted mb-2">
            Get your token in the UP app: <b>Profile → Data Sharing → Personal Access Token</b>
          </p>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono text-xs"
              type="password"
              placeholder="up:yeah:..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect()}
            />
            <button className="btn" onClick={connect} disabled={loading}>
              {loading ? "Connecting…" : "Connect"}
            </button>
          </div>
          {tokenErr && <div className="text-bad text-xs mt-2">{tokenErr}</div>}
        </div>
      )}
    </div>
  );
}

// ── Manual account row ─────────────────────────────────────────────────────────
function ManualAccountRow({ account, entities, onUpdate }: { account: any; entities: any; onUpdate: () => void }) {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState(((account.balance_cents || 0) / 100).toFixed(2));
  const [name, setName] = useState(account.name);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const entityName = (entities || []).find((e: any) => e.id === account.entity_id)?.name ?? "";

  async function save() {
    setSaving(true);
    try {
      await api(`/api/accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          balance_cents: Math.round(parseFloat(balance || "0") * 100),
        }),
      });
      onUpdate();
      setEditing(false);
    } finally { setSaving(false); }
  }

  async function remove() {
    await api(`/api/accounts/${account.id}`, { method: "DELETE" });
    onUpdate();
  }

  const emoji = PRESETS.find((p) => p.name.toLowerCase() === account.name.toLowerCase())?.emoji ?? "🏦";

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-base flex-shrink-0">
          {emoji}
        </div>
        {editing ? (
          <input
            className="input text-sm flex-1 max-w-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <div className="flex-1">
            <div className="font-medium text-sm">{account.name}</div>
            <div className="text-xs text-muted">
              {TYPE_LABELS[account.type] ?? account.type} · {entityName}
            </div>
          </div>
        )}

        {editing ? (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-muted text-sm">$</span>
            <input
              className="input text-sm w-32 text-right"
              type="number"
              step="0.01"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              autoFocus
            />
            <button className="btn text-sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button className="btn-ghost text-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 ml-auto">
            <span className="font-medium tabular-nums">{money(account.balance_cents)}</span>
            <button
              className="btn-ghost text-xs"
              onClick={() => { setEditing(true); setBalance(((account.balance_cents || 0) / 100).toFixed(2)); }}
            >
              Update balance
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1 text-sm">
                <button className="text-bad font-medium text-xs" onClick={remove}>Remove</button>
                <button className="text-muted text-xs" onClick={() => setConfirmDelete(false)}>cancel</button>
              </span>
            ) : (
              <button className="text-muted hover:text-bad text-xs" onClick={() => setConfirmDelete(true)}>×</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
