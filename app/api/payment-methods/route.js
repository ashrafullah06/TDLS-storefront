// FILE: app/api/payment-methods/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export async function GET(req) {
  try {
    await requireAuth(req); // optional: allow guest (your current code calls it; will 401 if no session)
    return NextResponse.json({
      ok: true,
      methods: [
        { code: "SSL_COMMERZ", label: "SSLCommerz", enabled: true },
        { code: "BKASH", label: "bKash", enabled: true },
        { code: "NAGAD", label: "Nagad", enabled: true },
        { code: "CASH_ON_DELIVERY", label: "Cash on Delivery", enabled: true },
      ],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
