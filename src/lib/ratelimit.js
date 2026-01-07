// FILE: src/lib/ratelimit.js
// Fixed-window limiter using Upstash Redis REST when configured.
// Safe in-memory fallback for dev (per-process).

const URL = process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const HAS_UPSTASH = Boolean(URL && TOKEN);

const mem = new Map();

function nowMs() {
  return Date.now();
}

function memBucket(key, windowSec) {
  const now = nowMs();
  const ex = mem.get(key);
  if (ex && ex.resetAtMs > now) return ex;
  const fresh = { count: 0, resetAtMs: now + windowSec * 1000 };
  mem.set(key, fresh);
  return fresh;
}

async function upstashPost(path) {
  const res = await fetch(`${URL}${path.startsWith("/") ? "" : "/"}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("UPSTASH_ERROR");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * @param {object} args
 * @param {string} args.key
 * @param {number} args.limit
 * @param {number} args.windowSec
 * @returns {Promise<{ok:boolean, remaining:number, resetAtMs:number, provider:"upstash"|"memory"}>}
 */
export async function rateLimit({ key, limit, windowSec }) {
  const win = Math.max(1, Math.trunc(windowSec));
  const lim = Math.max(1, Math.trunc(limit));
  const now = nowMs();

  if (HAS_UPSTASH) {
    const incr = await upstashPost(`/incr/${encodeURIComponent(key)}`);
    const count = Number(incr?.result ?? 0);

    if (count === 1) {
      await upstashPost(`/expire/${encodeURIComponent(key)}/${win}`);
    }

    let ttlSec = win;
    try {
      const ttl = await upstashPost(`/ttl/${encodeURIComponent(key)}`);
      const t = Number(ttl?.result ?? win);
      if (Number.isFinite(t) && t > 0) ttlSec = t;
    } catch {
      // ignore TTL failures
    }

    return {
      ok: count <= lim,
      remaining: Math.max(0, lim - count),
      resetAtMs: now + ttlSec * 1000,
      provider: "upstash",
    };
  }

  const b = memBucket(key, win);
  b.count += 1;

  return {
    ok: b.count <= lim,
    remaining: Math.max(0, lim - b.count),
    resetAtMs: b.resetAtMs,
    provider: "memory",
  };
}

export function retryAfterSeconds(resetAtMs) {
  const s = Math.ceil(Math.max(0, resetAtMs - nowMs()) / 1000);
  return Math.max(1, s);
}
