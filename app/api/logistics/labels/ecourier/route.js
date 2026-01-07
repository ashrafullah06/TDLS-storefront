// app/api/logistics/labels/ecourier/route.js
import { NextResponse } from "next/server";

/**
 * Create an eCourier order
 * Docs: POST /order-place with headers API-KEY, API-SECRET, USER-ID (JSON) 
 */
const BASE = process.env.ECOURIER_BASE_URL; // e.g. https://ecourier.com.bd/api or https://staging.ecourier.com.bd/api
const KEY = process.env.ECOURIER_API_KEY;
const SECRET = process.env.ECOURIER_API_SECRET;
const USER = process.env.ECOURIER_USER_ID;

function ecHeaders() {
  if (!BASE || !KEY || !SECRET || !USER) {
    throw new Error("Missing ECOURIER_* environment variables");
  }
  return {
    "API-KEY": KEY,
    "API-SECRET": SECRET,
    "USER-ID": USER,
    "Content-Type": "application/json",
  };
}

export async function POST(req) {
  try {
    const body = await req.json();
    // Required by eCourier for order-place:
    // recipient_name, recipient_mobile, recipient_city, recipient_thana, recipient_area, recipient_address,
    // package_code, product_price, payment_method, recipient_zip
    const payload = {
      recipient_name: body.recipient_name,
      recipient_mobile: body.recipient_mobile,
      recipient_city: body.recipient_city,
      recipient_thana: body.recipient_thana,
      recipient_area: body.recipient_area,
      recipient_address: body.recipient_address,
      package_code: body.package_code,
      product_price: Number(body.product_price),
      payment_method: body.payment_method, // COD | POS | MPAY | CCRD
      recipient_zip: String(body.recipient_zip),
      // optional eCourier fields:
      parcel_type: body.parcel_type || "BOX",
      requested_delivery_time: body.requested_delivery_time || undefined,
      product_id: body.product_id || undefined,
      pick_address: body.pick_address || undefined,
      pick_hub: body.pick_hub ? Number(body.pick_hub) : undefined,
      comments: body.comments || undefined,
      number_of_item: body.number_of_item ? Number(body.number_of_item) : undefined,
      actual_product_price: body.actual_product_price ? Number(body.actual_product_price) : undefined,
    };

    const res = await fetch(`${BASE}/order-place`, {
      method: "POST",
      headers: ecHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "ecourier order failed", detail: data }, { status: res.status });
    }
    // Successful response includes ECR id in key "ID" per docs.
    return NextResponse.json({ ok: true, ecr_id: data.ID, raw: data });
  } catch (err) {
    return NextResponse.json({ error: "ecourier create error", detail: String(err?.message || err) }, { status: 500 });
  }
}
