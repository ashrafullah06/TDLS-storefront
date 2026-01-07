import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function POST(req) {
  try {
    const body = await req.json();
    const { orderId, carrier = "manual", note } = body;
    if (!orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });

    const prisma = await getPrisma();
    const SH = M("Shipment");

    const created = await prisma[SH.model].create({
      data: {
        [SH.orderId]: orderId,
        [SH.carrier]: carrier,
        [SH.tracking]: body.tracking || null,
        [SH.labelUrl]: body.labelUrl || null,
        [SH.status]: "created",
        note: note || null
      }
    });

    return NextResponse.json({ ok: true, shipment: created });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
