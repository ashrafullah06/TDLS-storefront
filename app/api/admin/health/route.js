// FILE: app/api/admin/health/route.js
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------- tiny helpers (no external imports) ---------- */
const nowNs = () => Number(process.hrtime.bigint());
const msBetween = (start) => Math.round((nowNs() - start) / 1e6);

function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return "*".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function getBaseUrl(fallback) {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (env) return env;
  if (fallback) return String(fallback).trim().replace(/\/+$/, "");
  return "http://localhost:3000";
}

function json(body, status = 200) {
  return NextResponse.json(body ?? null, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow, noarchive",
      vary: "cookie, authorization",
      "x-tdlc-scope": "admin",
      "x-tdls-scope": "admin",
    },
  });
}

/* single place to fetch with timing + optional validator */
async function timeFetch(url, opts = {}, timeoutMs = 5000, validator) {
  const started = nowNs();
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, cache: "no-store" });
    clearTimeout(id);
    const ms = msBetween(started);
    const base = {
      status: res.status,
      ms,
      headers: Object.fromEntries([...res.headers.entries()].slice(0, 50)),
    };

    if (validator) {
      try {
        const verdict = await validator(res);
        if (verdict && typeof verdict.ok === "boolean") {
          return {
            ok: verdict.ok,
            error: verdict.ok ? null : verdict.error || null,
            diagnosis: verdict.diagnosis || null,
            ...base,
          };
        }
      } catch (e) {
        return {
          ok: false,
          status: res.status,
          ms,
          error: `validator: ${String(e?.message || e)}`,
          diagnosis: "Validator threw an error",
          headers: base.headers,
        };
      }
    }

    return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}`, diagnosis: null, ...base };
  } catch (err) {
    clearTimeout(id);
    return {
      ok: false,
      status: 0,
      ms: msBetween(started),
      error: String(err?.message || err),
      diagnosis: "Network/timeout",
      headers: {},
    };
  }
}

/* ---------- analytics helpers ---------- */
async function ga4DebugPing({ measurementId, apiSecret, timeoutMs = 5000 }) {
  if (!measurementId || !apiSecret) {
    return {
      ok: false,
      status: 0,
      ms: 0,
      error: "Missing GA4 config",
      diagnosis: "Set GA4_MEASUREMENT_ID & GA4_API_SECRET",
      skip: true,
    };
  }
  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(
    measurementId
  )}&api_secret=${encodeURIComponent(apiSecret)}`;
  const started = nowNs();
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "health.check.12345",
        events: [{ name: "health_ping", params: { engagement_time_msec: 1 } }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(id);
    const ms = msBetween(started);
    const j = await res.json().catch(() => ({}));
    const msgs = Array.isArray(j?.validationMessages) ? j.validationMessages : [];
    const ok = res.ok && msgs.length === 0;
    const error = ok ? null : `GA4 validation: ${JSON.stringify(msgs).slice(0, 400)}`;
    return {
      ok,
      status: res.status,
      ms,
      error,
      diagnosis: ok ? null : "GA4 debug endpoint reported validation issues",
    };
  } catch (err) {
    clearTimeout(id);
    return {
      ok: false,
      status: 0,
      ms: msBetween(started),
      error: String(err?.message || err),
      diagnosis: "Network/timeout to GA4 debug endpoint",
    };
  }
}

async function posthogPing({ host, apiKey, timeoutMs = 5000 }) {
  if (!host || !apiKey) {
    return {
      ok: false,
      status: 0,
      ms: 0,
      error: "Missing PostHog config",
      diagnosis: "Set POSTHOG_HOST & POSTHOG_KEY",
      skip: true,
    };
  }
  const base = host.replace(/\/+$/, "");
  const url = `${base}/capture/`;
  const started = nowNs();
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "health_ping",
        distinct_id: "healthcheck",
        properties: { health: true, ts: new Date().toISOString(), test_mode: true },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(id);
    const ms = msBetween(started);
    const ok = res.ok;
    const error = ok ? null : `HTTP ${res.status}`;
    return { ok, status: res.status, ms, error, diagnosis: ok ? null : "PostHog /capture returned non-2xx" };
  } catch (err) {
    clearTimeout(id);
    return {
      ok: false,
      status: 0,
      ms: msBetween(started),
      error: String(err?.message || err),
      diagnosis: "Network/timeout to PostHog",
    };
  }
}

/* ---------- DB stats for internal “website features” ---------- */
async function prismaStats() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    usersTotal,
    usersActive,
    products,
    variants,
    collections,
    categories,
    ordersTotal,
    orders24h,
    cartsActive,
    cartsConverted,
    wallets,
    loyaltyAccounts,
    shipments,
    financeWarningsOpen,
    notificationsQueued,
    appSettingsCount,
    webhookSubs,
    paymentSlipsPending,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.product.count(),
    prisma.productVariant.count(),
    prisma.collection.count(),
    prisma.category.count(),
    prisma.order.count(),
    prisma.order.count({ where: { createdAt: { gte: since24h } } }),
    prisma.cart.count({ where: { status: "ACTIVE" } }),
    prisma.cart.count({ where: { status: "CONVERTED" } }),
    prisma.wallet.count(),
    prisma.loyaltyAccount.count(),
    prisma.shipment.count(),
    prisma.financeWarning.count(),
    prisma.notification.count({ where: { status: "QUEUED" } }),
    prisma.appSetting.count(),
    prisma.webhookSubscription.count(),
    prisma.paymentSlip.count({ where: { status: "PAID_NEEDS_ORDER" } }),
  ]);

  const latestOrder = await prisma.order.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      fulfillmentStatus: true,
      createdAt: true,
      grandTotal: true,
    },
  });

  return {
    counts: {
      users: { total: usersTotal, active: usersActive },
      catalog: { products, variants, collections, categories },
      orders: { total: ordersTotal, last24h: orders24h },
      carts: { active: cartsActive, converted: cartsConverted },
      wallet: { wallets },
      loyalty: { accounts: loyaltyAccounts },
      logistics: { shipments },
      notifications: { queued: notificationsQueued },
      config: { appSettings: appSettingsCount, webhookSubscriptions: webhookSubs },
      payments: { slipsNeedingOrder: paymentSlipsPending },
      finance: { warningsOpen: financeWarningsOpen },
    },
    latestOrder,
  };
}

function expect404Validator(label) {
  return async (res) => {
    const ok = res.status === 404;
    return {
      ok,
      diagnosis: ok ? null : `Expected 404 for ${label}, got HTTP ${res.status}`,
      error: ok ? null : `PUBLIC_HEALTH_EXPOSED (${label})`,
    };
  };
}

/* ---------- main handler (RBAC-gated, non-discoverable) ---------- */
export async function GET(req) {
  // Admin-only diagnostics. Non-admin gets 404 to conceal existence.
  try {
    await requireAdmin(req, { permission: Permissions.VIEW_HEALTH });
  } catch {
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }

  const urlIn = new URL(req.url);
  const onlyParam = urlIn.searchParams.get("only");
  const excludeParam = urlIn.searchParams.get("exclude");
  const verbose = urlIn.searchParams.get("verbose") === "1";

  const { headers } = req;
  const cookie = headers.get("cookie") || "";

  const host = headers.get("x-forwarded-host") || headers.get("host") || "localhost:3000";
  const proto = headers.get("x-forwarded-proto") || "http";
  const derived = `${proto}://${host}`;
  const baseUrl = getBaseUrl(derived);

  const NODE_ENV = process.env.NODE_ENV || "development";
  const STRAPI_URL = (process.env.STRAPI_URL || "").replace(/\/+$/, "");
  const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || "";

  // Feature flags / config
  const SMTP_HEALTH_URL = process.env.SMTP_HEALTH_URL || "";
  const PAYMENT_HEALTH_URL = process.env.PAYMENT_HEALTH_URL || "";
  const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || "";
  const GA4_API_SECRET = process.env.GA4_API_SECRET || "";
  const HEALTH_ENABLE_POSTHOG = process.env.HEALTH_ENABLE_POSTHOG === "1";
  const POSTHOG_HOST = process.env.POSTHOG_HOST || "";
  const POSTHOG_KEY = process.env.POSTHOG_KEY || "";

  const CORS_ORIGIN = process.env.CORS_ORIGIN || baseUrl;
  const CORS_METHODS_REQUIRED = (process.env.CORS_METHODS_REQUIRED || "GET,POST,OPTIONS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const CORS_HEADERS_REQUIRED = (process.env.CORS_HEADERS_REQUIRED || "Content-Type,Authorization")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const CDN_ASSET_URL = process.env.CDN_ASSET_URL || "";
  const STRAPI_HEALTH_URL = process.env.STRAPI_HEALTH_URL || "";
  const QUEUE_HEALTH_URL = process.env.QUEUE_HEALTH_URL || "";
  const THIRDPARTY_STATUS_URLS = (process.env.THIRDPARTY_STATUS_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // DNS/TLS/Checkout
  const DNS_PROBE_URL = process.env.DNS_PROBE_URL || "";
  const TLS_STATUS_URL = process.env.TLS_STATUS_URL || "";
  const CHECKOUT_SANDBOX_URL = process.env.CHECKOUT_SANDBOX_URL || "";

  // Prisma stats (filled later)
  let stats = null;
  let statsError = null;

  const checks = [];
  const add = (key, desc, run, { required = false } = {}) => checks.push({ key, desc, run, required });

  // ✅ Admin-plane session endpoint check (admin-only API namespace)
  add(
    "admin_session",
    "Admin session endpoint (/api/admin/session)",
    () =>
      timeFetch(
        `${baseUrl}/api/admin/session`,
        { method: "GET", headers: cookie ? { cookie } : {} },
        3500,
        async (res) => {
          let ok = res.ok;
          let diagnosis = null;
          if (!ok) return { ok: false, diagnosis: `HTTP ${res.status}`, error: `HTTP ${res.status}` };
          const j = await res.json().catch(() => null);
          const has = !!(j?.user || j?.admin || j?.ok);
          if (!has) {
            ok = false;
            diagnosis = "Session payload missing expected keys";
          }
          return { ok, diagnosis, error: ok ? null : "Admin session malformed" };
        }
      ),
    { required: false }
  );

  // ✅ Enforce: public health endpoints must NOT exist / must be hidden
  add("public_health_hidden", "Public health surface is not exposed (/api/health)", () =>
    timeFetch(`${baseUrl}/api/health`, { method: "GET" }, 2500, expect404Validator("/api/health"))
  );
  add("public_health_prisma_hidden", "Public /api/health/prisma is not exposed", () =>
    timeFetch(`${baseUrl}/api/health/prisma`, { method: "GET" }, 2500, expect404Validator("/api/health/prisma"))
  );
  add("public_health_cms_hidden", "Public /api/health/cms is not exposed", () =>
    timeFetch(`${baseUrl}/api/health/cms`, { method: "GET" }, 2500, expect404Validator("/api/health/cms"))
  );
  add("public_health_summary_hidden", "Public /api/health/summary is not exposed", () =>
    timeFetch(`${baseUrl}/api/health/summary`, { method: "GET" }, 2500, expect404Validator("/api/health/summary"))
  );
  add("public_health_queue_hidden", "Public /api/health/queue is not exposed", () =>
    timeFetch(`${baseUrl}/api/health/queue`, { method: "GET" }, 2500, expect404Validator("/api/health/queue"))
  );

  // Strapi (direct checks here; do NOT depend on public /api/health/cms)
  if (STRAPI_URL) {
    const auth = STRAPI_API_TOKEN ? { Authorization: `Bearer ${STRAPI_API_TOKEN}` } : undefined;
    add("strapi_root", `Reach ${STRAPI_URL}`, () => timeFetch(STRAPI_URL, { headers: auth }), { required: true });
    add("strapi_products", "Fetch products (1)", () =>
      timeFetch(`${STRAPI_URL}/api/products?pagination[pageSize]=1`, { headers: auth })
    );
    add("strapi_collections", "Fetch collections (1)", () =>
      timeFetch(`${STRAPI_URL}/api/collections?pagination[pageSize]=1`, { headers: auth })
    );
    add("strapi_posts", "Fetch posts (1)", () =>
      timeFetch(`${STRAPI_URL}/api/posts?pagination[pageSize]=1`, { headers: auth })
    );
  }

  // SMTP
  if (SMTP_HEALTH_URL) {
    add("smtp", "SMTP service health", () =>
      timeFetch(SMTP_HEALTH_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          const flag = body?.ok === true || /^(ok|up|operational)$/i.test(String(body?.status || ""));
          ok = ok && flag;
          if (!ok) diagnosis = `SMTP body not OK (${JSON.stringify({ status: body?.status, ok: body?.ok })})`;
        } catch {
          if (!ok) diagnosis = `HTTP ${res.status} and non-JSON response`;
        }
        return { ok, diagnosis, error: ok ? null : `SMTP health failed (HTTP ${res.status})` };
      })
    );
  }

  // Payment health
  if (PAYMENT_HEALTH_URL) {
    add("payment", "Payment gateway health", () =>
      timeFetch(PAYMENT_HEALTH_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          const flag = body?.ok === true || /^(ok|up|operational)$/i.test(String(body?.status || body?.overall || ""));
          ok = ok && flag;
          if (!ok) diagnosis = `Payment body not OK (${JSON.stringify({ status: body?.status, overall: body?.overall, ok: body?.ok })})`;
        } catch {
          if (!ok) diagnosis = `HTTP ${res.status} and non-JSON response`;
        }
        return { ok, diagnosis, error: ok ? null : `Payment health failed (HTTP ${res.status})` };
      })
    );
  }

  // SEO probes (public pages are fine to probe; results stay admin-only)
  for (const ep of [
    { key: "robots", url: `${baseUrl}/robots.txt`, desc: "Fetch robots.txt" },
    { key: "sitemap_index", url: `${baseUrl}/sitemap.xml`, desc: "Fetch sitemap index" },
    { key: "sitemap_products", url: `${baseUrl}/sitemap-products.xml`, desc: "Fetch products sitemap" },
    { key: "sitemap_collections", url: `${baseUrl}/sitemap-collections.xml`, desc: "Fetch collections sitemap" },
    { key: "sitemap_blog", url: `${baseUrl}/sitemap-blog.xml`, desc: "Fetch blog sitemap" },
    { key: "sitemap_server", url: `${baseUrl}/server-sitemap.xml`, desc: "Fetch server sitemap" },
  ]) {
    checks.push({ key: ep.key, desc: ep.desc, run: () => timeFetch(ep.url) });
  }

  // Site basics
  add("home", "Fetch homepage", () => timeFetch(baseUrl));
  add("favicon", "Fetch favicon.ico", () => timeFetch(`${baseUrl}/favicon.ico`));

  // CORS preflight to Strapi
  if (STRAPI_URL) {
    add(
      "strapi_cors_preflight",
      "Strapi CORS preflight (OPTIONS)",
      () =>
        timeFetch(
          `${STRAPI_URL}/api/products?pagination[pageSize]=1`,
          {
            method: "OPTIONS",
            headers: {
              Origin: CORS_ORIGIN,
              "Access-Control-Request-Method": "GET",
              "Access-Control-Request-Headers": CORS_HEADERS_REQUIRED.join(", "),
            },
          },
          5000,
          async (res) => {
            const allowOrigin = res.headers.get("access-control-allow-origin") || "";
            const allowMethods = (res.headers.get("access-control-allow-methods") || "")
              .split(",")
              .map((s) => s.trim().toUpperCase());
            const allowHeaders = (res.headers.get("access-control-allow-headers") || "")
              .split(",")
              .map((s) => s.trim().toLowerCase());

            const originOk = allowOrigin === "*" || allowOrigin === CORS_ORIGIN;
            const methodsOk = CORS_METHODS_REQUIRED.every((m) => allowMethods.includes(m.toUpperCase()));
            const headersOk = CORS_HEADERS_REQUIRED.every((h) => allowHeaders.includes(h.toLowerCase()));

            const ok = (res.status === 204 || res.status === 200) && originOk && methodsOk && headersOk;

            let diagnosis = null;
            if (!ok) {
              const miss = [];
              if (!(res.status === 204 || res.status === 200)) miss.push(`unexpected status ${res.status}`);
              if (!originOk) miss.push(`allow-origin "${allowOrigin}"`);
              if (!methodsOk) miss.push(`allow-methods missing [${CORS_METHODS_REQUIRED.join(", ")}]`);
              if (!headersOk) miss.push(`allow-headers missing [${CORS_HEADERS_REQUIRED.join(", ")}]`);
              diagnosis = `CORS mismatch: ${miss.join("; ")}`;
            }
            return { ok, diagnosis, error: ok ? null : "CORS headers not satisfied" };
          }
        )
    );
  }

  // CDN asset
  if (CDN_ASSET_URL) {
    add("cdn", "CDN asset fetch", () =>
      timeFetch(CDN_ASSET_URL, { method: "GET" }, 7000, async (res) => {
        const ok = res.ok;
        const ct = res.headers.get("content-type") || "";
        const diagnosis = ok ? null : `CDN returned HTTP ${res.status}`;
        return { ok, diagnosis, error: ok ? null : `HTTP ${res.status} (${ct})` };
      })
    );
  }

  // Strapi DB health (if you have STRAPI_HEALTH_URL)
  if (STRAPI_HEALTH_URL) {
    add("db", "Strapi DB health", () =>
      timeFetch(STRAPI_HEALTH_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          if (typeof body?.db_ok === "boolean") ok = ok && body.db_ok;
          if (!ok && body?.reason) diagnosis = `DB reported: ${body.reason}`;
        } catch {
          /* ignore */
        }
        return { ok, diagnosis, error: ok ? null : `Health endpoint HTTP ${res.status}` };
      })
    );
  }

  // Queue/worker health (external worker endpoint)
  if (QUEUE_HEALTH_URL) {
    add("queue", "Queue/worker health", () =>
      timeFetch(QUEUE_HEALTH_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          if (typeof body?.workers_up === "number") {
            ok = ok && body.workers_up > 0;
            if (!ok) diagnosis = `workers_up=${body.workers_up}`;
          }
          if (typeof body?.queues_ok === "boolean" && !body.queues_ok) {
            ok = false;
            diagnosis = diagnosis ? `${diagnosis}; queues_ok=false` : "queues_ok=false";
          }
        } catch {
          /* ignore */
        }
        return { ok, diagnosis, error: ok ? null : `Queue endpoint HTTP ${res.status}` };
      })
    );
  }

  // Vendors
  const vendors = THIRDPARTY_STATUS_URLS;
  if (vendors.length) {
    vendors.forEach((u, i) => {
      add(`vendor_${i + 1}`, `Vendor status: ${u}`, () =>
        timeFetch(u, { method: "GET" }, 5000, async (res) => {
          let ok = res.ok,
            diagnosis = null;
          try {
            const body = await res.json();
            const flag = body?.ok === true || /^(ok|up|operational)$/i.test(String(body?.status || body?.overall || ""));
            ok = ok && flag;
            if (!ok) diagnosis = `Body status not OK (${JSON.stringify({ status: body?.status, overall: body?.overall, ok: body?.ok })})`;
          } catch {
            if (!ok) diagnosis = `HTTP ${res.status} and non-JSON response`;
          }
          return { ok, diagnosis, error: ok ? null : `Vendor status not OK (HTTP ${res.status})` };
        })
      );
    });
  }

  // GA4 & PostHog
  if (GA4_MEASUREMENT_ID && GA4_API_SECRET)
    add("ga4_debug", "GA4 Measurement Protocol (debug)", () =>
      ga4DebugPing({ measurementId: GA4_MEASUREMENT_ID, apiSecret: GA4_API_SECRET })
    );
  if (HEALTH_ENABLE_POSTHOG && POSTHOG_HOST && POSTHOG_KEY)
    add("posthog", "PostHog capture endpoint", () => posthogPing({ host: POSTHOG_HOST, apiKey: POSTHOG_KEY }));

  // DNS
  if (DNS_PROBE_URL) {
    add("dns", "DNS resolution probe", () =>
      timeFetch(DNS_PROBE_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          ok = ok && body?.ok === true;
          if (!ok) diagnosis = body?.error ? `Resolver: ${body.error}` : "Resolver did not return ok=true";
        } catch {
          /* ignore */
        }
        return { ok, diagnosis, error: ok ? null : `DNS probe HTTP ${res.status}` };
      })
    );
  }

  // TLS
  if (TLS_STATUS_URL) {
    add("tls", "TLS certificate status", () =>
      timeFetch(TLS_STATUS_URL, { method: "GET" }, 5000, async (res) => {
        let ok = res.ok,
          diagnosis = null;
        try {
          const body = await res.json();
          const days = Number(body?.days_left ?? NaN);
          if (Number.isFinite(days)) {
            if (days < 0) {
              ok = false;
              diagnosis = `Certificate expired ${Math.abs(days)}d ago`;
            } else if (days < 7) {
              ok = false;
              diagnosis = `Expires in ${days}d (<7d)`;
            } else if (days < 30) {
              diagnosis = `Expires in ${days}d (<30d)`;
            }
          } else {
            ok = false;
            diagnosis = "No days_left provided";
          }
        } catch {
          ok = false;
          diagnosis = "Invalid TLS status payload";
        }
        return { ok, diagnosis, error: ok ? null : `TLS status not OK (HTTP ${res.status})` };
      })
    );
  }

  // Synthetic checkout
  if (CHECKOUT_SANDBOX_URL) {
    add("checkout", "Synthetic checkout (sandbox)", () =>
      timeFetch(
        CHECKOUT_SANDBOX_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        },
        10000,
        async (res) => {
          let ok = res.ok,
            diagnosis = null;
          try {
            const body = await res.json();
            const flag = body?.ok === true || /^ok$/i.test(String(body?.status || ""));
            ok = ok && flag;
            if (!ok) diagnosis = `Synthetic result not OK (${JSON.stringify({ ok: body?.ok, status: body?.status })})`;
          } catch {
            if (!ok) diagnosis = `HTTP ${res.status} and non-JSON response`;
          }
          return { ok, diagnosis, error: ok ? null : `Synthetic checkout failed (HTTP ${res.status})` };
        }
      )
    );
  }

  // Filtering
  const onlySet = new Set((onlyParam || "").split(",").map((s) => s.trim()).filter(Boolean));
  const excludeSet = new Set((excludeParam || "").split(",").map((s) => s.trim()).filter(Boolean));
  const filteredChecks = checks.filter((c) => (onlySet.size ? onlySet.has(c.key) : true) && !excludeSet.has(c.key));

  // Run HTTP/integration checks
  const runResults = {};
  await Promise.all(
    filteredChecks.map(async (c) => {
      const out = await c.run();
      runResults[c.key] = { ...(out || {}), desc: c.desc };
      if (typeof runResults[c.key].ok !== "boolean") runResults[c.key].ok = false;
      if (runResults[c.key].error && String(runResults[c.key].error).length > 500) {
        runResults[c.key].error = String(runResults[c.key].error).slice(0, 500);
      }
    })
  );

  // Run Prisma-level stats (website feature health)
  try {
    stats = await prismaStats();
  } catch (err) {
    statsError = String(err?.message || err);
  }

  // Overall status (required checks only)
  const critical = filteredChecks
    .filter((c) => c.required)
    .filter((c) => !runResults[c.key]?.ok)
    .map((c) => c.key);
  const status = critical.length ? "degraded" : "ok";

  // Suggestions
  const suggestions = [];
  if (!STRAPI_URL) suggestions.push("Set STRAPI_URL in your environment.");
  if (!STRAPI_API_TOKEN) suggestions.push("Set STRAPI_API_TOKEN (read-only token is enough).");

  // If any public health endpoints are exposed, it must be fixed
  for (const k of [
    "public_health_hidden",
    "public_health_prisma_hidden",
    "public_health_cms_hidden",
    "public_health_summary_hidden",
    "public_health_queue_hidden",
  ]) {
    if (runResults[k] && !runResults[k].ok) {
      suggestions.push(`Public health endpoint is exposed: ${runResults[k].desc}. Remove it or force 404.`);
    }
  }

  if (runResults.strapi_root && !runResults.strapi_root.ok)
    suggestions.push("Cannot reach Strapi — confirm STRAPI_URL, CORS, and server status.");
  if (runResults.strapi_cors_preflight && !runResults.strapi_cors_preflight.ok)
    suggestions.push("CORS preflight failed — update Strapi CORS or proxy.");

  const version = {
    app: process.env.NEXT_PUBLIC_APP_VERSION || null,
    commit: process.env.NEXT_PUBLIC_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    build: process.env.NEXT_BUILD_ID || process.env.VERCEL_BUILD_ID || null,
    region: process.env.VERCEL_REGION || process.env.FLY_REGION || process.env.NEXT_RUNTIME || null,
  };

  const features = {
    env: { nodeEnv: NODE_ENV, baseUrl },
    cms: { strapiEnabled: Boolean(STRAPI_URL) },
    monitoring: {
      prismaStats: !statsError,
      checksRegistered: checks.length,
      checksReturned: Object.keys(runResults).length,
    },
  };

  const payload = {
    ok: true,
    status,
    timestamp: new Date().toISOString(),
    env: {
      node_env: NODE_ENV,
      next_public_site_url: baseUrl,
      strapi_url: STRAPI_URL || null,
      strapi_token_set: Boolean(STRAPI_API_TOKEN),
      strapi_token_preview: mask(STRAPI_API_TOKEN),
      node_version: process.version,
    },
    version,
    features,
    checks: runResults,
    stats,
    suggestions,
  };

  if (!verbose) {
    for (const k of Object.keys(payload.checks)) delete payload.checks[k]?.headers;
  }

  return json(payload, 200);
}
