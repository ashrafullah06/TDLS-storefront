// FILE: app/api/health/queue/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * GET /api/health/queue
 * A lightweight, self-contained queue "snapshot" so the Health UI
 * can show something meaningful even before a real job queue is wired.
 *
 * This does NOT depend on any external queue libraries, so it is safe
 * in all environments. When you later plug in BullMQ / Inngest / custom,
 * you can replace the values inside this handler.
 */
export async function GET(req) {
  let admin;
  try {
    admin = await requireAdmin(req, {
      permission: Permissions.VIEW_HEALTH,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      {
        ok: false,
        error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
      },
      status
    );
  }

  const actorId = admin.user?.id || admin.userId;

  // For now we return a static but structured snapshot that the UI
  // can consume immediately. This keeps the panel fully functional
  // and safe, without faking any actual queue operations.
  const queues = [
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

  console.log("[health.queue.snapshot]", {
    by: actorId,
    queuesCount: queues.length,
  });

  return json({
    ok: true,
    mode: "simulated",
    queues,
  });
}

/**
 * POST /api/health/queue
 *
 * Body: {
 *   action: "rerun" | "drain" | "retry" | "pause" | "resume" | "clearFailed",
 *   queue?: "default" | "email"
 * }
 *
 * The implementation is deliberately self-contained and safe.
 * It records the intent (for logs / audits) and returns a rich
 * response that the Health panel can display immediately.
 *
 * When you plug in a real queue, you only need to replace the
 * switch-case internals with real calls; the external API can
 * remain exactly the same.
 */
export async function POST(req) {
  let admin;
  try {
    admin = await requireAdmin(req, {
      permission: Permissions.MANAGE_SETTINGS,
    });
  } catch (err) {
    const status = err?.status === 403 ? 403 : 401;
    return json(
      {
        ok: false,
        error: status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
      },
      status
    );
  }

  const actorId = admin.user?.id || admin.userId;
  let payload = {};
  try {
    payload = await req.json();
  } catch {
    // ignore invalid JSON and treat as empty object
  }

  const action = String(payload?.action || "").toLowerCase();
  const queue = String(payload?.queue || "default").toLowerCase();

  const allowedActions = [
    "rerun",
    "drain",
    "retry",
    "pause",
    "resume",
    "clearfailed",
  ];

  if (!allowedActions.includes(action)) {
    return json(
      {
        ok: false,
        error: "UNKNOWN_ACTION",
        allowedActions,
      },
      400
    );
  }

  const supportedQueues = ["default", "email"];
  if (!supportedQueues.includes(queue)) {
    return json(
      {
        ok: false,
        error: "UNKNOWN_QUEUE",
        supportedQueues,
      },
      400
    );
  }

  // Here we simply log the intent. No-op is deliberate so nothing
  // dangerous can happen accidentally in production.
  console.log("[health.queue.action]", {
    action,
    queue,
    by: actorId,
    at: new Date().toISOString(),
  });

  // Simulated result summary for the UI
  const humanLabel =
    queue === "email"
      ? "Email / Notifications queue"
      : "Default application queue";

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
    action,
    queue,
    humanLabel,
    mode: "simulated",
    message,
    timestamp: new Date().toISOString(),
  });
}
