// FILE: app/api/admin/settings/rbac/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Roles, Permissions, hasPermission } from "@/lib/rbac";

const ALL_ROLE_NAMES = Object.values(Roles || {});
const ALL_PERMISSION_KEYS = Object.values(Permissions || {});

/**
 * Convert "view_analytics" → "View Analytics"
 */
function toLabel(key = "") {
  return String(key)
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/**
 * Normalize roles to string role names.
 * Handles:
 * - ["superadmin","admin"]
 * - [{name:"superadmin"}]
 * - [{role:{name:"superadmin"}}]
 * - { roles: [...] }
 * - "superadmin"
 */
function normalizeRoleNames(input) {
  if (!input) return [];

  // string → [string]
  if (typeof input === "string") {
    const v = input.trim();
    return v ? [v] : [];
  }

  // object with roles
  if (!Array.isArray(input) && typeof input === "object") {
    if (Array.isArray(input.roles)) return normalizeRoleNames(input.roles);
    const one =
      input.name ||
      input.roleName ||
      input.role?.name ||
      (typeof input.role === "string" ? input.role : null);
    return one ? [String(one)] : [];
  }

  // array
  if (Array.isArray(input)) {
    const out = [];
    for (const r of input) {
      if (!r) continue;
      if (typeof r === "string") {
        const v = r.trim();
        if (v) out.push(v);
        continue;
      }
      const one =
        r.name ||
        r.roleName ||
        r.role?.name ||
        (typeof r.role === "string" ? r.role : null);
      if (one) out.push(String(one));
    }
    // de-dupe CI
    const seen = new Set();
    return out.filter((v) => {
      const k = String(v).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return [];
}

function isSuperadminRole(roleNames = []) {
  return (roleNames || []).some((r) => {
    const k = String(r || "").toLowerCase();
    return k === String(Roles.SUPERADMIN).toLowerCase() || k === "owner" || k === "root";
  });
}

/**
 * Build the default RBAC matrix based purely on lib/rbac.js.
 * lib/rbac.js remains the SOURCE OF TRUTH for enforcement.
 * The DB matrix is an override layer that the UI can manage.
 */
function buildDefaultMatrix() {
  const matrix = {};
  if (!ALL_PERMISSION_KEYS.length) return matrix;

  for (const roleName of ALL_ROLE_NAMES) {
    const granted = [];
    for (const perm of ALL_PERMISSION_KEYS) {
      try {
        // hasPermission accepts a role string for "what would this role have"
        if (hasPermission(roleName, perm)) granted.push(perm);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("RBAC matrix check failed for", roleName, perm, e);
      }
    }
    matrix[roleName] = granted;
  }
  return matrix;
}

/**
 * Sanitize a matrix payload from the client:
 * - Keep only known roles.
 * - For each role, keep only known permission keys.
 */
function sanitizeMatrix(raw) {
  const safe = {};
  if (!raw || typeof raw !== "object") return safe;

  for (const roleName of ALL_ROLE_NAMES) {
    const perms = raw[roleName];
    if (!Array.isArray(perms)) continue;
    safe[roleName] = perms
      .map((p) => String(p || "").trim())
      .filter((p) => ALL_PERMISSION_KEYS.includes(p));
  }

  return safe;
}

/* ───────────────── GET ───────────────── */

export async function GET(req) {
  try {
    // ✅ Authenticate admin scope, but do NOT hard-fail on permissions here.
    // We will enforce canAccess after we normalize roles.
    const { user, roles } = await requireAdmin(req);

    const roleNames = normalizeRoleNames(roles);
    const superadmin = isSuperadminRole(roleNames);

    const canAccess =
      superadmin ||
      hasPermission(roleNames, Permissions.MANAGE_SETTINGS) ||
      hasPermission(roleNames, Permissions.MANAGE_RBAC);

    if (!canAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // Load roles from DB (seeded by prisma/app/seed.js)
    const dbRoles = await prisma.role.findMany({
      orderBy: { createdAt: "asc" },
    });

    // Optional: AppSetting override; fallback to pure code-based RBAC
    let dbSetting = null;
    try {
      dbSetting = await prisma.appSetting.findUnique({
        where: { key: "rbac_matrix" },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("RBAC AppSetting lookup failed (safe to ignore):", e?.message);
    }

    const codeMatrix = buildDefaultMatrix();
    let matrix = codeMatrix;
    let meta = {
      source: "code",
      updatedAt: null,
      updatedBy: null,
    };

    if (dbSetting?.value && typeof dbSetting.value === "object") {
      const val = dbSetting.value;
      if (val.matrix && typeof val.matrix === "object") {
        const merged = { ...codeMatrix };
        for (const [roleName, perms] of Object.entries(val.matrix)) {
          if (!Array.isArray(perms)) continue;
          merged[roleName] = perms.filter((p) => ALL_PERMISSION_KEYS.includes(p));
        }
        matrix = merged;
        meta = {
          source: val.source || "db",
          updatedAt: dbSetting.updatedAt,
          updatedBy: val.updatedBy || null,
        };
      }
    }

    const permissions = ALL_PERMISSION_KEYS.map((key) => ({
      key,
      label: toLabel(key),
    }));

    const safeRoles = dbRoles.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
    }));

    // ✅ Who can edit in the UI?
    const canEdit =
      superadmin ||
      hasPermission(roleNames, Permissions.MANAGE_RBAC) ||
      hasPermission(roleNames, Permissions.MANAGE_SETTINGS);

    return NextResponse.json({
      roles: safeRoles,
      permissions,
      matrix,
      isSuperadmin: superadmin,
      canEdit,
      meta,
      currentUser: user ? { id: user.id, name: user.name, email: user.email || null } : null,
      // helpful for debugging, harmless for UI
      sessionRoles: roleNames,
    });
  } catch (err) {
    console.error("RBAC settings GET failed:", err);
    return new NextResponse("Forbidden", { status: 403 });
  }
}

/* ───────────────── PUT (save / reset matrix) ───────────────── */

/**
 * PUT /api/admin/settings/rbac
 * Body:
 *   { matrix: { [roleName]: string[] } }
 *   or
 *   { resetToDefaults: true }
 *
 * - Only superadmin or admins with MANAGE_RBAC/MANAGE_SETTINGS can save.
 * - Persists sanitized matrix to AppSetting("rbac_matrix").
 */
export async function PUT(req) {
  try {
    const { user, roles } = await requireAdmin(req);

    const roleNames = normalizeRoleNames(roles);
    const superadmin = isSuperadminRole(roleNames);

    const canAccess =
      superadmin ||
      hasPermission(roleNames, Permissions.MANAGE_RBAC) ||
      hasPermission(roleNames, Permissions.MANAGE_SETTINGS);

    if (!canAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    let payload;
    try {
      payload = await req.json();
    } catch {
      return new NextResponse(JSON.stringify({ ok: false, error: "INVALID_JSON" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const codeMatrix = buildDefaultMatrix();

    if (payload?.resetToDefaults) {
      const value = {
        source: "code",
        matrix: codeMatrix,
        updatedBy: user?.id || null,
      };

      const saved = await prisma.appSetting.upsert({
        where: { key: "rbac_matrix" },
        update: { value },
        create: { key: "rbac_matrix", value },
      });

      return NextResponse.json({
        ok: true,
        matrix: codeMatrix,
        meta: {
          source: "code",
          updatedAt: saved.updatedAt,
          updatedBy: user?.id || null,
        },
      });
    }

    const sanitized = sanitizeMatrix(payload?.matrix);
    const merged = { ...codeMatrix, ...sanitized };

    const value = {
      source: "db",
      matrix: merged,
      updatedBy: user?.id || null,
    };

    const saved = await prisma.appSetting.upsert({
      where: { key: "rbac_matrix" },
      update: { value },
      create: { key: "rbac_matrix", value },
    });

    return NextResponse.json({
      ok: true,
      matrix: merged,
      meta: {
        source: "db",
        updatedAt: saved.updatedAt,
        updatedBy: user?.id || null,
      },
    });
  } catch (err) {
    console.error("RBAC settings PUT failed:", err);
    return new NextResponse("Forbidden", { status: 403 });
  }
}
