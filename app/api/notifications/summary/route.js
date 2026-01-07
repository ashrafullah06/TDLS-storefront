// FILE: app/api/notifications/summary/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Notifications summary:
 * - counts by NotificationStatus
 */
export async function GET() {
  try {
    const statuses = ["QUEUED","DELIVERED","FAILED"];
    const counts = {};
    for (const s of statuses) {
      counts[s] = await prisma.notification.count({ where: { status: s } });
    }
    return NextResponse.json({ byStatus: counts });
  } catch (e) {
    return NextResponse.json({ error: "notifications summary unavailable", detail: String(e) }, { status: 503 });
  }
}
