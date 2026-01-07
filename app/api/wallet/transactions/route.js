// PATH: app/api/wallet/transactions/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAuth } from "@/lib/auth"; // ✅ use existing helper
import { ensureWalletAndAccount, walletDelta } from "@/lib/loyalty";

export const dynamic = "force-dynamic";

/* ───────────── RBAC: admin-only guard (local helper) ───────────── */
async function requireAdmin() {
  // Support both patterns: requireAuth() -> user OR { user }
  const me = await requireAuth();
  const user = me?.user || me;

  if (!user) {
    return { error: new NextResponse("Unauthorized", { status: 401 }) };
  }

  const roles = new Set();

  if (user.role) roles.add(String(user.role));
  if (Array.isArray(user.roles)) {
    for (const r of user.roles) roles.add(String(r));
  }
  if (user.roleName) roles.add(String(user.roleName));

  const upperRoles = Array.from(roles).map((r) => r.toUpperCase());
  const isAdmin = upperRoles.some((r) =>
    ["ADMIN", "SUPERADMIN", "SUPER_ADMIN", "OWNER"].includes(r)
  );

  if (!isAdmin) {
    return { error: new NextResponse("Forbidden", { status: 403 }) };
  }

  return { user };
}

/* ───────────── GET: list wallet transactions ───────────── */
export async function GET(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: {
      txns: {
        orderBy: { createdAt: "desc" },
        take: 200,
      },
    },
  });

  if (!wallet) {
    const { wallet: w } = await ensureWalletAndAccount(userId, prisma);
    return NextResponse.json({ balance: w.balance, txns: [] });
  }

  return NextResponse.json({
    balance: wallet.balance,
    txns: wallet.txns || [],
  });
}

/* ───────────── POST: adjust wallet balance ───────────── */
export async function POST(req) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const { userId, amount, reason, reference, metadata } = body || {};

  if (!userId || typeof amount !== "number") {
    return NextResponse.json(
      { error: "userId and numeric amount required" },
      { status: 400 }
    );
  }

  const newBalance = await walletDelta(
    userId,
    amount,
    reason || "ADJUST",
    reference || "manual",
    metadata || {},
    prisma
  );

  return NextResponse.json({ ok: true, balance: newBalance });
}
