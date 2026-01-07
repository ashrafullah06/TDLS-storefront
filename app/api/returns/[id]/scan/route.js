import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function POST(req, { params }) {
  try {
    const { variantId, sku, qty = 1 } = await req.json();
    if (!variantId && !sku) return NextResponse.json({ ok: false, error: "variantId or sku required" }, { status: 400 });

    const prisma = await getPrisma();
    const RTN = M("Return");
    const RTNI = M("ReturnItem");
    const INV = M("Inventory");

    let vId = variantId;
    if (!vId && sku) {
      const found = await prisma[INV.model].findFirst({ where: { [INV.sku]: sku } });
      if (!found) return NextResponse.json({ ok: false, error: "SKU not recognized" }, { status: 404 });
      vId = found[INV.variantId];
    }

    const exists = await prisma[RTN.model].findUnique({ where: { id: Number(params.id) } });
    if (!exists) return NextResponse.json({ ok: false, error: "Return not found" }, { status: 404 });

    const created = await prisma[RTNI.model].create({
      data: { [RTNI.returnId]: Number(params.id), [RTNI.variantId]: vId, [RTNI.qty]: Number(qty) }
    });

    return NextResponse.json({ ok: true, item: created });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
