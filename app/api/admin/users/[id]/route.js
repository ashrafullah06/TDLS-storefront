// PATH: app/api/admin/users/[id]/route.js

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { hasPermission, Permissions } from "@/lib/rbac";
import bcrypt from "bcryptjs";

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  // NEW: expose login preference + audit timestamps for admin UI
  loginPreference: true,
  lastLoginAt: true,
  lastRbacLoginAt: true,
  roles: { select: { role: { select: { name: true } } } },
  loyaltyAccount: {
    select: {
      tier: true,
      currentPoints: true,
      lifetimeEarned: true,
      lifetimeRedeemed: true,
    },
  },
  wallet: { select: { balance: true } },
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

/* ───────────────── GET: fetch single user ───────────────── */

export async function GET(req, { params }) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const id = String(params?.id || "");

    const user = await prisma.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });

    if (!user) return json({ ok: false, error: "not_found" }, 404);

    return json({ ok: true, user });
  } catch (e) {
    return json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      e?.status || 500,
    );
  }
}

/* ───────────────── PATCH: update user ───────────────── */

export async function PATCH(req, { params }) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const body = await req.json();
    const userId = String(params?.id || "");

    // Ensure user exists so we can return a clean 404 instead of a Prisma error
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      return json({ ok: false, error: "not_found" }, 404);
    }

    const data = {};

    if (typeof body.name === "string") {
      data.name = body.name.slice(0, 120);
    }
    if (typeof body.email === "string") {
      data.email = body.email || null;
    }
    if (typeof body.phone === "string") {
      data.phone = body.phone || null;
    }
    if (typeof body.isActive === "boolean") {
      data.isActive = body.isActive;
    }

    // Allow updating loginPreference (OTP / PASSWORD / TWO_FA)
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

    // allow multiple field names for password updates if you ever wire a UI
    const rawPassword =
      body.password || body.tempPassword || body.newPassword || null;
    if (rawPassword) {
      const salt = await bcrypt.genSalt(10);
      data.passwordHash = await bcrypt.hash(String(rawPassword), salt);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // update user base fields
      const u = await tx.user.update({ where: { id: userId }, data });

      // replace roles if provided
      if (Array.isArray(body.roles)) {
        const roleIds = [];

        for (const rawName of body.roles) {
          const name = String(rawName || "").trim().toLowerCase();
          if (!name) continue;

          const r = await tx.role.upsert({
            where: { name },
            update: {},
            create: { name },
          });
          roleIds.push(r.id);
        }

        if (roleIds.length) {
          // delete old roles not in new set
          await tx.userRole.deleteMany({
            where: { userId: u.id, NOT: { roleId: { in: roleIds } } },
          });

          // upsert new/current roles
          for (const roleId of roleIds) {
            await tx.userRole.upsert({
              where: { userId_roleId: { userId: u.id, roleId } },
              update: {},
              create: { userId: u.id, roleId },
            });
          }
        } else {
          // if empty array sent, remove all roles
          await tx.userRole.deleteMany({ where: { userId: u.id } });
        }
      }

      // NOTE: editDraft.requireRbacReauth is intentionally not persisted yet.
      // Hooking this into the RBAC OTP system would require coordinated changes
      // in the OTP flows and trust cookies, so we keep it as a UI-only flag for now.

      return u;
    });

    const safe = await prisma.user.findUnique({
      where: { id: updated.id },
      select: SAFE_USER_SELECT,
    });

    return json({ ok: true, user: safe });
  } catch (e) {
    const conflict = /Unique constraint failed|Unique constraint violation/i.test(
      e?.message || "",
    );
    return json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      conflict ? 409 : e?.status || 500,
    );
  }
}

/* ───────────────── DELETE: soft-delete user ───────────────── */

export async function DELETE(req, { params }) {
  try {
    const gate = await requireManageUsers(req);
    if (!gate.ok) return gate.res;

    const id = String(params?.id || "");

    // soft-delete by default (safer)
    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, isActive: true },
    });

    return json({ ok: true, user, softDeleted: true });
  } catch (e) {
    if (/Record to update not found/i.test(e?.message || "")) {
      return json({ ok: false, error: "not_found" }, 404);
    }
    return json(
      { ok: false, error: e?.message || "INTERNAL_ERROR" },
      e?.status || 500,
    );
  }
}
