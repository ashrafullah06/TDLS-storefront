// FILE: app/api/returns/actions/route.js
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const { action, id, note } = body || {};
  if (!action || !id) return NextResponse.json({ error: "action and id required" }, { status: 400 });

  const allowed = new Set(["approve","deny","mark_refunded","mark_exchanged"]);
  if (!allowed.has(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  try {
    const dataByAction = {
      approve: { status: "approved" },
      deny: { status: "denied" },
      mark_refunded: { status: "refunded" },
      mark_exchanged: { status: "exchanged" },
    }[action];

    const updated = await prisma.returnRequest.update({
      where: { id },
      data: { ...dataByAction, ...(note ? { adminNote: note } : {}) },
    });

    return NextResponse.json({ ok: true, item: updated });
  } catch (e) {
    return NextResponse.json({ error: "returns action unavailable", detail: String(e) }, { status: 503 });
  }
}
