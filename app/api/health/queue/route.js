// FILE: app/api/health/queue/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "x-robots-tag": "noindex, nofollow, noarchive",
      Vary: "Cookie, Authorization",
      // keep both for compatibility across older code paths
      "x-tdlc-scope": "admin",
      "x-tdls-scope": "admin",
      ...extraHeaders,
    },
  });
}

/**
 * Important security rule (your requirement):
 * - Customers must never be able to confirm this exists.
 * - So unauthorized/forbidden returns 404 (not 401/403).
 */
function concealNotFound() {
  return json({ ok: false, error: "NOT_FOUND" }, 404);
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

function normAction(a) {
  return String(a || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, "");
}

function normQueue(q) {
  return String(q || "default").trim().toLowerCase();
}

const ALLOWED_ACTIONS = ["rerun", "drain", "retry", "pause", "resume", "clearfailed"];
const SUPPORTED_QUEUES = ["default", "email"];

/**
 * GET /api/health/queue
 * Admin-only (concealed from customers).
 */
export async function GET(req) {
  try {
    await requireAdmin(req, { permission: Permissions.VIEW_HEALTH });
  } catch {
    return concealNotFound();
  }

  // If you later wire a real queue, prefer using /api/admin/health/queue
  // and keep this route as compat or remove it completely.
  const queues = buildSimulatedQueues();

  return json({
    ok: true,
    mode: "simulated",
    timestamp: new Date().toISOString(),
    queues,
    supportedActions: ALLOWED_ACTIONS,
    supportedQueues: SUPPORTED_QUEUES,
  });
}

/**
 * POST /api/health/queue
 * Admin-only (concealed from customers).
 *
 * Body: { action, queue? }
 */
export async function POST(req) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_SETTINGS });
  } catch {
    return concealNotFound();
  }

  let payload = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const action = normAction(payload?.action);
  const queue = normQueue(payload?.queue);

  if (!ALLOWED_ACTIONS.includes(action)) {
    return json({ ok: false, error: "UNKNOWN_ACTION", allowedActions: ALLOWED_ACTIONS }, 400);
  }

  if (!SUPPORTED_QUEUES.includes(queue)) {
    return json({ ok: false, error: "UNKNOWN_QUEUE", supportedQueues: SUPPORTED_QUEUES }, 400);
  }

  const humanLabel = queue === "email" ? "Email / Notifications queue" : "Default application queue";

  let message = "";
  switch (action) {
    case "rerun":
      message = `All pending jobs in "${humanLabel}" will be re-queued for immediate processing. (Simulated)`;
      break;
    case "drain":
      message = `All pending jobs in "${humanLabel}" will be drained without running. (Simulated)`;
      break;
    case "retry":
      message = `All failed jobs in "${humanLabel}" will be flagged for retry. (Simulated)`;
      break;
    case "pause":
      message = `"${humanLabel}" will be paused; new jobs can enqueue but will not run. (Simulated)`;
      break;
    case "resume":
      message = `"${humanLabel}" will resume processing jobs normally. (Simulated)`;
      break;
    case "clearfailed":
      message = `All failed jobs in "${humanLabel}" will be cleared. (Simulated)`;
      break;
    default:
      message = `Action "${action}" completed for "${humanLabel}". (Simulated)`;
      break;
  }

  return json({
    ok: true,
    mode: "simulated",
    timestamp: new Date().toISOString(),
    action,
    queue,
    humanLabel,
    message,
  });
}
