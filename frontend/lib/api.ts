export const fetcher = (url: string) => fetch(url).then((r) => r.json());

export async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const money = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString("en-AU", {
    style: "currency",
    currency: "AUD",
  });

export const moneyShort = (cents: number | null | undefined) =>
  "$" + ((cents ?? 0) / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });
