import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function POST(_req, { params }) {
  try {
    const prisma = await getPrisma();
    const RTN = M("Return");
    const updated = await prisma[RTN.model].update({
      where: { id: Number(params.id) },
      data: { [RTN.status]: "approved" }
    });
    return NextResponse.json({ ok: true, return: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
