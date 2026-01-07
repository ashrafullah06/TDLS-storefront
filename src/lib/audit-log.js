// FILE: src/lib/audit-log.js
import prisma from "@/lib/prisma";

/**
 * Best-effort admin audit writer.
 * - Uses prisma.adminAuditLog if it exists
 * - Else uses prisma.auditLog if it exists
 * - Else logs to console
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.event
 * @param {string=} args.ip
 * @param {string=} args.ua
 * @param {object=} args.meta
 */
export async function writeAdminAuditLog({ userId, event, ip, ua, meta }) {
  const payload = {
    userId: String(userId),
    event: String(event),
    ip: ip ? String(ip) : null,
    userAgent: ua ? String(ua) : null,
    meta: meta ?? {},
    createdAt: new Date(),
  };

  try {
    if (prisma?.adminAuditLog?.create) {
      await prisma.adminAuditLog.create({ data: payload });
      return true;
    }
    if (prisma?.auditLog?.create) {
      await prisma.auditLog.create({ data: payload });
      return true;
    }
    console.info("[admin-audit]", payload);
    return true;
  } catch (e) {
    console.warn("[admin-audit] write failed", e);
    return false;
  }
}
