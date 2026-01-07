// FILE: app/api/cms/prisma/status/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const DB_TIMEOUT_MS = 2000;

async function pingDb() {
  // minimal "is DB alive?" query
  return prisma.$queryRaw`SELECT 1`;
}

export async function GET() {
  try {
    const result = await Promise.race([
      pingDb(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT_MS)
      ),
    ]);

    // If we reach here without throwing, DB responded
    const db =
      process.env.DATABASE_URL
        ? new URL(process.env.DATABASE_URL.split("?")[0]).host
        : "unknown";

    return NextResponse.json(
      { status: "ok", db },
      {
        status: 200,
      }
    );
  } catch (e) {
    const message = String(e?.message || e);
    const status = message === "DB_TIMEOUT" ? 504 : 503;

    return NextResponse.json(
      {
        status: "error",
        error: message,
      },
      { status }
    );
  }
}
