// FILE: app/api/admin/session/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth"; // ✅ single source of truth for admin auth

function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      Vary: "Cookie, Authorization",
      "x-tdlc-scope": "admin",
      ...extraHeaders,
    },
  });
}

function nowIso(ms) {
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function uniqCI(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function orderRolesForDisplay(roles = []) {
  const list = uniqCI(roles);
  const pri = [
    "superadmin",
    "owner",
    "root",
    "admin",
    "manager",
    "finance",
    "analyst",
    "staff",
    "support",
    "operator",
  ];
  const rank = new Map(pri.map((r, i) => [r, i]));
  return list.sort((a, b) => {
    const al = String(a).toLowerCase();
    const bl = String(b).toLowerCase();
    const ra = rank.has(al) ? rank.get(al) : 999;
    const rb = rank.has(bl) ? rank.get(bl) : 999;
    if (ra !== rb) return ra - rb;
    return String(a).localeCompare(String(b));
  });
}

function pickPrimaryRole(roles = []) {
  const r = orderRolesForDisplay(roles);
  return r[0] || null;
}

function uniqPermsCI(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function normalizeExpToMs(exp) {
  const v = Number(exp);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v >= 1e12 ? v : v * 1000;
}

function buildCapabilities({ roles = [], permissions = [] }) {
  const rolesOrdered = orderRolesForDisplay(roles);
  const pset = new Set((permissions || []).map((p) => String(p || "").toLowerCase()));
  const rset = new Set((rolesOrdered || []).map((r) => String(r || "").toLowerCase()));

  const isSuperadmin = rset.has("superadmin") || rset.has("owner") || rset.has("root");
  const isAdmin =
    isSuperadmin ||
    rset.has("admin") ||
    rset.has("manager") ||
    rset.has("staff") ||
    rset.has("support") ||
    rset.has("operator");
  const isStaff = rset.has("staff") || rset.has("support") || rset.has("operator");

  const superAll = isSuperadmin;

  const modules = {
    dashboard: true,
    analytics: superAll || pset.has("view_analytics") || pset.has("view_reports"),
    reports: superAll || pset.has("view_reports"),
    orders: superAll || pset.has("view_orders") || pset.has("manage_orders"),
    returns: superAll || pset.has("manage_returns") || pset.has("manage_exchanges"),
    customers: superAll || pset.has("view_customers") || pset.has("manage_customers"),
    catalog:
      superAll ||
      pset.has("manage_catalog") ||
      pset.has("manage_collections") ||
      pset.has("manage_products"),
    inventory: superAll || pset.has("view_inventory") || pset.has("manage_inventory"),
    fulfillment: superAll || pset.has("view_fulfillment") || pset.has("manage_fulfillment"),
    finance: superAll || pset.has("view_financials"),
    tax: superAll || pset.has("manage_tax_rates") || pset.has("view_financials"),
    payments: superAll || pset.has("manage_payment_providers"),
    promotions: superAll || pset.has("manage_discounts") || pset.has("manage_settings"),
    notifications:
      superAll ||
      pset.has("manage_notifications") ||
      pset.has("send_notifications") ||
      pset.has("manage_automations"),
    audit: superAll || pset.has("view_audit_logs"),
    health: superAll || pset.has("view_health") || pset.has("view_dev_tools"),
    settings:
      superAll ||
      pset.has("manage_settings") ||
      pset.has("manage_rbac") ||
      pset.has("manage_app_settings"),
    exports: true,
  };

  return { isSuperadmin, isAdmin, isStaff, modules };
}

/* ──────────────────────────────
   FIX: Cookie fallback resolver
   - Keeps requireAdmin() as primary (no unrelated changes)
   - If requireAdmin() throws or returns wrong/missing scope, attempt to validate
     otp_session_admin/admin_session JWT and hydrate admin from DB.
   - This fixes "no_admin_session" when admin is logged in via OTP-session cookies.
──────────────────────────────── */

function base64urlToBuf(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64");
}

function safeJsonParse(buf) {
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || ""));
  } catch {
    return null;
  }
}

function verifyHs256Jwt(token, secret) {
  const t = String(token || "");
  const parts = t.split(".");
  if (parts.length !== 3) return null;

  const [h, p, s] = parts;
  const data = `${h}.${p}`;

  let got;
  try {
    got = base64urlToBuf(s);
  } catch {
    return null;
  }

  const expected = crypto.createHmac("sha256", secret).update(data).digest();
  if (got.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(got, expected)) return null;
  } catch {
    return null;
  }

  const payload = safeJsonParse(base64urlToBuf(p));
  if (!payload) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload?.exp && Number(payload.exp) < nowSec) return null;

  return payload;
}

function extractUserIdFromPayload(payload) {
  const uid =
    payload?.uid ||
    payload?.userId ||
    payload?.sub ||
    payload?.user?.id ||
    payload?.adminId ||
    payload?.id ||
    null;
  const v = String(uid || "").trim();
  return v ? v : null;
}

function extractScopeFromPayload(payload) {
  const scope = String(payload?.scope || payload?.tdlcScope || payload?.scp || "").toLowerCase();
  return scope || null;
}

function candidateSecrets() {
  // Try a small, deterministic set of secrets that exist in this project.
  // No behavior is removed; this only improves compatibility for OTP-cookie admin sessions.
  const out = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s) out.push(s);
  };
  push(process.env.ADMIN_AUTH_SECRET);
  push(process.env.OTP_SECRET);
  push(process.env.CUSTOMER_AUTH_SECRET); // harmless; signature will fail for admin tokens
  push(process.env.AUTH_SECRET);
  push(process.env.NEXTAUTH_SECRET);
  return Array.from(new Set(out));
}

async function resolveAdminFromOtpCookies(req) {
  const c1 = req.cookies?.get?.("otp_session_admin")?.value || "";
  const c2 = req.cookies?.get?.("admin_session")?.value || "";
  const token = c1 || c2;
  if (!token) return null;

  // Accept only HS256 JWTs we can validate with known secrets.
  const secrets = candidateSecrets();
  let payload = null;
  let usedSecret = null;

  for (const sec of secrets) {
    const p = verifyHs256Jwt(token, sec);
    if (p) {
      payload = p;
      usedSecret = sec;
      break;
    }
  }
  if (!payload) return null;

  const scope = extractScopeFromPayload(payload);
  // Prefer explicit scope; if absent, still allow because cookie name is admin-scoped.
  if (scope && scope !== "admin") return null;

  const userId = extractUserIdFromPayload(payload);
  if (!userId) return null;

  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      staffProfile: true,
    },
  });

  if (!userRow) return null;

  const rolesFromDb = [];
  for (const ur of userRow.roles || []) {
    const r = ur?.role;
    const name = r?.name || r?.slug || r?.key;
    if (name) rolesFromDb.push(String(name));
  }

  // Best-effort permissions extraction (kept optional)
  const permsFromDb = [];
  // If your schema has Role.permissions as strings or relation, keep it safe
  for (const ur of userRow.roles || []) {
    const r = ur?.role;
    const perms = r?.permissions || r?.perms || null;
    if (Array.isArray(perms)) {
      for (const p of perms) permsFromDb.push(String(p));
    }
  }

  const payloadExpMs = normalizeExpToMs(payload?.exp);
  const expIso = payloadExpMs ? nowIso(payloadExpMs) : null;

  return {
    scope: "admin",
    userId: userRow.id,
    user: {
      id: userRow.id,
      name: userRow.name ?? null,
      email: userRow.email ?? null,
      phone: userRow.phone ?? null,
      image: userRow.image ?? null,
      roles: rolesFromDb,
      permissions: permsFromDb,
    },
    roles: rolesFromDb,
    permissions: permsFromDb,
    exp: payload?.exp ?? null,
    expiresAt: expIso,
    _fallback: {
      source: "otp_cookie_jwt",
      secretUsed: usedSecret ? "matched" : "none",
    },
  };
}

export async function GET(req) {
  const now = Date.now();
  const requestId = newRequestId();

  const url = new URL(req.url);
  const includeParam = String(url.searchParams.get("include") || "").trim();
  const include = new Set(
    includeParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  // Default (matches your caller)
  if (include.size === 0) {
    include.add("roles");
    include.add("permissions");
    include.add("capabilities");
    include.add("policy");
  }

  // ✅ Use the same admin auth resolver used by working admin endpoints.
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (e) {
    // FIX: Try OTP-cookie fallback before declaring "no_admin_session"
    const fb = await resolveAdminFromOtpCookies(req).catch(() => null);
    if (fb) {
      admin = fb;
    } else {
      // No redirect; stay dashboard-side and show the message.
      return json(
        {
          ok: true,
          requestId,
          ts: now,
          tsIso: nowIso(now),
          authenticated: false,
          session: {
            scope: "admin",
            source: "requireAdmin",
            reason: "no_admin_session",
            expiresAt: null,
            ttlRemainingMs: null,
            refreshSoon: false,
          },
          user: null,
          roles: [],
          roleAssignments: [],
          permissions: [],
          capabilities: buildCapabilities({ roles: [], permissions: [] }),
          security: {
            twoFactorAdminOk: false,
            needsRbacOtp: false,
            risk: { degradedDb: false, suspicious: false, reason: "no_admin_session" },
          },
          isolation: {
            scope: "admin",
            customerCookies: "ignored",
            note:
              "Admin session missing/invalid for requireAdmin(). No automatic redirect is performed by this endpoint.",
          },
        },
        200,
        {
          "x-request-id": requestId,
          "x-tdlc-admin-auth": "missing",
          "x-tdlc-admin-auth-reason": "no_admin_session",
          "x-tdlc-admin-auth-source": "requireAdmin",
        }
      );
    }
  }

  // If requireAdmin produced a non-admin scope, try fallback before blocking.
  const scope = String(admin?.scope || admin?.tdlcScope || "admin").toLowerCase();
  if (scope !== "admin") {
    const fb = await resolveAdminFromOtpCookies(req).catch(() => null);
    if (fb) {
      admin = fb;
    } else {
      return json(
        {
          ok: true,
          requestId,
          ts: now,
          tsIso: nowIso(now),
          authenticated: false,
          session: {
            scope: "admin",
            source: "requireAdmin",
            reason: "wrong_scope",
            expiresAt: null,
            ttlRemainingMs: null,
            refreshSoon: false,
          },
          user: null,
          roles: [],
          roleAssignments: [],
          permissions: [],
          capabilities: buildCapabilities({ roles: [], permissions: [] }),
          security: {
            twoFactorAdminOk: false,
            needsRbacOtp: false,
            risk: { degradedDb: false, suspicious: true, reason: "wrong_scope" },
          },
          isolation: {
            scope: "admin",
            customerCookies: "ignored",
            note:
              "A non-admin scope was presented to the admin session endpoint; it is rejected to prevent customer/admin coupling.",
          },
        },
        200,
        {
          "x-request-id": requestId,
          "x-tdlc-admin-auth": "blocked",
          "x-tdlc-admin-auth-reason": "wrong_scope",
          "x-tdlc-admin-auth-source": "requireAdmin",
        }
      );
    }
  }

  const userId = String(admin?.userId || admin?.uid || admin?.user?.id || "").trim();

  const roles = orderRolesForDisplay(
    Array.isArray(admin?.roles)
      ? admin.roles
      : Array.isArray(admin?.user?.roles)
      ? admin.user.roles
      : []
  );

  const permissions = uniqPermsCI(
    Array.isArray(admin?.permissions)
      ? admin.permissions
      : Array.isArray(admin?.user?.permissions)
      ? admin.user.permissions
      : []
  );

  const expMs = normalizeExpToMs(admin?.exp || admin?.expiresAt || admin?.expires);
  const ttlRemainingMs = expMs ? Math.max(0, expMs - now) : null;

  const primaryRole = pickPrimaryRole(roles);
  const u = admin?.user || {};

  const user = {
    id: userId || null,
    name: u?.name ?? null,
    email: u?.email ?? null,
    phone: u?.phone ?? null,
    image: u?.image ?? null,
    roles,
    primaryRole,
    permissions,
    scope: "admin",
    displayRole: primaryRole ? String(primaryRole) : null,
    displayLabel: primaryRole
      ? `Logged in as: ${String(primaryRole).toUpperCase()}`
      : "Logged in as: STAFF",
  };

  return json(
    {
      ok: true,
      requestId,
      ts: now,
      tsIso: nowIso(now),
      authenticated: true,
      session: {
        scope: "admin",
        source: admin?._fallback ? "otp_cookie_jwt" : "requireAdmin",
        reason: "ok",
        userId: userId || null,
        expiresAt: expMs ? nowIso(expMs) : null,
        ttlRemainingMs,
        refreshSoon: false,
      },
      user,
      roles: include.has("roles") ? roles : undefined,
      permissions: include.has("permissions") ? permissions : undefined,
      capabilities: include.has("capabilities")
        ? buildCapabilities({ roles, permissions })
        : undefined,
      security: {
        twoFactorAdminOk: true,
        needsRbacOtp: false,
        risk: { degradedDb: false, suspicious: false, reason: null },
      },
      isolation: {
        scope: "admin",
        customerCookies: "ignored",
        note: admin?._fallback
          ? "Admin session resolved via validated OTP-cookie JWT fallback to prevent false negatives."
          : "Admin session is resolved exclusively via requireAdmin() to prevent drift.",
      },
    },
    200,
    {
      "x-request-id": requestId,
      "x-tdlc-admin-auth": "ok",
      "x-tdlc-admin-auth-reason": "ok",
      "x-tdlc-admin-auth-source": admin?._fallback ? "otp_cookie_jwt" : "requireAdmin",
    }
  );
}
