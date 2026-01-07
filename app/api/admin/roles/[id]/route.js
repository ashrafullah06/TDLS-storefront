// PATH: app/api/admin/roles/[id]/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasPermission, Permissions } from "@/lib/rbac";
import crypto from "crypto";

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

const ADMIN_COOKIE = "otp_session_admin";

function safeTimingEqual(a, b) {
  try {
    const A = Buffer.from(String(a || ""));
    const B = Buffer.from(String(b || ""));
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function b64UrlToBuf(input) {
  let s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function parseJson(buf) {
  try {
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return null;
  }
}

function verifyAdminToken(rawToken) {
  const OTP_SECRET = process.env.OTP_SECRET || "";
  if (!OTP_SECRET) return null;

  const token = String(rawToken || "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [h, p, sig] = parts;
  const data = `${h}.${p}`;

  let expected;
  try {
    expected = crypto.createHmac("sha256", OTP_SECRET).update(data).digest("base64url");
  } catch {
    return null;
  }

  if (!safeTimingEqual(expected, sig)) return null;

  const payload = parseJson(b64UrlToBuf(p));
  if (!payload || typeof payload !== "object") return null;

  if (String(payload.scope || "") !== "admin") return null;

  const uid = payload.uid ? String(payload.uid) : "";
  if (!uid) return null;

  let exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  if (exp < 1e12) exp = exp * 1000;
  if (Date.now() >= exp) return null;

  return { uid, payload };
}

function normalizeRoleNames(roleNames) {
  const raw = Array.isArray(roleNames) ? roleNames : [];
  const clean = [];
  const seen = new Set();
  for (const r of raw) {
    const v = String(r || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push(v);
  }
  return clean;
}

function isSuperAdmin(roles) {
  return roles.some((r) => String(r).toLowerCase() === "superadmin");
}

function isAdmin(roles) {
  return roles.some((r) => String(r).toLowerCase() === "admin");
}

function pickPrimaryRole(roles) {
  const lower = roles.map((r) => String(r).toLowerCase());
  const idxSuper = lower.indexOf("superadmin");
  if (idxSuper >= 0) return roles[idxSuper];
  const idxAdmin = lower.indexOf("admin");
  if (idxAdmin >= 0) return roles[idxAdmin];
  return roles[0] || null;
}

function allPermissions() {
  try {
    const vals = Object.values(Permissions || {}).map((v) => String(v || "").trim()).filter(Boolean);
    return Array.from(new Set(vals.map((v) => v.toUpperCase()))).map((v) => v);
  } catch {
    return [];
  }
}

async function computePermissionsFromRolesBestEffort(roleNames) {
  const roles = normalizeRoleNames(roleNames);
  if (isSuperAdmin(roles) || isAdmin(roles)) return allPermissions();

  try {
    const mod = await import("@/lib/rbac");
    if (typeof mod.computePermissionsFromRoles === "function") {
      const raw = mod.computePermissionsFromRoles(roles);
      const arr = Array.isArray(raw) ? raw : [];
      return Array.from(new Set(arr.map((p) => String(p || "").trim()).filter(Boolean)));
    }
  } catch {}

  return [];
}

async function loadAdminSessionFromCookie(req) {
  const raw = String(req.cookies.get(ADMIN_COOKIE)?.value || "").trim();
  const verified = raw ? verifyAdminToken(raw) : null;
  if (!verified?.uid) return null;

  const user = await prisma.user.findUnique({
    where: { id: String(verified.uid) },
    include: { roles: { include: { role: true } } },
  });

  if (!user || user.isActive === false) return null;

  const roleNames = Array.isArray(user.roles)
    ? user.roles.map((ur) => ur?.role?.name).filter(Boolean)
    : [];

  const roles = normalizeRoleNames(roleNames);
  const permissions = await computePermissionsFromRolesBestEffort(roles);

  return {
    user: {
      id: user.id,
      email: user.email || null,
      name: user.name || null,
      roles,
      primaryRole: pickPrimaryRole(roles),
      permissions,
    },
    adminToken: verified.payload,
  };
}

async function requireManageRoles(req) {
  const session = await loadAdminSessionFromCookie(req);

  if (!session?.user) {
    return { ok: false, res: json({ ok: false, error: "UNAUTHENTICATED" }, 401) };
  }

  const roles = Array.isArray(session.user.roles) ? session.user.roles : [];
  const elevated = isSuperAdmin(roles) || isAdmin(roles);

  const allowed = elevated || hasPermission(session.user, Permissions.MANAGE_STAFF);
  if (!allowed) {
    return { ok: false, res: json({ ok: false, error: "FORBIDDEN" }, 403) };
  }

  return { ok: true, session };
}

function normalizeRoleNameInput(name) {
  const s = String(name || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(s)) return null;
  return s;
}

/* ───────────────── GET role ───────────────── */
export async function GET(req, { params }) {
  const gate = await requireManageRoles(req);
  if (!gate.ok) return gate.res;

  const id = String(params?.id || "");
  if (!id) return json({ ok: false, error: "BAD_REQUEST" }, 400);

  const role = await prisma.role.findUnique({
    where: { id },
    include: { users: { select: { id: true, name: true, email: true } } },
  });

  if (!role) return json({ ok: false, error: "NOT_FOUND" }, 404);

  return json({
    ok: true,
    viewer: {
      id: gate.session.user.id,
      primaryRole: gate.session.user.primaryRole,
      roles: gate.session.user.roles,
    },
    role: {
      id: role.id,
      name: role.name,
      createdAt: role.createdAt,
      users: role.users,
      usersCount: Array.isArray(role.users) ? role.users.length : 0,
    },
  });
}

/* ───────────────── PATCH (rename) ───────────────── */
export async function PATCH(req, { params }) {
  const gate = await requireManageRoles(req);
  if (!gate.ok) return gate.res;

  const id = String(params?.id || "");
  if (!id) return json({ ok: false, error: "BAD_REQUEST" }, 400);

  const body = await req.json().catch(() => null);
  const name = normalizeRoleNameInput(body?.name);
  if (!name) return json({ ok: false, error: "INVALID_ROLE_NAME" }, 400);

  try {
    const role = await prisma.role.update({
      where: { id },
      data: { name },
    });

    return json({ ok: true, role });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes("unique")) {
      return json({ ok: false, error: "ROLE_ALREADY_EXISTS" }, 409);
    }
    return json({ ok: false, error: msg }, 500);
  }
}

/* ───────────────── DELETE role ───────────────── */
export async function DELETE(req, { params }) {
  const gate = await requireManageRoles(req);
  if (!gate.ok) return gate.res;

  const id = String(params?.id || "");
  if (!id) return json({ ok: false, error: "BAD_REQUEST" }, 400);

  try {
    await prisma.role.delete({ where: { id } });
    return json({ ok: true, deleted: true });
  } catch {
    return json({ ok: false, error: "cannot delete role" }, 400);
  }
}
