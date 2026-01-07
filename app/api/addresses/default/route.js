// my-project/app/api/addresses/default/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function POST(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const { addressId } = await req.json().catch(() => ({}));
    if (!addressId) return NextResponse.json({ ok: false, error: "address_id_required" }, { status: 400 });

    const saved = await prisma.$transaction(async tx => {
      const target = await tx.address.findFirst({ where: { id: addressId, userId, archivedAt: null } });
      if (!target) return null;
      await tx.address.updateMany({ where: { userId, archivedAt: null }, data: { isDefault: false } });
      const updated = await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
      await tx.user.update({ where: { id: userId }, data: { defaultAddressId: updated.id } });
      return updated;
    });

    if (!saved) return NextResponse.json({ ok: false, error: "address_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, data: saved }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
