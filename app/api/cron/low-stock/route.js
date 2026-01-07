import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function GET() {
  try {
    const prisma = await getPrisma();
    const INV = M("Inventory");
    const threshold = Number(process.env.LOW_STOCK_THRESHOLD || 5);
    const rows = await prisma[INV.model].findMany();
    const low = rows.map(r => ({
      id: r.id,
      sku: r[INV.sku],
      variantId: r[INV.variantId],
      onHand: Number(r[INV.onHand] || 0),
      reserved: Number(r[INV.reserved] || 0),
      available: Number(r[INV.onHand] || 0) - Number(r[INV.reserved] || 0)
    })).filter(x => x.available <= threshold);

    return NextResponse.json({ ok: true, threshold, items: low });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
