"use client";
import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher, api } from "@/lib/api";

interface Props {
  entity: any;
}

export function UpBanking({ entity }: Props) {
  const connected = !!entity.up_connected;

  const [token, setToken] = useState("");
  const [tokenErr, setTokenErr] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number; pending: number } | null>(null);
  const [syncErr, setSyncErr] = useState("");

  const [since, setSince] = useState("");

  // UP accounts (only fetched when connected)
  const { data: upAccounts, mutate: mutateUp } = useSWR(
    connected ? `/api/up/accounts/${entity.id}` : null,
    fetcher
  );

  // Local accounts for this entity (for linking)
  const { data: localAccounts, mutate: mutateLocal } = useSWR(
    `/api/accounts?entity_id=${entity.id}`,
    fetcher
  );

  async function connect() {
    setTokenErr("");
    if (!token.trim()) { setTokenErr("Paste your UP personal access token."); return; }
    setTokenLoading(true);
    try {
      await api("/api/up/connect", {
        method: "POST",
        body: JSON.stringify({ entity_id: entity.id, token: token.trim() }),
      });
      setToken("");
      globalMutate("/api/entities");
      mutateUp();
    } catch (e: any) {
      setTokenErr(String(e.message || e));
    } finally {
      setTokenLoading(false);
    }
  }

  async function disconnect() {
    await api(`/api/up/connect/${entity.id}`, { method: "DELETE" });
    globalMutate("/api/entities");
    mutateUp();
  }

  async function linkAccount(upAccountId: string, localAccountId: number | "") {
    if (!localAccountId) return;
    await api("/api/up/link", {
      method: "POST",
      body: JSON.stringify({ account_id: localAccountId, up_account_id: upAccountId }),
    });
    mutateUp();
    mutateLocal();
  }

  async function unlinkAccount(localAccountId: number) {
    await api(`/api/up/unlink/${localAccountId}`, { method: "POST" });
    mutateUp();
    mutateLocal();
  }

  async function sync() {
    setSyncErr("");
    setSyncResult(null);
    setSyncLoading(true);
    try {
      const result = await api("/api/up/sync", {
        method: "POST",
        body: JSON.stringify({ entity_id: entity.id, since: since || undefined }),
      });
      setSyncResult(result);
      globalMutate((key: string) => typeof key === "string" && key.startsWith("/api/transactions"));
    } catch (e: any) {
      setSyncErr(String(e.message || e));
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <div className="card mt-2 border-t border-dashed">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-medium text-sm">UP Banking</span>
        {connected
          ? <span className="text-xs px-2 py-0.5 rounded-full bg-good/20 text-good">Connected</span>
          : <span className="text-xs px-2 py-0.5 rounded-full bg-muted/20 text-muted">Not connected</span>}
      </div>

      {!connected ? (
        <div>
          <p className="text-xs text-muted mb-3">
            Generate a personal access token in the UP app under{" "}
            <b>Profile → Data Sharing → Personal Access Token</b>, then paste it below.
          </p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="stat-label mb-1">Personal access token</div>
              <input
                className="input font-mono text-xs"
                type="password"
                placeholder="up:yeah:..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <button className="btn" onClick={connect} disabled={tokenLoading}>
              {tokenLoading ? "Connecting…" : "Connect"}
            </button>
          </div>
          {tokenErr && <div className="text-bad text-xs mt-2">{tokenErr}</div>}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Account linking */}
          <div>
            <div className="stat-label mb-2">Link UP accounts to local accounts</div>
            {!upAccounts && <div className="text-muted text-xs">Loading UP accounts…</div>}
            {upAccounts?.length === 0 && <div className="text-muted text-xs">No UP accounts found.</div>}
            {upAccounts?.map((ua: any) => {
              const linked = ua.linked_local_account_id;
              return (
                <div key={ua.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{ua.name}</div>
                    <div className="text-xs text-muted">{ua.type} · ${ua.balance} {ua.currency}</div>
                  </div>
                  {linked ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-good">
                        → {localAccounts?.find((a: any) => a.id === linked)?.name ?? `Account #${linked}`}
                      </span>
                      <button
                        className="text-xs text-muted hover:text-bad"
                        onClick={() => unlinkAccount(linked)}
                      >
                        unlink
                      </button>
                    </div>
                  ) : (
                    <select
                      className="input text-xs w-48"
                      defaultValue=""
                      onChange={(e) => linkAccount(ua.id, e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Link to local account…</option>
                      {(localAccounts || []).map((la: any) => (
                        <option key={la.id} value={la.id}>{la.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sync */}
          <div>
            <div className="stat-label mb-2">Sync transactions</div>
            <div className="flex gap-2 items-end">
              <div>
                <div className="stat-label mb-1">Sync from date (optional)</div>
                <input
                  className="input text-sm"
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                />
              </div>
              <button className="btn" onClick={sync} disabled={syncLoading}>
                {syncLoading ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {syncResult && (
              <div className="text-xs text-good mt-2">
                Done — {syncResult.imported} imported, {syncResult.skipped} already synced
                {syncResult.pending > 0 && `, ${syncResult.pending} still pending settlement`}.
              </div>
            )}
            {syncErr && <div className="text-xs text-bad mt-2">{syncErr}</div>}
          </div>

          {/* Disconnect */}
          <div className="pt-1">
            <button className="text-xs text-muted hover:text-bad" onClick={disconnect}>
              Disconnect UP Banking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
