// lib/logistics/utils.js
export const must = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};

export async function http(url, opts = {}) {
  const res = await fetch(url, { ...opts, cache: "no-store" });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.errors?.join?.(", ") || res.statusText;
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return data ?? { ok: true };
}
