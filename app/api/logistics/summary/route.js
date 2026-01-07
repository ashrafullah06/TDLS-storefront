// FILE: app/api/logistics/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Logistics summary:
 * - shipment counts by ShipmentStatus
 */
export async function GET() {
  try {
    const statuses = ["PENDING","LABEL_CREATED","IN_TRANSIT","OUT_FOR_DELIVERY","DELIVERED","FAILED","RETURNED"];
    const counts = {};
    for (const s of statuses) {
      counts[s] = await prisma.shipment.count({ where: { status: s } });
    }
    return NextResponse.json({ byStatus: counts });
  } catch (e) {
    return NextResponse.json({ error: "logistics summary unavailable", detail: String(e) }, { status: 503 });
  }
}
