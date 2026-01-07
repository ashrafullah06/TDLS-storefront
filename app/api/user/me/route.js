// app/api/user/me/route.js
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma-client";
import { requireAuth } from "../../../../lib/auth";
import { ensureWalletAndAccount } from "../../../../lib/loyalty";

export async function GET(req) {
  try {
    const { userId } = await requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, phone: true, name: true, gender: true, dob: true, isActive: true,
        addresses: true,
        loyaltyAccount: { select: { currentPoints: true, lifetimeEarned: true, lifetimeRedeemed: true, tier: true } },
        wallet: { select: { balance: true } },
      },
    });
    await ensureWalletAndAccount(userId);
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}

export async function PUT(req) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const data = {};
    if (typeof body.name === "string") data.name = body.name.slice(0, 120);
    if (["male","female","other","prefer_not_to_say"].includes((body.gender||"").toLowerCase())) data.gender = body.gender;
    if (body.phone) data.phone = String(body.phone).slice(0, 30);
    if (body.dob) data.dob = new Date(body.dob);

    const user = await prisma.user.update({ where: { id: userId }, data });
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    const code = String(e.message||"").includes("Unique constraint failed") ? 409 : (e.status||500);
    return NextResponse.json({ ok: false, error: e.message }, { status: code });
  }
}
