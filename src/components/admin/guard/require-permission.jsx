// FILE: src/components/admin/guard/require-permission.jsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

/**
 * RequirePermission — hardened client-side RBAC gate (ADMIN PLANE).
 *
 * Supports BOTH call styles:
 *  1) <RequirePermission user={session.user} need={["VIEW_ANALYTICS"]}>...</RequirePermission>
 *  2) <RequirePermission user={adminSessionPayload} need={["view_analytics"]}>...</RequirePermission>
 *
 * Admin session payload (preferred) comes from /api/admin/session:
 *  - payload.user.displayRole / payload.primaryRole
 *  - payload.roles[]
 *  - payload.permissions[]
 *  - payload.user.permissions[]
 *  - payload.user.roles[]
 */

function toStr(v) {
  return v == null ? "" : String(v);
}

function normalizeRole(r) {
  return toStr(r).trim().toLowerCase();
}

/**
 * Canonical permission normalization:
 * - trims
 * - lowercases
 * - converts spaces/dashes to underscores
 * - keeps underscores (VIEW_ANALYTICS -> view_analytics)
 */
function normalizePerm(p) {
  let s = toStr(p).trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "_").replace(/-/g, "_");
  return s.toLowerCase();
}

/**
 * Accept either:
 * - user-like object (already session.user)
 * - full admin session payload { user: {...}, roles, permissions, primaryRole ... }
 *
 * We merge safely so roles/permissions are discoverable.
 */
function normalizeUserInput(input) {
  if (!input || typeof input !== "object") return null;

  const nestedUser =
    input.user && typeof input.user === "object" ? input.user : null;

  if (!nestedUser) return input;

  return {
    ...nestedUser,

    // merge top-level RBAC fields if nested user doesn't contain them
    roles: nestedUser.roles ?? input.roles ?? input.roleNames ?? undefined,
    roleAssignments:
      nestedUser.roleAssignments ??
      input.roleAssignments ??
      input.assignments ??
      undefined,
    permissions:
      nestedUser.permissions ?? input.permissions ?? input.perms ?? undefined,

    // primary role / display role
    primaryRole:
      nestedUser.primaryRole ??
      nestedUser.displayRole ??
      input.primaryRole ??
      input.role ??
      input.displayRole ??
      undefined,

    // keep scope if present anywhere
    scope: nestedUser.scope ?? input.scope ?? undefined,
  };
}

function extractRolesFromAny(user) {
  const out = [];

  // 1) roles arrays: ["superadmin"] OR [{name}] OR [{role:{name}}]
  const rawRoles = user?.roles ?? null;
  if (Array.isArray(rawRoles)) {
    for (const x of rawRoles) {
      if (!x) continue;
      if (typeof x === "string") out.push(x);
      else out.push(x?.name || x?.role?.name || x?.roleName || x?.slug || "");
    }
  } else if (typeof rawRoles === "string") {
    out.push(rawRoles);
  }

  // 2) roleAssignments/assignments arrays: [{name}] OR [{role:{name}}]
  const rawAssignments =
    user?.roleAssignments ?? user?.assignments ?? user?.assignment ?? null;
  if (Array.isArray(rawAssignments)) {
    for (const x of rawAssignments) {
      if (!x) continue;
      if (typeof x === "string") out.push(x);
      else out.push(x?.name || x?.role?.name || x?.roleName || "");
    }
  } else if (typeof rawAssignments === "string") {
    out.push(rawAssignments);
  }

  // 3) single-role fields (Prisma-backed session often exposes displayRole/primaryRole)
  const pr =
    user?.displayRole ??
    user?.primaryRole ??
    user?.role ??
    user?.roleName ??
    null;

  if (typeof pr === "string" && pr.trim()) out.push(pr);

  // de-dupe CI
  const seen = new Set();
  const cleaned = [];
  for (const r of out) {
    const v = toStr(r).trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(v);
  }

  return cleaned;
}

function extractPermsFromAny(user) {
  const raw =
    user?.permissions ??
    user?.perms ??
    user?.permission ??
    user?.permissionSet ??
    user?.rbac?.permissions ??
    null;

  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") arr = [raw];

  // de-dupe CI
  const seen = new Set();
  const cleaned = [];
  for (const p of arr) {
    const v = toStr(p).trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(v);
  }
  return cleaned;
}

function isSuperRole(rolesLowerSet) {
  return (
    rolesLowerSet.has("superadmin") ||
    rolesLowerSet.has("owner") ||
    rolesLowerSet.has("root")
  );
}

function safeBack(router) {
  try {
    if (typeof window !== "undefined" && window.history?.length > 1) {
      router.back();
      return;
    }
  } catch {}
  router.push("/admin");
}

export default function RequirePermission({
  user,
  need = [],
  children,

  /**
   * Behavior when user is not yet available (loading / not fetched):
   * - "skeleton": render a minimal placeholder (default)
   * - "null": render nothing
   * - "deny": show denial UI (not recommended)
   */
  whenNoUser = "skeleton",
}) {
  const router = useRouter();

  const needs = useMemo(() => {
    const n = Array.isArray(need) ? need : [need];
    return n.map(normalizePerm).filter(Boolean);
  }, [need]);

  // If nothing required, pass-through.
  if (!needs.length) return children;

  const u = useMemo(() => normalizeUserInput(user), [user]);

  // If user not ready, DO NOT deny (denial often triggers chains that feel like logout).
  if (!u) {
    if (whenNoUser === "null") return null;
    if (whenNoUser === "deny") {
      return (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          সেশন পাওয়া যাচ্ছে না—অনুগ্রহ করে আবার চেষ্টা করুন।
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
        Checking access…
      </div>
    );
  }

  // Optional scope sanity: if someone accidentally passes customer session into admin guard
  const scope = normalizeRole(u?.scope);
  if (scope && scope !== "admin") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold">Admin session required.</div>
        <div className="mt-1 text-amber-800">
          Please sign in to the admin panel.
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => router.push("/admin/login?redirect=/admin")}
            className="inline-flex items-center justify-center rounded-full border border-amber-300 bg-white px-4 py-2 text-amber-900 shadow-sm hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            Go to Admin Login
          </button>
        </div>
      </div>
    );
  }

  // Roles (case-insensitive)
  const roles = extractRolesFromAny(u);
  const roleSet = new Set(roles.map(normalizeRole));

  // ✅ hard bypass for super roles (never block)
  if (isSuperRole(roleSet)) return children;

  // Permissions (canonicalized)
  const perms = extractPermsFromAny(u).map(normalizePerm);
  const permSet = new Set(perms);

  // Check required permissions
  const missing = [];
  for (const want of needs) {
    if (!permSet.has(want)) missing.push(want);
  }

  if (missing.length) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => safeBack(router)}
            className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-amber-300 bg-white text-amber-900 shadow-sm hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
            title="Go back"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <div className="min-w-0">
            <div className="font-semibold">
              আপনি এই পাতায় প্রবেশের অনুমতি পাননি।
            </div>
            <div className="mt-1 text-amber-800">
              Missing permission:{" "}
              <span className="font-mono">{missing.join(", ")}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
