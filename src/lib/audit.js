// src/lib/audit.js
import prisma from "@/lib/prisma";

/**
 * Persist audit logs to Prisma.AuditLog while keeping the call sites tiny.
 * - action: string (e.g., "ORDER_STATUS_UPDATE")
 * - subject / subjectType: optional (e.g., orderId / "ORDER")
 * - metadata: anything serialisable (kept small)
 * - user: { id?, email? } if available
 */
export async function logAudit({ action, subject = null, subjectType = null, metadata = null, user = null, ip = null, userAgent = null }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        subject,
        subjectType,
        metadata,
        userId: user?.id || null,
        ip: ip || null,
        userAgent: userAgent || null,
      },
    });
  } catch (e) {
    // Never throw from audit; keep operations non-blocking for callers
    console.error("[audit] failed:", e?.message || e);
  }
}

/**
 * Wrap handlers to auto-log success/failure with minimal effort.
 */
export function withAudit(handler, { action, subjectType }) {
  return async (req, context) => {
    const start = Date.now();
    const ua = req.headers.get("user-agent") || "";
    const ip = req.headers.get("x-forwarded-for") || req.ip || null;
    const user = (req.user && typeof req.user === "object") ? req.user : null;

    try {
      const res = await handler(req, context);
      const ms = Date.now() - start;
      logAudit({
        action,
        subject: context?.params?.id || null,
        subjectType,
        metadata: { ok: true, status: res?.status || 200, ms },
        user, ip, userAgent: ua,
      });
      return res;
    } catch (err) {
      const ms = Date.now() - start;
      logAudit({
        action,
        subject: context?.params?.id || null,
        subjectType,
        metadata: { ok: false, error: String(err?.message || err), ms },
        user, ip, userAgent: ua,
      });
      throw err;
    }
  };
}
