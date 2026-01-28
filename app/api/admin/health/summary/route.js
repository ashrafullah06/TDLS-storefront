// FILE: app/api/admin/health/summary/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { Permissions } from "@/lib/rbac";
import * as net from "node:net";
import * as tls from "node:tls";

/* ------------------------------ response utils ------------------------------ */

function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      Vary: "Cookie, Authorization",
      "x-tdlc-scope": "admin",
      ...extraHeaders,
    },
  });
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function normPerm(p) {
  return String(p || "").trim().toLowerCase();
}

/* ------------------------- admin session (single SSoT) ------------------------ */

function computeOrigin(req) {
  try {
    return new URL(req.url).origin;
  } catch {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host =
      req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    return host ? `${proto}://${host}` : "";
  }
}

/**
 * ✅ Admin auth MUST come from /api/admin/session only (your rule).
 * We forward cookies/authorization so OTP-cookie fallback in that endpoint works.
 */
async function getAdminSessionViaApi(req) {
  const origin = computeOrigin(req);
  const cookie = req.headers.get("cookie") || "";
  const authorization = req.headers.get("authorization") || "";

  const url = `${origin}/api/admin/session?include=roles,permissions,capabilities,policy`;

  const r = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      cookie,
      ...(authorization ? { authorization } : {}),
      "x-tdlc-scope": "admin",
      "x-tdlc-internal": "1",
    },
  });

  const txt = await r.text();
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

function extractActor(sessionJson) {
  const user = sessionJson?.user || null;
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const primaryRole =
    user?.primaryRole || (roles.length ? String(roles[0] || "") : null) || null;

  return {
    id: user?.id || sessionJson?.session?.userId || null,
    email: user?.email ?? null,
    primaryRole,
    roles,
  };
}

function hasPermission(sessionJson, permissionNeed) {
  const need = normPerm(permissionNeed);

  // superadmin shortcut (based on /api/admin/session capabilities)
  if (sessionJson?.capabilities?.isSuperadmin) return true;

  const perms =
    (Array.isArray(sessionJson?.permissions) && sessionJson.permissions) ||
    (Array.isArray(sessionJson?.user?.permissions) && sessionJson.user.permissions) ||
    [];

  if (!Array.isArray(perms)) return false;
  const set = new Set(perms.map(normPerm));
  return set.has(need);
}

/* ------------------------------ timing helpers ------------------------------ */

function classifyFromOk(ok) {
  return ok ? "ok" : "error";
}

async function timed(fn) {
  const start = Date.now();
  try {
    const data = await fn();
    return { ok: true, status: "ok", ms: Date.now() - start, ...data };
  } catch (e) {
    return {
      ok: false,
      status: "error",
      ms: Date.now() - start,
      error: String(e?.message || e),
    };
  }
}

function unavailable(desc, reason = "not_configured") {
  return { ok: false, status: "unavailable", ms: 0, desc, reason };
}

function warn(desc, data = {}) {
  return { ok: true, status: "warn", ms: 0, desc, ...data };
}

/* ---------------------------- optional integrations --------------------------- */

async function loadQueueModule() {
  try {
    const mod = await import("@/lib/queue");
    return mod?.default || mod;
  } catch {
    return null;
  }
}

function coerceQueueShape(q, fallbackLabel) {
  const name = String(q?.name || "").trim() || "default";
  const label = String(q?.label || "").trim() || fallbackLabel || name;

  const depth =
    typeof q?.depth === "number"
      ? q.depth
      : typeof q?.size === "number"
      ? q.size
      : 0;

  return {
    name,
    label,
    depth,
    delayed: typeof q?.delayed === "number" ? q.delayed : 0,
    failed:
      typeof q?.failed === "number"
        ? q.failed
        : typeof q?.failedCount === "number"
        ? q.failedCount
        : 0,
    paused: !!q?.paused,
    concurrency: typeof q?.concurrency === "number" ? q.concurrency : null,
    lastRunAt: q?.lastRunAt ? new Date(q.lastRunAt).toISOString() : null,
  };
}

function buildSimulatedQueues() {
  return [
    {
      name: "default",
      label: "Default",
      depth: 0,
      delayed: 0,
      failed: 0,
      paused: false,
      concurrency: 4,
      lastRunAt: null,
    },
    {
      name: "email",
      label: "Email / Notifications",
      depth: 0,
      delayed: 0,
      failed: 0,
      paused: false,
      concurrency: 2,
      lastRunAt: null,
    },
  ];
}

function envUrl(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

async function httpProbe(url, { method = "GET", timeoutMs = 1500 } = {}) {
  const u = String(url || "").trim();
  if (!u) return { ok: false, status: "unavailable", reason: "not_configured" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(250, timeoutMs));

  const start = Date.now();
  try {
    const r = await fetch(u, {
      method,
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
    });

    const ms = Date.now() - start;

    // Reachability: if we got a response at all, infra is reachable.
    // 2xx/3xx is "ok"; 4xx is "warn" (reachable but blocked); 5xx is "degraded/error" (server trouble).
    const code = r.status;
    if (code >= 200 && code < 400) {
      return { ok: true, status: "ok", ms, code };
    }
    if (code >= 400 && code < 500) {
      return { ok: true, status: "warn", ms, code, desc: "Reachable but access restricted" };
    }
    return { ok: false, status: "degraded", ms, code, desc: "Server error response" };
  } catch (e) {
    const ms = Date.now() - start;
    return { ok: false, status: "error", ms, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function tcpProbe({ host, port, tlsMode = false, timeoutMs = 1200, write = null, expectIncludes = null }) {
  const h = String(host || "").trim();
  const p = Number(port);
  if (!h || !Number.isFinite(p) || p <= 0) {
    return { ok: false, status: "unavailable", ms: 0, reason: "not_configured" };
  }

  const start = Date.now();

  return await new Promise((resolve) => {
    let done = false;
    let dataBuf = "";

    const finish = (res) => {
      if (done) return;
      done = true;
      resolve({ ms: Date.now() - start, ...res });
    };

    const onData = (chunk) => {
      dataBuf += chunk?.toString?.("utf8") || "";
      if (expectIncludes && dataBuf.includes(expectIncludes)) {
        finish({ ok: true, status: "ok", banner: dataBuf.slice(0, 300) });
        try { sock.end(); } catch {}
      }
    };

    const onErr = (err) => finish({ ok: false, status: "error", error: String(err?.message || err) });

    const sock = tlsMode
      ? tls.connect({ host: h, port: p, servername: h }, () => {
          if (write) {
            try { sock.write(write); } catch {}
          }
        })
      : net.createConnection({ host: h, port: p }, () => {
          if (write) {
            try { sock.write(write); } catch {}
          }
        });

    sock.setTimeout(Math.max(250, timeoutMs));

    sock.on("data", onData);
    sock.on("error", onErr);
    sock.on("timeout", () => finish({ ok: false, status: "degraded", desc: "timeout" }));
    sock.on("end", () => {
      if (!done) {
        if (expectIncludes) {
          finish({ ok: false, status: "degraded", desc: "connection ended before expected response", banner: dataBuf.slice(0, 300) });
        } else {
          finish({ ok: true, status: "ok", banner: dataBuf.slice(0, 300) });
        }
      }
    });

    // If we don't expect a specific response, treat connect as success after small delay.
    if (!expectIncludes) {
      setTimeout(() => {
        if (!done) finish({ ok: true, status: "ok", banner: dataBuf.slice(0, 300) });
        try { sock.end(); } catch {}
      }, 200);
    }
  });
}

function parseRedisUrl(u) {
  const s = String(u || "").trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    const tlsMode = url.protocol === "rediss:";
    const host = url.hostname;
    const port = Number(url.port || (tlsMode ? 6380 : 6379));
    return { tlsMode, host, port };
  } catch {
    return null;
  }
}

/* ---------------------------------- route ---------------------------------- */

export async function GET(req) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  // ✅ Admin session only (no customer auth)
  const sess = await getAdminSessionViaApi(req).catch(() => null);
  const scope = String(sess?.data?.session?.scope || sess?.data?.user?.scope || "admin").toLowerCase();
  const authenticated = !!sess?.data?.authenticated;

  if (!authenticated || scope !== "admin") {
    return json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        requestId,
        authenticated: false,
        isolation: {
          scopeExpected: "admin",
          scopeReceived: scope || null,
          note: "This endpoint accepts ONLY admin session validated by /api/admin/session.",
        },
      },
      401,
      { "x-request-id": requestId }
    );
  }

  // Permission gate: VIEW_HEALTH
  const needPerm = Permissions.VIEW_HEALTH;
  if (!hasPermission(sess.data, needPerm)) {
    return json(
      { ok: false, error: "FORBIDDEN", requestId, required: String(needPerm) },
      403,
      { "x-request-id": requestId }
    );
  }

  const actor = extractActor(sess.data);

  // Version / environment (no secrets)
  const version = {
    app: process.env.APP_NAME || "tdlc",
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      "local-dev",
    region:
      process.env.VERCEL_REGION ||
      process.env.FLY_REGION ||
      process.env.AWS_REGION ||
      "local",
    node: process.version,
    runtime: process.env.NEXT_RUNTIME || "nodejs",
  };

  // Checks
  const checks = {};

  // DB connectivity
  checks.db = await timed(async () => {
    const r = await prisma.$queryRaw`SELECT 1 as ok`;
    const ok =
      Array.isArray(r) && r.length
        ? r[0]?.ok === 1 || r[0]?.ok === "1"
        : !!r;
    if (!ok) throw new Error("db round-trip failed");
    return { desc: "Database reachable" };
  });

  // Payment providers (from DB)
  checks.providers = await timed(async () => {
    const providers = await prisma.gatewayFeeRate.findMany({
      distinct: ["provider"],
      select: { provider: true },
    });
    const codes = providers.map((p) => p.provider).filter(Boolean);
    return {
      desc: `Found ${codes.length} configured payment providers`,
      providers: codes,
      count: codes.length,
    };
  });

  // Shipments count
  checks.shipments = await timed(async () => {
    const total = await prisma.shipment.count();
    return { desc: `${total} shipments in system`, total };
  });

  // Orders (last 30 days)
  checks.orders_30d = await timed(async () => {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [count, agg] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: since } } }),
      prisma.order.aggregate({
        where: {
          createdAt: { gte: since },
          paymentStatus: { in: ["PAID", "SETTLED"] },
        },
        _sum: { grandTotal: true },
      }),
    ]);
    const revenue = Number(agg?._sum?.grandTotal ?? 0);
    return {
      desc: `${count} orders; revenue ${revenue.toFixed(2)} in last 30d`,
      count,
      revenue,
      since: since.toISOString(),
    };
  });

  // Inventory aggregate (safe if model exists; otherwise becomes an error check)
  checks.inventory = await timed(async () => {
    const model = prisma?.inventoryItem;
    if (!model || typeof model.aggregate !== "function") {
      // Not configured in this project/schema
      return warn("Inventory model not available in Prisma schema", {
        reason: "model_missing",
      });
    }

    const agg = await model.aggregate({
      _count: { _all: true },
      _sum: { onHand: true, reserved: true, safetyStock: true },
    });

    const count = Number(agg?._count?._all ?? 0);
    const onHand = Number(agg?._sum?.onHand ?? 0);
    const reserved = Number(agg?._sum?.reserved ?? 0);
    const safety = Number(agg?._sum?.safetyStock ?? 0);

    return {
      desc: `Inventory aggregates computed for ${count} items`,
      count,
      onHand,
      reserved,
      safety,
    };
  });

  // Queue (optional module)
  checks.queue = await timed(async () => {
    const qmod = await loadQueueModule();
    if (!qmod) {
      const queues = buildSimulatedQueues();
      const totalDepth = queues.reduce((a, q) => a + (q.depth || 0), 0);
      const totalFailed = queues.reduce((a, q) => a + (q.failed || 0), 0);
      return {
        status: "unavailable",
        ok: false,
        desc: "Queue module not configured",
        mode: "simulated",
        queues,
        totals: { queues: queues.length, depth: totalDepth, failed: totalFailed },
      };
    }

    let mode = "real";
    let queues = [];

    if (typeof qmod.snapshot === "function") {
      const snap = await qmod.snapshot();
      const list = Array.isArray(snap?.queues) ? snap.queues : [];
      queues = list.map((qq) => coerceQueueShape(qq, qq?.label || qq?.name));
      mode = String(snap?.mode || "real");
    } else if (typeof qmod.listQueues === "function") {
      const listed = await qmod.listQueues();
      const names =
        Array.isArray(listed) && listed.length
          ? typeof listed[0] === "string"
            ? listed.map((x) => String(x))
            : listed.map((x) => String(x?.name || "")).filter(Boolean)
          : [];
      queues = names.map((name) => coerceQueueShape({ name }, name));
      mode = "real";
    } else {
      queues = buildSimulatedQueues();
      mode = "simulated";
    }

    const totals = {
      queues: queues.length,
      depth: queues.reduce((a, q) => a + (q.depth || 0), 0),
      delayed: queues.reduce((a, q) => a + (q.delayed || 0), 0),
      failed: queues.reduce((a, q) => a + (q.failed || 0), 0),
      paused: queues.filter((q) => !!q.paused).length,
    };

    return {
      desc: `Queue snapshot (${mode})`,
      mode,
      queues,
      totals,
    };
  });

  // CMS reachability (optional)
  const cmsUrl = envUrl("STRAPI_URL", "NEXT_PUBLIC_STRAPI_URL", "TDLS_CMS_URL", "CMS_BASE_URL");
  if (!cmsUrl) {
    checks.cms = unavailable("CMS URL not configured", "not_configured");
  } else {
    // Prefer a cheap probe. If your Strapi exposes /_health or /admin, you can change this URL safely.
    const target = cmsUrl.replace(/\/+$/, "") + "/";
    const probe = await httpProbe(target, { method: "GET", timeoutMs: 1500 });
    checks.cms = {
      ...probe,
      desc: `CMS HTTP probe (${target})`,
      url: target,
    };
  }

  // Media / R2 reachability (optional, public edge)
  const mediaUrl = envUrl(
    "NEXT_PUBLIC_MEDIA_BASE_URL",
    "MEDIA_BASE_URL",
    "R2_PUBLIC_BASE_URL",
    "TDLS_MEDIA_URL"
  );
  if (!mediaUrl) {
    checks.media = unavailable("Media base URL not configured", "not_configured");
  } else {
    const target = mediaUrl.replace(/\/+$/, "") + "/";
    const probe = await httpProbe(target, { method: "HEAD", timeoutMs: 1500 });
    checks.media = {
      ...probe,
      desc: `Media HTTP probe (${target})`,
      url: target,
    };
  }

  // Redis ping (optional, real TCP probe)
  const redisUrl = String(process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  if (!redisUrl || redisUrl.startsWith("http")) {
    // If it's REST (Upstash REST), we cannot do a TCP PING without REST token; mark unavailable.
    checks.redis = unavailable(
      redisUrl ? "Redis appears to be REST-based (no TCP probe without token)" : "Redis not configured",
      redisUrl ? "rest_mode" : "not_configured"
    );
  } else {
    const parsed = parseRedisUrl(redisUrl);
    if (!parsed) {
      checks.redis = unavailable("Redis URL invalid", "invalid_url");
    } else {
      // Redis RESP PING
      const write = "*1\r\n$4\r\nPING\r\n";
      const probe = await tcpProbe({
        host: parsed.host,
        port: parsed.port,
        tlsMode: parsed.tlsMode,
        timeoutMs: 1200,
        write,
        expectIncludes: "+PONG",
      });
      checks.redis = {
        ...probe,
        desc: `Redis TCP PING (${parsed.tlsMode ? "TLS" : "plain"})`,
        host: parsed.host,
        port: parsed.port,
      };
    }
  }

  // SMTP banner probe (optional)
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (!smtpHost) {
    checks.smtp = unavailable("SMTP not configured", "not_configured");
  } else {
    const probe = await tcpProbe({
      host: smtpHost,
      port: smtpPort,
      tlsMode: false,
      timeoutMs: 1200,
      expectIncludes: "ESMTP",
    });
    checks.smtp = {
      ...probe,
      desc: `SMTP banner probe (${smtpHost}:${smtpPort})`,
      host: smtpHost,
      port: smtpPort,
    };
  }

  // Process / node metrics (always available)
  checks.process = await timed(async () => {
    const mu = process.memoryUsage();
    return {
      desc: "Node process metrics",
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rss: mu.rss,
        heapTotal: mu.heapTotal,
        heapUsed: mu.heapUsed,
        external: mu.external,
      },
      cpu: {
        arch: process.arch,
        platform: process.platform,
      },
    };
  });

  // Global status computation
  const all = Object.values(checks);

  let overall = "ok";
  if (all.some((c) => c?.status === "error")) overall = "error";
  else if (all.some((c) => c?.status === "degraded")) overall = "degraded";
  else if (all.some((c) => c?.status === "warn" || c?.status === "unavailable")) overall = "degraded";

  const latencyMs = Date.now() - startedAt;

  // Backward-compatible fields
  const dbCompat = checks.db?.ok ? "ok" : "fail";
  const providersCompat = checks.providers?.providers || [];
  const shipmentsCompat = Number(checks.shipments?.total ?? 0);

  console.log("[admin.health.summary]", {
    requestId,
    by: actor?.id || null,
    role: actor?.primaryRole || null,
    status: overall,
    latencyMs,
  });

  return json(
    {
      ok: true,
      requestId,
      status: overall,
      timestamp: new Date().toISOString(),
      latencyMs,
      actor,
      version,
      checks,

      // Backward-compatible fields (old shape)
      db: dbCompat,
      providers: providersCompat,
      shipments: shipmentsCompat,
    },
    200,
    { "x-request-id": requestId }
  );
}
