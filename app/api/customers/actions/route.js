// FILE: app/api/customers/actions/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { action, id, note } = body || {};
  if (!action || !id) return NextResponse.json({ error: "action and id required" }, { status: 400 });

  try {
    if (action === "ban") {
      const updated = await prisma.customer.update({ where: { id }, data: { banned: true } });
      return NextResponse.json({ ok: true, item: updated });
    }
    if (action === "unban") {
      const updated = await prisma.customer.update({ where: { id }, data: { banned: false } });
      return NextResponse.json({ ok: true, item: updated });
    }
    if (action === "add_note") {
      const updated = await prisma.customer.update({ where: { id }, data: { adminNote: note || "" } });
      return NextResponse.json({ ok: true, item: updated });
    }
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "customer action unavailable", detail: String(e) }, { status: 503 });
  }
}
