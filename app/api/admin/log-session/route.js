// FILE: app/api/admin/log-session/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ---------------- helpers ---------------- */

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "origin, cookie",
      "x-tdlc-admin-log": "v2",
    },
  });
}

function getClientIp(req) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return null;
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  // Some clients omit Origin for same-site POSTs; treat missing as allowed.
  if (!origin) return true;

  let reqOrigin = "";
  try {
    reqOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }
  return origin === reqOrigin;
}

function str(v) {
  return String(v ?? "").trim();
}

function normalizeIdentifier(identifierRaw) {
  const id = str(identifierRaw);

  // Email
  if (id.includes("@")) return id.toLowerCase();

  // Phone-ish: keep + and digits only
  let out = "";
  for (const ch of id) {
    if ((ch >= "0" && ch <= "9") || ch === "+") out += ch;
  }
  // Normalize multiple '+' (keep only leading)
  if (out.includes("+")) {
    out = "+" + out.replace(/\+/g, "");
  }
  return out;
}

function normalizeChannel(channelRaw) {
  const c = str(channelRaw).toLowerCase();
  // Keep your flexibility; standardize known values
  if (c === "sms" || c === "email" || c === "whatsapp") return c;
  return c || "unknown";
}

function normalizePurpose(purposeRaw) {
  const p = str(purposeRaw).toLowerCase();
  // Keep open-ended but normalize common ones
  if (!p) return "admin_login";
  return p;
}

function clampNote(noteRaw) {
  const n = str(noteRaw);
  // Safety: store at most 1000 chars (your original intent)
  return n.length > 1000 ? n.slice(0, 1000) : n;
}

async function shouldDedupe({ identifier, purpose, loginNote }) {
  // Best-effort dedupe window to prevent double-fires (mount+focus, retries, etc.)
  // Assumes your model has createdAt (typical). If not, it will fall back gracefully.
  const DEDUPE_SECONDS = 6;
  const since = new Date(Date.now() - DEDUPE_SECONDS * 1000);

  try {
    const recent = await prisma.adminSessionLog.findFirst({
      where: {
        identifier,
        purpose,
        loginNote,
        createdAt: { gte: since },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    return !!recent;
  } catch {
    // If schema doesn't have createdAt or query fails, do not block logging.
    return false;
  }
}

/* ---------------- main ---------------- */

export async function POST(req) {
  // Prevent cross-site spam. Logout/log endpoints should always be same-origin.
  if (!isSameOrigin(req)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  try {
    const session = await auth();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "BAD_REQUEST" }, 400);
    }

    const note = clampNote(body.note);
    const identifierRaw = str(body.identifier);

    const channel = normalizeChannel(body.channel ?? "unknown");
    const purpose = normalizePurpose(body.purpose ?? "admin_login");

    if (!identifierRaw || !note) {
      return json({ ok: false, error: "MISSING_FIELDS" }, 400);
    }

    const identifier = normalizeIdentifier(identifierRaw);

    // Basic sanity to avoid table bloat from nonsense
    if (identifier.length < 3 || identifier.length > 190) {
      return json({ ok: false, error: "INVALID_IDENTIFIER" }, 400);
    }

    const uaRaw = req.headers.get("user-agent") || null;
    const ua =
      uaRaw && uaRaw.length > 512 ? uaRaw.slice(0, 512) : uaRaw;

    const ip = getClientIp(req);

    let userId = session?.user?.id || null;

    // Fallback lookup by identifier (best-effort)
    if (!userId) {
      const where = identifier.includes("@")
        ? { email: identifier }
        : { phone: identifier };

      try {
        const u = await prisma.user.findUnique({ where, select: { id: true } });
        if (u?.id) userId = u.id;
      } catch {
        // swallow – logging is best-effort
      }
    }

    // Dedupe duplicate logs caused by double-fired UI events
    const deduped = await shouldDedupe({
      identifier,
      purpose,
      loginNote: note,
    });

    if (deduped) {
      return json({ ok: true, deduped: true });
    }

    await prisma.adminSessionLog.create({
      data: {
        userId,
        identifier,
        channel,
        purpose,
        loginNote: note,
        ip,
        userAgent: ua,
      },
    });

    return json({ ok: true, deduped: false });
  } catch (e) {
    console.error("AdminSessionLog error:", e);
    return json({ ok: false, error: "LOG_FAILED" }, 500);
  }
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
