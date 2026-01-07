
import { NextResponse } from "next/server";
import { getAvailabilityByVariantId } from "@/lib/catalog";

export async function GET(_req, { params }) {
  try {
    const { id } = params;
    const data = await getAvailabilityByVariantId(id);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
