// FILE: app/api/admin/health/queue/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import { Permissions } from "@/lib/rbac";

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

function normAction(a) {
  const s = String(a || "").trim().toLowerCase();
  // accept variants like clearFailed / clear_failed / clear-failed
  return s.replace(/[\s_-]/g, "");
}

function normalizeQueueName(q) {
  return String(q || "default").trim().toLowerCase();
}

function normPerm(p) {
  return String(p || "").trim().toLowerCase();
}

function pick(arr, ...paths) {
  for (const path of paths) {
    try {
      const parts = String(path).split(".");
      let cur = arr;
      for (const k of parts) cur = cur?.[k];
      if (cur !== undefined) return cur;
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * ✅ Single source of truth for admin auth:
 * Fetch /api/admin/session using the incoming request cookies.
 * This prevents any customer/admin coupling by design.
 */
async function getAdminSessionViaApi(req) {
  const origin = (() => {
    try {
      return new URL(req.url).origin;
    } catch {
      // fallback if somehow req.url is not absolute
      const proto = req.headers.get("x-forwarded-proto") || "https";
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
      return host ? `${proto}://${host}` : "";
    }
  })();

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

  return { ok: r.ok, status: r.status, data, raw: txt };
}

function extractActor(sessionJson) {
  const user = sessionJson?.user || null;
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const primaryRole =
    user?.primaryRole ||
    (roles.length ? String(roles[0] || "") : null) ||
    null;

  return {
    id: user?.id || sessionJson?.session?.userId || null,
    email: user?.email ?? null,
    primaryRole,
    roles,
  };
}

function hasPermission(sessionJson, permissionNeed) {
  const need = normPerm(permissionNeed);

  // Superadmin shortcut (from /api/admin/session capabilities)
  const isSuper =
    !!sessionJson?.capabilities?.isSuperadmin ||
    !!sessionJson?.capabilities?.modules?.settings && !!sessionJson?.capabilities?.modules?.health;

  if (isSuper) return true;

  const perms =
    pick(sessionJson, "permissions") ||
    pick(sessionJson, "user.permissions") ||
    [];

  if (!Array.isArray(perms)) return false;
  const set = new Set(perms.map(normPerm));
  return set.has(need);
}

/**
 * Optional real queue integration.
 * If "@/lib/queue" exists, we will use it.
 *
 * Expected (optional) functions in "@/lib/queue":
 * - snapshot(): { queues, mode? } OR just { queues }
 * - listQueues(): string[] OR { name,label }[]
 * - drain(queue)
 * - retry(queue)
 * - pause(queue)
 * - resume(queue)
 * - clearFailed(queue) / clearfailed(queue)
 * - rerun(queue) OR rerunHealth()
 */
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

function humanQueueLabel(queue) {
  if (queue === "email") return "Email / Notifications queue";
  if (queue === "default") return "Default application queue";
  return `Queue "${queue}"`;
}

const ALLOWED_ACTIONS = ["rerun", "drain", "retry", "pause", "resume", "clearfailed"];

/**
 * GET /api/admin/health/queue
 * Admin-only queue snapshot for Admin Health UI.
 * ✅ Auth is validated ONLY via /api/admin/session (no customer session).
 */
export async function GET(req) {
  const requestId = newRequestId();
  const t0 = Date.now();

  const s = await getAdminSessionViaApi(req).catch((e) => ({
    ok: false,
    status: 503,
    data: null,
    raw: String(e?.message || e),
  }));

  const scope = String(s?.data?.session?.scope || s?.data?.user?.scope || "admin").toLowerCase();
  const authenticated = !!s?.data?.authenticated;

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
  const need = Permissions.VIEW_HEALTH;
  if (!hasPermission(s.data, need)) {
    return json(
      {
        ok: false,
        error: "FORBIDDEN",
        requestId,
        required: String(need),
      },
      403,
      { "x-request-id": requestId }
    );
  }

  const actor = extractActor(s.data);

  const qmod = await loadQueueModule();

  let mode = "simulated";
  let queues = buildSimulatedQueues();
  let supportedQueues = queues.map((x) => x.name);

  const capabilities = {
    auth: { source: "/api/admin/session", scope: "admin" },
    queue: {
      hasModule: !!qmod,
      hasSnapshot: !!qmod?.snapshot,
      hasListQueues: !!qmod?.listQueues,
      actions: {
        rerun: !!(qmod?.rerun || qmod?.rerunHealth),
        drain: !!qmod?.drain,
        retry: !!qmod?.retry,
        pause: !!qmod?.pause,
        resume: !!qmod?.resume,
        clearfailed: !!(qmod?.clearFailed || qmod?.clearfailed),
      },
    },
  };

  if (qmod) {
    try {
      const listed =
        typeof qmod.listQueues === "function" ? await qmod.listQueues() : null;

      if (Array.isArray(listed) && listed.length) {
        supportedQueues =
          typeof listed[0] === "string"
            ? listed.map((x) => String(x).toLowerCase())
            : listed
                .map((x) => String(x?.name || "").toLowerCase())
                .filter(Boolean);
      }

      if (typeof qmod.snapshot === "function") {
        const snap = await qmod.snapshot();
        const snapQueues = Array.isArray(snap?.queues) ? snap.queues : null;

        if (snapQueues && snapQueues.length) {
          mode = String(snap?.mode || "real");
          queues = snapQueues.map((qq) =>
            coerceQueueShape(qq, qq?.label || qq?.name)
          );
          supportedQueues = queues.map((x) => String(x.name).toLowerCase());
        } else {
          mode = "simulated";
          if (supportedQueues?.length) {
            queues = supportedQueues.map((name) =>
              coerceQueueShape({ name }, humanQueueLabel(name))
            );
          }
        }
      } else {
        if (supportedQueues?.length) {
          queues = supportedQueues.map((name) =>
            coerceQueueShape({ name }, humanQueueLabel(name))
          );
        }
      }
    } catch (e) {
      mode = "simulated";
      queues = buildSimulatedQueues();
      supportedQueues = queues.map((x) => x.name);
      capabilities.queue.snapshotError = String(e?.message || e);
    }
  }

  const latencyMs = Date.now() - t0;

  console.log("[admin.health.queue.snapshot]", {
    requestId,
    by: actor?.id || null,
    role: actor?.primaryRole || null,
    mode,
    queuesCount: queues.length,
    latencyMs,
  });

  return json(
    {
      ok: true,
      requestId,
      timestamp: new Date().toISOString(),
      latencyMs,
      actor,
      mode,
      queues,
      supportedActions: ALLOWED_ACTIONS,
      supportedQueues,
      capabilities,
    },
    200,
    { "x-request-id": requestId }
  );
}

/**
 * POST /api/admin/health/queue
 * ✅ Auth is validated ONLY via /api/admin/session (no customer session).
 *
 * Body:
 * { action, queue? }
 */
export async function POST(req) {
  const requestId = newRequestId();
  const t0 = Date.now();

  const s = await getAdminSessionViaApi(req).catch((e) => ({
    ok: false,
    status: 503,
    data: null,
    raw: String(e?.message || e),
  }));

  const scope = String(s?.data?.session?.scope || s?.data?.user?.scope || "admin").toLowerCase();
  const authenticated = !!s?.data?.authenticated;

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

  // Permission gate: MANAGE_SETTINGS
  const need = Permissions.MANAGE_SETTINGS;
  if (!hasPermission(s.data, need)) {
    return json(
      {
        ok: false,
        error: "FORBIDDEN",
        requestId,
        required: String(need),
      },
      403,
      { "x-request-id": requestId }
    );
  }

  const actor = extractActor(s.data);

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const action = normAction(payload?.action);
  const queue = normalizeQueueName(payload?.queue);

  if (!action) return json({ ok: false, error: "ACTION_REQUIRED", requestId }, 400, { "x-request-id": requestId });

  if (!ALLOWED_ACTIONS.includes(action)) {
    return json(
      { ok: false, error: "UNKNOWN_ACTION", allowedActions: ALLOWED_ACTIONS, requestId },
      400,
      { "x-request-id": requestId }
    );
  }

  const qmod = await loadQueueModule();
  let supportedQueues = ["default", "email"];

  if (qmod && typeof qmod.listQueues === "function") {
    try {
      const listed = await qmod.listQueues();
      if (Array.isArray(listed) && listed.length) {
        supportedQueues =
          typeof listed[0] === "string"
            ? listed.map((x) => String(x).toLowerCase())
            : listed.map((x) => String(x?.name || "").toLowerCase()).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }

  if (!supportedQueues.includes(queue)) {
    return json(
      { ok: false, error: "UNKNOWN_QUEUE", supportedQueues, requestId },
      400,
      { "x-request-id": requestId }
    );
  }

  const humanLabel = humanQueueLabel(queue);

  const simulated = (msg) => {
    const latencyMs = Date.now() - t0;

    console.log("[admin.health.queue.action.simulated]", {
      requestId,
      action,
      queue,
      by: actor?.id || null,
      role: actor?.primaryRole || null,
      latencyMs,
    });

    return json(
      {
        ok: true,
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs,
        actor,
        action,
        queue,
        humanLabel,
        mode: "simulated",
        message: msg,
      },
      200,
      { "x-request-id": requestId }
    );
  };

  if (!qmod) {
    switch (action) {
      case "rerun":
        return simulated(`All pending jobs in "${humanLabel}" will be re-queued for immediate processing. (Simulated)`);
      case "drain":
        return simulated(`All pending jobs in "${humanLabel}" will be drained without running. (Simulated)`);
      case "retry":
        return simulated(`All failed jobs in "${humanLabel}" will be flagged for retry. (Simulated)`);
      case "pause":
        return simulated(`"${humanLabel}" will be paused; new jobs can enqueue but will not run. (Simulated)`);
      case "resume":
        return simulated(`"${humanLabel}" will resume processing jobs normally. (Simulated)`);
      case "clearfailed":
        return simulated(`All failed jobs in "${humanLabel}" will be cleared. (Simulated)`);
      default:
        return simulated(`Action "${action}" completed for "${humanLabel}". (Simulated)`);
    }
  }

  try {
    console.log("[admin.health.queue.action]", {
      requestId,
      action,
      queue,
      by: actor?.id || null,
      role: actor?.primaryRole || null,
      at: new Date().toISOString(),
    });

    let result = null;
    let usedReal = false;

    if (action === "rerun") {
      if (typeof qmod.rerun === "function") {
        result = await qmod.rerun(queue);
        usedReal = true;
      } else if (typeof qmod.rerunHealth === "function") {
        result = await qmod.rerunHealth();
        usedReal = true;
      }
    } else if (action === "drain" && typeof qmod.drain === "function") {
      result = await qmod.drain(queue);
      usedReal = true;
    } else if (action === "retry" && typeof qmod.retry === "function") {
      result = await qmod.retry(queue);
      usedReal = true;
    } else if (action === "pause" && typeof qmod.pause === "function") {
      result = await qmod.pause(queue);
      usedReal = true;
    } else if (action === "resume" && typeof qmod.resume === "function") {
      result = await qmod.resume(queue);
      usedReal = true;
    } else if (action === "clearfailed") {
      const fn = qmod.clearFailed || qmod.clearfailed;
      if (typeof fn === "function") {
        result = await fn(queue);
        usedReal = true;
      }
    }

    if (!usedReal) {
      return simulated(`Queue module is present, but action "${action}" is not implemented for "${humanLabel}". (Simulated)`);
    }

    const message =
      result?.message ||
      (action === "rerun"
        ? `Re-queued pending jobs for "${humanLabel}".`
        : action === "drain"
        ? `Drained pending jobs for "${humanLabel}".`
        : action === "retry"
        ? `Retried failed jobs for "${humanLabel}".`
        : action === "pause"
        ? `Paused "${humanLabel}".`
        : action === "resume"
        ? `Resumed "${humanLabel}".`
        : action === "clearfailed"
        ? `Cleared failed jobs for "${humanLabel}".`
        : `Action "${action}" executed for "${humanLabel}".`);

    const latencyMs = Date.now() - t0;

    return json(
      {
        ok: true,
        requestId,
        timestamp: new Date().toISOString(),
        latencyMs,
        actor,
        action,
        queue,
        humanLabel,
        mode: "real",
        message,
        result: result ?? null,
      },
      200,
      { "x-request-id": requestId }
    );
  } catch (e) {
    return json(
      {
        ok: false,
        error: "QUEUE_ACTION_FAILED",
        requestId,
        action,
        queue,
        detail: String(e?.message || e),
        timestamp: new Date().toISOString(),
      },
      500,
      { "x-request-id": requestId }
    );
  }
}
