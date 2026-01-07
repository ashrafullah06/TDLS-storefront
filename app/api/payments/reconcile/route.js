// FILE: app/api/payments/reconcile/route.js
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST() {
  try {
    // Minimal internal reconciliation example:
    // Mark any authorized-but-captured payments, update providers' unsettledAmount, etc.
    // This assumes payment & paymentProvider schemas. If not present => 503.
    await prisma.$transaction(async (trx) => {
      // Example: sum unsettled captured payments per provider
      const providers = await trx.paymentProvider.findMany({ select: { id: true, code: true } });

      for (const p of providers) {
        // captured, not settled
        const captured = await trx.payment.aggregate({
          where: { providerCode: p.code, status: "captured", settled: false },
          _sum: { amount: true },
        });
        const unsettled = Number(captured?._sum?.amount || 0);
        await trx.paymentProvider.update({ where: { id: p.id }, data: { unsettledAmount: unsettled } });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "reconcile unavailable (payment/paymentProvider models missing)", detail: String(e) },
      { status: 503 }
    );
  }
}
