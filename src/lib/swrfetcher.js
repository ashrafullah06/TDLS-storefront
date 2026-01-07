// src/lib/swrfetcher.js
export async function safeSWRFetcher(key) {
  try {
    const res = await fetch(key, { headers: { "Content-Type": "application/json" } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json;
  } catch {
    return null;
  }
}
