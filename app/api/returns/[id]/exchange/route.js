import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function POST(req, { params }) {
  try {
    const { replacementVariantId, qty = 1 } = await req.json();
    if (!replacementVariantId) return NextResponse.json({ ok: false, error: "replacementVariantId required" }, { status: 400 });

    const prisma = await getPrisma();
    const RTN = M("Return");
    const ORD = M("Order");
    const row = await prisma[RTN.model].findUnique({ where: { id: Number(params.id) } });
    if (!row) return NextResponse.json({ ok: false, error: "Return not found" }, { status: 404 });

    const replacement = await prisma[ORD.model].create({
      data: { [ORD.status]: "created", [ORD.customerId]: row[ORD.customerId] || null, note: `Exchange for return ${params.id}` }
    });

    return NextResponse.json({ ok: true, replacementOrder: replacement });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
