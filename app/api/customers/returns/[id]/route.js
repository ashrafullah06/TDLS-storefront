export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = globalThis.__prisma__ ?? new PrismaClient();
if (!globalThis.__prisma__) globalThis.__prisma__ = prisma;

export async function GET(_req, { params }) {
  try {
    const id = params?.id;
    if (!id) return new NextResponse("missing id", { status: 400 });

    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      include: { lines: { include: { orderItem: true } }, order: true },
    });
    if (rr) return NextResponse.json({ kind: "return", data: rr });

    const ex = await prisma.exchangeRequest.findUnique({
      where: { id },
      include: {
        lines: { include: { fromOrderItem: true, toVariant: true } },
        order: true,
      },
    });
    if (ex) return NextResponse.json({ kind: "exchange", data: ex });

    return new NextResponse("not found", { status: 404 });
  } catch (err) {
    return new NextResponse(err?.message || "read error", { status: 500 });
  }
}
