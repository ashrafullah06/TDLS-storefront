// FILE: app/api/customers/notifications/prefs/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

async function getCustomerId(req) {
  try {
    const { getServerSession } = await import("next-auth");
    let authOptions;

    // Prefer the existing shim you confirmed: src/lib/authoptions.js
    try {
      ({ authOptions } = await import("@/lib/authoptions"));
    } catch {}

    // Backward compatibility: some older code paths may still export named authOptions from "@/lib/auth"
    try {
      ({ authOptions } = await import("@/lib/auth"));
    } catch {}

    const session = await getServerSession(authOptions);
    return session?.user?.id || session?.user?.sub || null;
  } catch {
    return null;
  }
}

/**
 * GET  -> { prefs: [{type, channel, enabled}] }
 * POST -> { changes: [{type, channel, enabled}] }
 */
export async function GET(req) {
  const userId = await getCustomerId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId },
      select: { type: true, channel: true, enabled: true },
    });
    return NextResponse.json({ prefs });
  } catch (e) {
    return NextResponse.json(
      { error: "prefs unavailable", detail: String(e) },
      { status: 503 }
    );
  }
}

export async function POST(req) {
  const userId = await getCustomerId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { changes = [] } = body || {};
  if (!Array.isArray(changes) || changes.length === 0) {
    return NextResponse.json({ error: "changes required" }, { status: 400 });
  }

  try {
    await Promise.all(
      changes.map((c) =>
        prisma.notificationPreference.upsert({
          where: { userId_type_channel: { userId, type: c.type, channel: c.channel } },
          update: { enabled: !!c.enabled },
          create: { userId, type: c.type, channel: c.channel, enabled: !!c.enabled },
        })
      )
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "update prefs failed", detail: String(e) },
      { status: 503 }
    );
  }
}
