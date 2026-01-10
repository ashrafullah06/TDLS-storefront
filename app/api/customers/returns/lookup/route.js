// app/api/customers/returns/lookup/route.js
export const runtime = "nodejs";

import { NextResponse } from "next/server";

let prisma = globalThis.__prisma__ || null;

async function getPrisma() {
  if (prisma) return prisma;

  // IMPORTANT: dynamic import prevents build-time Prisma initialization failures
  const prismaMod = await import("@/lib/prisma");
  const prismaClient = prismaMod?.default ?? prismaMod?.prisma ?? prismaMod;

  prisma = globalThis.__prisma__ ?? prismaClient;
  if (!globalThis.__prisma__) globalThis.__prisma__ = prisma;

  return prisma;
}

// util: normalize decimal to number
function d(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v);
  if (v?.toNumber) return Number(v.toNumber());
  return Number(v);
}

export async function GET(req) {
  try {
    const prisma = await getPrisma();

    const { searchParams } = new URL(req.url);
    const order_no = searchParams.get("order_no") || "";
    const invoice_no = searchParams.get("invoice_no") || "";
    const product_no = searchParams.get("product_no") || "";
    const sku = searchParams.get("sku") || "";
    const barcode = searchParams.get("barcode") || "";

    // build prisma filters (order/orderitem side)
    const order_filters = [];
    const item_filters = [];

    // our order model has orderNumber (Int autoincrement) and id (cuid)
    if (order_no) {
      const n = parseInt(order_no, 10);
      if (!Number.isNaN(n)) order_filters.push({ orderNumber: n });
      order_filters.push({ id: order_no });
    }

    if (invoice_no) {
      // if you store invoice number in metadata or notes:
      order_filters.push({ notes: { contains: invoice_no } });
      // adjust if you keep a dedicated invoice field elsewhere
    }

    if (sku) {
      item_filters.push({ sku });
      item_filters.push({ variant: { sku } });
    }
    if (barcode) {
      item_filters.push({ variant: { barcode } });
    }
    if (product_no) {
      item_filters.push({ variantId: product_no });
      item_filters.push({ title: { contains: product_no } });
    }

    // fetch orders possibly matching
    const orders = await prisma.order.findMany({
      where: order_filters.length ? { OR: order_filters } : undefined,
      include: {
        items: {
          where: item_filters.length ? { OR: item_filters } : undefined,
          include: { variant: true },
        },
        shipments: true,
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });

    const items = [];
    for (const o of orders) {
      const delivered = o.shipments?.find((s) => s.status === "DELIVERED");
      const delivered_at = delivered?.createdAt || null;
      const row_items = o.items?.length ? o.items : [];
      for (const it of row_items) {
        items.push({
          order_id: o.id,
          order_no: String(o.orderNumber),
          invoice_no: invoice_no || null,
          order_item_id: it.id,
          product_no: it.variantId || it.id,
          product_name: it.title || it.variant?.title || null,
          sku: it.sku || it.variant?.sku || null,
          barcode: it.variant?.barcode || null,
          quantity: it.quantity,
          unit_price: d(it.unitPrice),
          delivery_date: delivered_at ? delivered_at.toISOString() : null,
        });
      }
    }

    // if nothing found in prisma, optionally try strapi rest (if env provided)
    if (items.length === 0 && process.env.STRAPI_API_URL && process.env.STRAPI_API_TOKEN) {
      try {
        // minimal example by order_id (adjust filters as needed)
        const qs = [];
        if (order_no) qs.push(`filters[order_id][$eq]=${encodeURIComponent(order_no)}`);
        const url = `${process.env.STRAPI_API_URL.replace(/\/+$/, "")}/api/orders?${qs.join(
          "&"
        )}&populate=orders_components,orders_components.component`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${process.env.STRAPI_API_TOKEN}` },
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          const data = Array.isArray(json?.data) ? json.data : [];
          for (const row of data) {
            const oid = row?.attributes?.order_id || row?.id;
            // pull minimal info; extend mapping as needed
            items.push({
              order_id: String(oid),
              order_no: String(oid),
              invoice_no: invoice_no || null,
              order_item_id: null,
              product_no: product_no || null,
              product_name: null,
              sku: sku || null,
              barcode: barcode || null,
              quantity: 1,
              unit_price: 0,
              delivery_date: null,
            });
          }
        }
      } catch (_) {}
    }

    return NextResponse.json({ items });
  } catch (err) {
    return new NextResponse(err?.message || "lookup error", { status: 500 });
  }
}
