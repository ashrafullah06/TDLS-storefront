// PATH: app/api/admin/users/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { hasPermission, Permissions } from "@/lib/rbac";
import bcrypt from "bcryptjs";

/**
 * Safe projection of a user row for admin UI.
 * IMPORTANT: keep this aligned with Prisma User model & admin UI expectations.
 */
const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,

  // expose login preference + audit timestamps to match admin UI
  loginPreference: true,
  lastLoginAt: true,
  lastRbacLoginAt: true,

  // Roles list (UserRole -> Role.name)
  roles: { select: { role: { select: { name: true } } } },

  // Loyalty snapshot
  loyaltyAccount: {
    select: {
      tier: true,
      currentPoints: true,
      lifetimeEarned: true,
      lifetimeRedeemed: true,
    },
  },

  // Wallet snapshot
  wallet: {
    select: {
      balance: true,
    },
  },
};

/* ───────────────── helpers ───────────────── */

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Normalize array of role names (strings) → lowercased, trimmed, uniques.
 */
function normalizeRoleNames(list) {
  if (!Array.isArray(list)) return [];
  const out = new Set();
  for (const r of list) {
    const n = String(r || "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return Array.from(out);
}

/**
 * Extract normalized role names from a session user object.
 */
function sessionUserRoles(sessionUser) {
  if (!sessionUser) return [];
  if (Array.isArray(sessionUser.roles)) {
    return normalizeRoleNames(sessionUser.roles);
  }
  if (typeof sessionUser.role === "string") {
    return normalizeRoleNames([sessionUser.role]);
  }
  return [];
}

async function requireManageUsers(req) {
  const { session } = await requireAuth(req);
  const user = session?.user;

  if (!user) {
    return {
      ok: false,
      res: json({ ok: false, error: "UNAUTHENTICATED" }, 401),
    };
  }

  const allowed = hasPermission(user, Permissions.MANAGE_USERS);
  if (!allowed) {
    return {
      ok: false,
      res: json({ ok: false, error: "FORBIDDEN" }, 403),
    };
  }

  return { ok: true, session };
}

/* ───────────────── GET: list users ───────────────── */

export async function GET(req) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)),
    );

    const where =
      q.length > 0
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {};

    const [total, users, allRoles] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: SAFE_USER_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      // extra: list of all role names known in DB, for admin UI dropdowns
      prisma.role.findMany({
        select: { name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    // derive canonical role list from results (lowercased, de-duplicated)
    const roleSet = new Set();
    for (const u of users) {
      const roles = Array.isArray(u.roles) ? u.roles : [];
      for (const ur of roles) {
        const n = String(ur?.role?.name || "").trim().toLowerCase();
        if (n) roleSet.add(n);
      }
    }
    const rolesFromPage = Array.from(roleSet).sort();

    const rolesFromDb = Array.from(
      new Set(allRoles.map((r) => String(r.name || "").trim().toLowerCase())),
    ).sort();

    const roles = Array.from(
      new Set([...rolesFromDb, ...rolesFromPage]),
    ).sort();

    return json({
      ok: true,
      data: {
        users,
        pagination: {
          page,
          pageSize,
          total,
          pageCount,
        },
        roles, // merged roles list
      },
      // extra top-level fields for any existing consumers
      page,
      pageSize,
      total,
      users,
    });
  } catch (e) {
    return json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      e?.status || 500,
    );
  }
}

/* ───────────────── POST: create user (by superadmin/admin) ───────────────── */

export async function POST(req) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const { session } = gate;
    const actor = session?.user || null;
    const actorRoles = sessionUserRoles(actor);
    const actorIsSuperadmin = actorRoles.includes("superadmin");

    const body = await req.json();

    // Normalise + trim inputs
    const email =
      typeof body.email === "string" && body.email.trim()
        ? body.email.trim()
        : null;
    const phone =
      typeof body.phone === "string" && body.phone.trim()
        ? body.phone.trim()
        : null;
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : null;

    /** base user data (aligned with Prisma User model) */
    const data = {
      email,
      phone,
      name,
      isActive: body.isActive !== false, // default true if not explicitly false
      // kind is left to default: CUSTOMER_ONLY (Prisma default)
    };

    // map loginPreference → enum (OTP / PASSWORD / TWO_FA)
    if (body.loginPreference || body.login_preference) {
      const raw = (
        body.loginPreference ||
        body.login_preference ||
        "OTP"
      )
        .toString()
        .toUpperCase();

      const allowed = new Set(["OTP", "PASSWORD", "TWO_FA"]);
      data.loginPreference = allowed.has(raw) ? raw : "OTP";
    }

    // Accept either tempPassword (from admin UI) or password
    const rawPassword = body.tempPassword || body.password;
    if (rawPassword) {
      const salt = await bcrypt.genSalt(10);
      data.passwordHash = await bcrypt.hash(String(rawPassword), salt);
    }

    // Determine roles BEFORE creation for security defaults
    const rawRoleNames =
      Array.isArray(body.roles) && body.roles.length ? body.roles : ["customer"];

    const roleNames = normalizeRoleNames(rawRoleNames);

    // ── Security: only a SUPERADMIN can create another superadmin ──
    if (roleNames.includes("superadmin") && !actorIsSuperadmin) {
      return json(
        {
          ok: false,
          error: "FORBIDDEN_SUPERADMIN_ASSIGN",
          message: "Only a superadmin can create or assign the 'superadmin' role.",
        },
        403,
      );
    }

    // UPGRADE: if no explicit loginPreference was provided,
    // default to TWO_FA for any staff/admin-like account, else OTP.
    if (!data.loginPreference) {
      const ADMINISH = new Set([
        "superadmin",
        "admin",
        "manager",
        "finance",
        "analyst",
        "staff",
        "support",
        "operations",
        "warehouse",
        "inventory_manager",
        "marketing",
        "content_manager",
        "dispatcher",
        "auditor",
        "readonly",
      ]);
      const hasAdminLike = roleNames.some((r) => ADMINISH.has(r));
      data.loginPreference = hasAdminLike ? "TWO_FA" : "OTP";
    }

    // Create user row
    const user = await prisma.user.create({ data });

    // Attach roles (create if missing). Default to "customer" if nothing survives.
    const effectiveRoleNames = roleNames.length ? roleNames : ["customer"];

    for (const safeName of effectiveRoleNames) {
      if (!safeName) continue;

      const role = await prisma.role.upsert({
        where: { name: safeName },
        update: {},
        create: { name: safeName },
      });

      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }

    // Reload safe projection for response (includes loyalty & wallet snapshot)
    const safe = await prisma.user.findUnique({
      where: { id: user.id },
      select: SAFE_USER_SELECT,
    });

    return json({ ok: true, user: safe }, 201);
  } catch (e) {
    const message = e?.message || "";
    const conflict = /Unique constraint failed|Unique constraint violation/i.test(
      message,
    );
    return json(
      { ok: false, error: message || "INTERNAL_ERROR" },
      conflict ? 409 : e?.status || 500,
    );
  }
}

/* ───────────────── PATCH: update user + roles (by superadmin/admin) ─────────────────
 *
 * Supports:
 *  - Updating name / email / phone / isActive / loginPreference
 *  - Changing roles (assigning/removing)
 *
 * Safety rules:
 *  - Only MANAGE_USERS is allowed (enforced by requireManageUsers).
 *  - Only a SUPERADMIN can:
 *      * assign/remove the "superadmin" role,
 *      * modify another superadmin's roles.
 *  - Never allow removal or deactivation of the **last active superadmin**.
 *  - Actor cannot demote themselves from superadmin if they are the last one.
 * ---------------------------------------------------------------------- */

export async function PATCH(req) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const { session } = gate;
    const actor = session?.user || null;
    const actorId = actor?.id || null;
    const actorRoles = sessionUserRoles(actor);
    const actorIsSuperadmin = actorRoles.includes("superadmin");

    const body = await req.json();

    const targetId = String(body.id || "").trim();
    if (!targetId) {
      return json(
        { ok: false, error: "MISSING_ID", message: "User id is required." },
        400,
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        isActive: true,
        loginPreference: true,
        roles: {
          select: {
            role: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!target) {
      return json(
        { ok: false, error: "NOT_FOUND", message: "User not found." },
        404,
      );
    }

    const targetRolesCurrent = normalizeRoleNames(
      (target.roles || []).map((r) => r?.role?.name),
    );
    const targetIsSuperadmin = targetRolesCurrent.includes("superadmin");

    // ── If target is a superadmin, only superadmin actor may touch ──
    if (targetIsSuperadmin && !actorIsSuperadmin) {
      return json(
        {
          ok: false,
          error: "FORBIDDEN_SUPERADMIN_EDIT",
          message: "Only a superadmin can modify another superadmin account.",
        },
        403,
      );
    }

    // Next-state roles if provided in payload
    const nextRolesProvided =
      Array.isArray(body.roles) && body.roles.length > 0;
    const nextRoles = nextRolesProvided
      ? normalizeRoleNames(body.roles)
      : targetRolesCurrent;

    const nextIncludesSuperadmin = nextRoles.includes("superadmin");

    // ── If payload tries to give superadmin to someone, require actorIsSuperadmin ──
    if (nextIncludesSuperadmin && !actorIsSuperadmin) {
      return json(
        {
          ok: false,
          error: "FORBIDDEN_SUPERADMIN_ASSIGN",
          message: "Only a superadmin can assign the 'superadmin' role.",
        },
        403,
      );
    }

    // ── Check last-superadmin safety if we are touching a superadmin ──
    let totalActiveSuperadmins = 0;
    if (targetIsSuperadmin || nextIncludesSuperadmin !== targetIsSuperadmin) {
      totalActiveSuperadmins = await prisma.userRole.count({
        where: {
          role: { name: "superadmin" },
          user: { isActive: true },
        },
      });
    }

    const isLastActiveSuperadmin =
      targetIsSuperadmin && totalActiveSuperadmins <= 1;

    // 1) Prevent deactivating last active superadmin
    if (
      isLastActiveSuperadmin &&
      body.isActive === false
    ) {
      return json(
        {
          ok: false,
          error: "CANNOT_DEACTIVATE_LAST_SUPERADMIN",
          message:
            "You cannot deactivate the last active superadmin account.",
        },
        400,
      );
    }

    // 2) Prevent removing superadmin role from last active superadmin
    if (
      isLastActiveSuperadmin &&
      nextRolesProvided &&
      !nextIncludesSuperadmin
    ) {
      return json(
        {
          ok: false,
          error: "CANNOT_DEMOTE_LAST_SUPERADMIN",
          message:
            "You cannot remove the 'superadmin' role from the last active superadmin.",
        },
        400,
      );
    }

    // 3) Prevent actor from demoting themselves from superadmin if they are last one
    if (
      actorIsSuperadmin &&
      actorId &&
      actorId === target.id &&
      isLastActiveSuperadmin &&
      nextRolesProvided &&
      !nextIncludesSuperadmin
    ) {
      return json(
        {
          ok: false,
          error: "CANNOT_SELF_DEMOTE_LAST_SUPERADMIN",
          message:
            "You cannot remove your own 'superadmin' role if you are the last active superadmin.",
        },
        400,
      );
    }

    // ── Build update payload ──
    const updateData = {};

    if (typeof body.name === "string") {
      const v = body.name.trim();
      if (v) updateData.name = v;
    }

    if (typeof body.email === "string") {
      const v = body.email.trim();
      updateData.email = v || null;
    }

    if (typeof body.phone === "string") {
      const v = body.phone.trim();
      updateData.phone = v || null;
    }

    if (typeof body.isActive === "boolean") {
      updateData.isActive = body.isActive;
    }

    if (body.loginPreference || body.login_preference) {
      const raw = (
        body.loginPreference ||
        body.login_preference
      )
        .toString()
        .toUpperCase();
      const allowed = new Set(["OTP", "PASSWORD", "TWO_FA"]);
      updateData.loginPreference = allowed.has(raw)
        ? raw
        : target.loginPreference || "OTP";
    }

    // Admin-set password change: tempPassword or password
    const rawPassword = body.tempPassword || body.password;
    if (rawPassword) {
      const salt = await bcrypt.genSalt(10);
      updateData.passwordHash = await bcrypt.hash(String(rawPassword), salt);
    }

    // Actually update user row (without roles first)
    const updatedUser = await prisma.user.update({
      where: { id: target.id },
      data: updateData,
    });

    // ── Roles update section ──
    if (nextRolesProvided) {
      // 1) Fetch all current role links for this user
      const currentUserRoles = await prisma.userRole.findMany({
        where: { userId: target.id },
        include: { role: true },
      });

      const currentRoleMap = new Map();
      for (const ur of currentUserRoles) {
        const n = String(ur?.role?.name || "").trim().toLowerCase();
        if (n) currentRoleMap.set(n, ur);
      }

      const nextSet = new Set(nextRoles);

      // 2) Remove roles that are not in nextRoles
      for (const [roleName, ur] of currentRoleMap.entries()) {
        if (!nextSet.has(roleName)) {
          await prisma.userRole.delete({
            where: {
              userId_roleId: {
                userId: target.id,
                roleId: ur.roleId,
              },
            },
          });
        }
      }

      // 3) Ensure each next role is attached (creating Role row if missing)
      for (const roleName of nextSet.values()) {
        if (!roleName) continue;

        const role = await prisma.role.upsert({
          where: { name: roleName },
          update: {},
          create: { name: roleName },
        });

        await prisma.userRole.upsert({
          where: {
            userId_roleId: {
              userId: target.id,
              roleId: role.id,
            },
          },
          update: {},
          create: {
            userId: target.id,
            roleId: role.id,
          },
        });
      }
    }

    // Reload safe projection for response
    const safe = await prisma.user.findUnique({
      where: { id: target.id },
      select: SAFE_USER_SELECT,
    });

    return json({ ok: true, user: safe });
  } catch (e) {
    const message = e?.message || "";
    const conflict = /Unique constraint failed|Unique constraint violation/i.test(
      message,
    );
    return json(
      { ok: false, error: message || "INTERNAL_ERROR" },
      conflict ? 409 : e?.status || 500,
    );
  }
}
