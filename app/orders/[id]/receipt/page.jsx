// my-project/app/orders/[id]/receipt/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import Script from "next/script";

import CartClearOnReceipt from "@/components/checkout/cart-clear-on-receipt";
// import ReceiptDownloadButton from "@/components/checkout/receipt-download-button"; // replaced with direct <a> for production-safe download
import ReceiptPrintButton from "@/components/checkout/receipt-print-button";
import Navbar from "@/components/common/navbar";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";

import { auth } from "@/lib/auth";

/* ───────── helpers ───────── */

function money(n, currency = "BDT") {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return currency === "BDT" ? "৳ 0.00" : `${currency} 0.00`;
  const abs = Math.abs(x).toFixed(2);
  const sign = x < 0 ? "-" : "";
  if (currency === "BDT") return `${sign}৳ ${abs}`;
  return `${sign}${currency} ${abs}`;
}

const PAIDLIKE = new Set(["PAID", "SETTLED", "CAPTURED", "SUCCEEDED", "AUTHORIZED"]);

const sumPaid = (payments = []) =>
  payments.reduce((s, p) => {
    const st = String(p?.status || "").toUpperCase();
    return PAIDLIKE.has(st) ? s + Number(p.amount || 0) : s;
  }, 0);

const safe = (v) => (v == null || v === "" ? "—" : v);

const toNum = (v, fallback = NaN) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const safeVal = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
};

const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    const sv = safeVal(v);
    if (sv !== null) {
      const s = typeof sv === "string" ? sv.trim() : String(sv);
      if (s) return s;
    }
  }
  return "";
};

const fmtTs = (d) => {
  try {
    return new Date(d).toLocaleString("en-GB");
  } catch {
    return "—";
  }
};

const ABS = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base =
    process.env.NEXT_PUBLIC_STRAPI_API_URL ||
    process.env.NEXT_PUBLIC_STRAPI_ORIGIN ||
    process.env.STRAPI_API_URL ||
    process.env.STRAPI_URL ||
    "";
  if (!base) return u;
  return `${base.replace(/\/+$/, "")}${u.startsWith("/") ? "" : "/"}${u}`;
};

function deriveSizeColorFromVariantOptions(variant) {
  const out = { size: null, color: null };
  if (!variant || !Array.isArray(variant.optionValues)) return out;

  for (const link of variant.optionValues) {
    const ov = link?.optionValue;
    const opt = ov?.option;
    if (!ov || !opt) continue;

    const name = String(opt.name || "").toLowerCase();
    const value = ov.value;
    if (!value) continue;

    if (!out.size && name.includes("size")) out.size = value;
    if (!out.color && (name.includes("color") || name.includes("colour") || name.includes("colorway"))) {
      out.color = value;
    }
  }

  return out;
}

function computePaymentMode(order) {
  if (order?.paymentMethod) return String(order.paymentMethod).replace(/_/g, " ");
  if (order?.payments?.[0]?.provider) return String(order.payments[0].provider).replace(/_/g, " ");

  const st = String(order?.paymentStatus || "").toUpperCase();
  if (st === "UNPAID" || st === "PENDING") return "CASH ON DELIVERY";

  return "—";
}

function getOrderSnapshot(order) {
  const md = order?.metadata || order?.meta || order?.data || order?.snapshot || null;
  if (!md || typeof md !== "object") return null;

  return (
    md.cartSnapshot ||
    md.cart_snapshot ||
    md.checkoutSnapshot ||
    md.checkout_snapshot ||
    md.orderSnapshot ||
    md.order_snapshot ||
    md.snapshot ||
    md
  );
}

function getMirroredTotals(order, snap) {
  const pickTotals = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const t = obj?.totals || obj?.summary || obj?.amounts || null;
    if (!t || typeof t !== "object") return null;

    const subtotal = toNum(t.subtotal, NaN);
    const shippingTotal = toNum(t.shippingTotal ?? t.shipping, NaN);
    const discountTotal = toNum(t.discountTotal ?? t.discounts, NaN);
    const taxTotal = toNum(t.taxTotal ?? t.vat ?? t.tax, NaN);
    const grandTotal = toNum(t.grandTotal ?? t.total, NaN);

    const meaningful =
      (Number.isFinite(subtotal) && subtotal > 0) ||
      (Number.isFinite(grandTotal) && grandTotal > 0) ||
      (Number.isFinite(shippingTotal) && shippingTotal > 0) ||
      (Number.isFinite(taxTotal) && taxTotal > 0) ||
      (Number.isFinite(discountTotal) && discountTotal !== 0);

    if (!meaningful) return null;

    return {
      subtotal: Number.isFinite(subtotal) ? subtotal : null,
      shippingTotal: Number.isFinite(shippingTotal) ? shippingTotal : null,
      discountTotal: Number.isFinite(discountTotal) ? discountTotal : null,
      taxTotal: Number.isFinite(taxTotal) ? taxTotal : null,
      grandTotal: Number.isFinite(grandTotal) ? grandTotal : null,
    };
  };

  const snapTotals = pickTotals(snap) || pickTotals(snap?.cartSnapshot) || pickTotals(snap?.cart_snapshot) || null;

  const subtotal = Number.isFinite(toNum(order?.subtotal, NaN)) ? toNum(order.subtotal, 0) : 0;
  const shippingTotal = Number.isFinite(toNum(order?.shippingTotal, NaN)) ? toNum(order.shippingTotal, 0) : 0;
  const discountTotal = Number.isFinite(toNum(order?.discountTotal, NaN)) ? toNum(order.discountTotal, 0) : 0;
  const taxTotal = Number.isFinite(toNum(order?.taxTotal, NaN)) ? toNum(order.taxTotal, 0) : 0;
  const grandTotal = Number.isFinite(toNum(order?.grandTotal, NaN)) ? toNum(order.grandTotal, 0) : 0;

  return {
    subtotal: snapTotals?.subtotal != null ? snapTotals.subtotal : subtotal,
    shippingTotal: snapTotals?.shippingTotal != null ? snapTotals.shippingTotal : shippingTotal,
    discountTotal: snapTotals?.discountTotal != null ? snapTotals.discountTotal : discountTotal,
    taxTotal: snapTotals?.taxTotal != null ? snapTotals.taxTotal : taxTotal,
    grandTotal: snapTotals?.grandTotal != null ? snapTotals.grandTotal : grandTotal,
  };
}

function buildSnapshotIndex(snapshot) {
  const idx = new Map();
  if (!snapshot || typeof snapshot !== "object") return idx;

  const candidates = [];
  if (Array.isArray(snapshot.lines)) candidates.push(...snapshot.lines);
  if (Array.isArray(snapshot.items)) candidates.push(...snapshot.items);
  if (snapshot.cartSnapshot && Array.isArray(snapshot.cartSnapshot.items)) candidates.push(...snapshot.cartSnapshot.items);
  if (snapshot.cart_snapshot && Array.isArray(snapshot.cart_snapshot.items)) candidates.push(...snapshot.cart_snapshot.items);

  for (const l of candidates) {
    const lineId = firstNonEmpty(l?.lineId, l?.line_id, l?.id);
    const variantId = firstNonEmpty(l?.variantId, l?.variant_id, l?.vid);
    const sku = firstNonEmpty(l?.sku, l?.metadata?.sku);
    const title = firstNonEmpty(l?.title, l?.name);

    if (lineId) idx.set(`lineId:${String(lineId)}`, l);
    if (variantId) idx.set(`variantId:${String(variantId)}`, l);
    if (sku) idx.set(`sku:${String(sku)}`, l);
    if (variantId && sku) idx.set(`variantSku:${String(variantId)}::${String(sku)}`, l);
    if (variantId && title) idx.set(`variantTitle:${String(variantId)}::${String(title)}`, l);
  }
  return idx;
}

function findSnapshotLineForItem(it, snapshotIdx) {
  if (!snapshotIdx || !(snapshotIdx instanceof Map) || snapshotIdx.size === 0) return null;

  const lineId = firstNonEmpty(it?.lineId, it?.line_id);
  const variantId = firstNonEmpty(it?.variantId, it?.variant_id, it?.vid, it?.variant?.id);
  const sku = firstNonEmpty(it?.sku, it?.variant?.sku, it?.metadata?.sku, it?.meta?.sku);
  const title = firstNonEmpty(it?.title, it?.variant?.title, it?.variant?.product?.title, it?.name);

  if (lineId && snapshotIdx.has(`lineId:${String(lineId)}`)) return snapshotIdx.get(`lineId:${String(lineId)}`);
  if (variantId && sku && snapshotIdx.has(`variantSku:${String(variantId)}::${String(sku)}`))
    return snapshotIdx.get(`variantSku:${String(variantId)}::${String(sku)}`);
  if (variantId && title && snapshotIdx.has(`variantTitle:${String(variantId)}::${String(title)}`))
    return snapshotIdx.get(`variantTitle:${String(variantId)}::${String(title)}`);
  if (variantId && snapshotIdx.has(`variantId:${String(variantId)}`)) return snapshotIdx.get(`variantId:${String(variantId)}`);
  if (sku && snapshotIdx.has(`sku:${String(sku)}`)) return snapshotIdx.get(`sku:${String(sku)}`);

  return null;
}

function extractSnapshotPricing(it, snapshotLine) {
  const md = it?.metadata || it?.meta || it?.data || null;
  const smd = snapshotLine?.metadata || snapshotLine?.meta || snapshotLine?.data || null;

  const qty = Math.max(1, toNum(it?.quantity, 1));

  const lineTotalCandidate = [
    snapshotLine?.lineTotal,
    snapshotLine?.line_total,
    snapshotLine?.subtotal,
    snapshotLine?.total,

    smd?.lineTotal,
    smd?.line_total,
    smd?.subtotal,
    smd?.total,

    it?.lineTotal,
    it?.line_total,
    it?.subtotal,
    it?.total,

    md?.lineTotal,
    md?.line_total,
    md?.subtotal,
    md?.total,
  ]
    .map((v) => toNum(v, NaN))
    .find((n) => Number.isFinite(n));

  const unitPriceCandidate = [
    snapshotLine?.unitPrice,
    snapshotLine?.unit_price,
    snapshotLine?.priceAtPurchase,
    snapshotLine?.price_at_purchase,
    snapshotLine?.selectedUnitPrice,
    snapshotLine?.selected_unit_price,

    smd?.unitPrice,
    smd?.unit_price,
    smd?.priceAtPurchase,
    smd?.price_at_purchase,
    smd?.selectedUnitPrice,
    smd?.selected_unit_price,

    it?.unitPrice,
    it?.unit_price,
    it?.priceAtPurchase,
    it?.price_at_purchase,
    it?.selectedUnitPrice,
    it?.selected_unit_price,

    md?.unitPrice,
    md?.unit_price,
    md?.priceAtPurchase,
    md?.price_at_purchase,
    md?.selectedUnitPrice,
    md?.selected_unit_price,
  ]
    .map((v) => toNum(v, NaN))
    .find((n) => Number.isFinite(n));

  let unitPrice = Number.isFinite(unitPriceCandidate) ? unitPriceCandidate : NaN;
  let lineTotal = Number.isFinite(lineTotalCandidate) ? lineTotalCandidate : NaN;

  if (!Number.isFinite(lineTotal) && Number.isFinite(unitPrice) && qty > 0) {
    lineTotal = Number((unitPrice * qty).toFixed(2));
  }

  if (Number.isFinite(lineTotal) && lineTotal === 0 && Number.isFinite(unitPrice) && unitPrice > 0 && qty > 0) {
    lineTotal = Number((unitPrice * qty).toFixed(2));
  }

  if (!Number.isFinite(unitPrice) && Number.isFinite(lineTotal) && qty > 0) {
    unitPrice = Number((lineTotal / qty).toFixed(2));
  }

  if (!Number.isFinite(unitPrice)) unitPrice = 0;
  if (!Number.isFinite(lineTotal)) lineTotal = 0;

  return { qty, unitPrice, lineTotal };
}

function groupOrderItems(rawItems = [], snapshotIdx) {
  const byKey = new Map();

  for (const it of rawItems) {
    const v = it?.variant || null;
    const p = v?.product || null;

    const title = it?.title || v?.title || p?.title || p?.name || it?.sku || "Item";
    const variantId = firstNonEmpty(it?.variantId, v?.id, it?.sku, it?.id, "nv");

    const snapLine = findSnapshotLineForItem(it, snapshotIdx);
    const { qty, unitPrice, lineTotal } = extractSnapshotPricing(it, snapLine);

    const key = `${variantId}::${title}::${unitPrice}`;

    if (!byKey.has(key)) {
      byKey.set(key, { ...it, quantity: qty, _unitPrice: unitPrice, _lineTotal: lineTotal });
    } else {
      const grouped = byKey.get(key);
      grouped.quantity += qty;
      grouped._lineTotal = toNum(grouped._lineTotal, 0) + toNum(lineTotal, 0);
    }
  }

  return Array.from(byKey.values());
}

function computeItemsSubtotal(orderItems) {
  return (orderItems || []).reduce((sum, it) => {
    const qty = Math.max(1, toNum(it?.quantity, 1));
    const unit = toNum(it?._unitPrice, 0);
    const line = toNum(it?._lineTotal, NaN);

    const effectiveLine =
      Number.isFinite(line) && !(line === 0 && unit > 0 && qty > 0) ? line : Number((unit * qty).toFixed(2));

    return sum + toNum(effectiveLine, 0);
  }, 0);
}

const CUSTOMER_SAFE_EVENT_KINDS = new Set([
  "CREATED",
  "PLACED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "STATUS_CHANGED",
  "PAYMENT_STATUS",
  "FULFILLMENT_STATUS",
  "SHIPMENT_BOOKED",
  "SHIPMENT_UPDATED",
  "RECEIPT_ISSUED",
]);

function normalizeEventKind(k) {
  return String(k || "").toUpperCase().trim();
}

function prettyKind(kind) {
  const k = normalizeEventKind(kind);
  if (!k) return "Update";
  if (k === "STATUS_CHANGED") return "Status Update";
  if (k === "PAYMENT_STATUS") return "Payment Update";
  if (k === "FULFILLMENT_STATUS") return "Fulfillment Update";
  if (k === "SHIPMENT_BOOKED") return "Shipment Booked";
  if (k === "SHIPMENT_UPDATED") return "Shipment Update";
  if (k === "RECEIPT_ISSUED") return "Receipt Issued";
  if (k === "CREATED") return "Order Created";
  return k.replace(/_/g, " ");
}

/* ───────── filename helpers (download-safe) ───────── */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function safeFilenamePart(input, fallback = "Customer") {
  const raw = String(input || "").trim() || fallback;
  return raw
    .replace(/[\/\\:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function dhakaParts(dateLike) {
  try {
    const d = new Date(dateLike);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Dhaka",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);

    const get = (t) => parts.find((p) => p.type === t)?.value || "00";
    return { dd: get("day"), mm: get("month"), yy: get("year"), HH: get("hour"), MI: get("minute"), SS: get("second") };
  } catch {
    const d = new Date(dateLike);
    return {
      dd: pad2(d.getDate()),
      mm: pad2(d.getMonth() + 1),
      yy: String(d.getFullYear()).slice(-2),
      HH: pad2(d.getHours()),
      MI: pad2(d.getMinutes()),
      SS: pad2(d.getSeconds()),
    };
  }
}

// Note: "dd/mm/yy" cannot be used in filenames because "/" is invalid on Windows.
// We use dd-mm-yy (same meaning) and keep everything deterministic and safe.
function buildReceiptFilename({ placedAt, customerName, orderNumber }) {
  const { dd, mm, yy, HH, MI, SS } = dhakaParts(placedAt || Date.now());
  const who = safeFilenamePart(customerName, "Customer").replace(/\s+/g, "_");
  const ord = safeFilenamePart(orderNumber || "", "").replace(/\s+/g, "_");
  const base = ord
    ? `TDLS-${dd}-${mm}-${yy}_${HH}-${MI}-${SS}-${who}-${ord}`
    : `TDLS-${dd}-${mm}-${yy}_${HH}-${MI}-${SS}-${who}`;
  return `${base}.pdf`;
}

/* ───────── server component ───────── */

export default async function ReceiptPage({ params }) {
  const p = await params;
  const id = String(p?.id || "");
  if (!id) return notFound();

  const session = await auth().catch(() => null);
  const isLoggedIn = Boolean(session?.user?.id);

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      shippingAddress: true,
      billingAddress: true,
      items: {
        include: {
          variant: {
            include: {
              product: true,
              media: { include: { media: true } },
              optionValues: { include: { optionValue: { include: { option: true } } } },
            },
          },
        },
      },
      payments: true,
      events: { orderBy: { at: "desc" }, take: 30 },
    },
  });

  if (!order) return notFound();

  const orderSnap = getOrderSnapshot(order);
  const snapIdx = buildSnapshotIndex(orderSnap);

  const currency = String(firstNonEmpty(orderSnap?.currency, orderSnap?.cartSnapshot?.currency, order.currency, "BDT"));
  const orderItems = groupOrderItems(order.items || [], snapIdx);

  const productsCount = orderItems.length;
  const itemsCount = orderItems.reduce((s, it) => s + Math.max(0, toNum(it?.quantity, 0)), 0);

  const t = getMirroredTotals(order, orderSnap);
  const itemsSubtotal = computeItemsSubtotal(orderItems);

  let subtotal = toNum(t.subtotal, 0);
  let shipping = toNum(t.shippingTotal, 0);
  const discountAbs = Math.max(0, Math.abs(toNum(t.discountTotal, 0)));
  let tax = toNum(t.taxTotal, 0);
  let grand = toNum(t.grandTotal, 0);

  if (subtotal === 0 && itemsSubtotal > 0) subtotal = itemsSubtotal;
  if (grand === 0 && itemsSubtotal > 0) {
    grand = Math.max(0, subtotal - discountAbs + shipping + tax);
  }

  const paid = sumPaid(order.payments || []);
  const amountDue = Math.max(grand - paid, 0);

  const mode = computePaymentMode(order);
  const placedAt = fmtTs(order.placedAt || order.createdAt);

  const events = Array.isArray(order.events) ? order.events : [];
  const customerTimeline = events.filter((e) => CUSTOMER_SAFE_EVENT_KINDS.has(normalizeEventKind(e?.kind))).slice(0, 10);

  const rawName = firstNonEmpty(order.user?.name, order.shippingAddress?.name, order.billingAddress?.name) || "";
  const rawPhone = firstNonEmpty(order.user?.phone, order.shippingAddress?.phone, order.billingAddress?.phone) || "";
  const rawEmail = firstNonEmpty(order.user?.email, order.shippingAddress?.email, order.billingAddress?.email) || "";

  const displayName = rawName;
  const displayPhone = rawPhone;
  const displayEmail = rawEmail;

  const downloadParams = new URLSearchParams();
  downloadParams.set("orderNumber", String(order.orderNumber || order.id));
  if (rawEmail) downloadParams.set("email", String(rawEmail));
  else if (rawPhone) downloadParams.set("phone", String(rawPhone));

  const downloadName = buildReceiptFilename({
    placedAt: order.placedAt || order.createdAt,
    customerName: displayName || "Customer",
    orderNumber: String(order.orderNumber || ""),
  });

  downloadParams.set("filename", downloadName);

  const invoiceHref = `/api/orders/${encodeURIComponent(order.id)}/invoice?${downloadParams.toString()}`;

  return (
    <>
      <Navbar />

      <main id="receipt-main" className="bg-[#F6F8FC] pt-32 pb-[260px] print:bg-white print:pt-0 print:pb-0">
        <CartClearOnReceipt />

        <div className="mx-auto w-full max-w-[720px] px-5 print:max-w-[740px] print:px-4">
          <div id="tdls-receipt-print" className="receipt">
            <div className="rx-head">
              <div className="brand">
                <div className="logo">TDLS</div>
                <div className="tag">Premium Order Receipt</div>
                <div className="tag tiny">
                  Products: {productsCount} • Items: {itemsCount}
                </div>
              </div>
              <div className="right">
                <img
                  src={`/api/orders/${encodeURIComponent(order.id)}/barcode.png`}
                  alt="Order barcode"
                  className="barcode"
                  draggable={false}
                />
                <div className="code">#{safe(order.orderNumber)}</div>
              </div>
            </div>

            <hr className="cut" />

            <section className="blk">
              <h3>Delivery (Shipping)</h3>
              <div className="grid2">
                <div>
                  <div className="title">{safe(displayName)}</div>
                  <div className="line">{safe(displayPhone)}</div>
                  <div className="line break">{safe(displayEmail)}</div>
                </div>
                <div>
                  {order.shippingAddress ? (
                    <>
                      <div className="line">
                        {order.shippingAddress.line1}
                        {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}
                      </div>
                      <div className="line">
                        {order.shippingAddress.city}
                        {order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ""}{" "}
                        {order.shippingAddress.postalCode || ""}
                      </div>
                      <div className="line">{order.shippingAddress.countryIso2}</div>
                      {order.shippingAddress.phone ? <div className="line">{order.shippingAddress.phone}</div> : null}
                    </>
                  ) : (
                    <div className="line">—</div>
                  )}
                </div>
              </div>
            </section>

            <hr className="dash" />

            <section className="blk">
              <div className="focus">
                <div className="col">
                  <div className="kv">
                    <div className="k">Payment Status</div>
                    <div className="v">{safe(order.paymentStatus)}</div>
                  </div>
                  <div className="kv">
                    <div className="k">Payment Mode</div>
                    <div className="v">{safe(mode)}</div>
                  </div>
                </div>
                <div className="due">
                  <div className="k">Amount to Pay</div>
                  <div className="amt">{money(amountDue, currency)}</div>
                </div>
              </div>
            </section>

            <hr className="dash" />

            <section className="blk">
              <h3>Order Information</h3>
              <div className="info3">
                <Info label="Order Number" value={`#${safe(order.orderNumber)}`} />
                <Info label="Order ID" value={order.id} />
                <Info label="Placed At" value={placedAt} />
                <Info label="Currency" value={safe(currency)} />
                <Info label="Customer ID" value={order.user?.id ? safe(order.user.id) : "Guest"} />
                <Info label="Order Status" value={safe(order.status)} />
              </div>
            </section>

            {customerTimeline.length > 0 && (
              <>
                <hr className="dash" />
                <section className="blk">
                  <h3>Updates & Timeline</h3>
                  <div className="timeline">
                    {customerTimeline.map((e) => (
                      <div key={e.id} className="tl">
                        <div className="tl-dot" />
                        <div className="tl-main">
                          <div className="tl-top">
                            <div className="tl-kind">{prettyKind(e.kind)}</div>
                            <div className="tl-time mono">{fmtTs(e?.at || e?.createdAt || e?.updatedAt)}</div>
                          </div>
                          {e?.message ? <div className="tl-msg">{String(e.message)}</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}

            <hr className="dash" />

            <section className="blk">
              <h3>Order Summary</h3>
              <div className="sum">
                <Row label="Payment Status" value={safe(order.paymentStatus)} />
                <Row label="Fulfillment" value={safe(order.fulfillmentStatus)} />
                <Row label="Paid Amount" value={money(paid, currency)} mono />
                <Row label="Subtotal" value={money(subtotal, currency)} mono />
                <Row label="Shipping Charge" value={money(shipping, currency)} mono />
                <Row
                  label="Discounts"
                  value={discountAbs > 0 ? `- ${money(discountAbs, currency)}` : money(0, currency)}
                  mono
                />
                <Row label="VAT" value={money(tax, currency)} mono />
                <Row label="Grand Total" value={money(grand, currency)} strong mono />
              </div>
            </section>

            <hr className="dash" />

            <section className="blk">
              <h3>Items</h3>
              <ul className="items">
                {orderItems.map((it) => {
                  const v = it.variant || null;
                  const p = v?.product || null;
                  const { size: derivedSize, color: derivedColor } = deriveSizeColorFromVariantOptions(v);

                  const qty = Math.max(1, toNum(it.quantity, 1));
                  const unit = toNum(it._unitPrice, 0);
                  const rawLine = toNum(it._lineTotal, NaN);

                  const effectiveLine =
                    Number.isFinite(rawLine) && !(rawLine === 0 && unit > 0 && qty > 0)
                      ? rawLine
                      : Number((unit * qty).toFixed(2));

                  const title = it.title || v?.title || p?.title || p?.name || it.sku || "Item";
                  const size = firstNonEmpty(it.size, v?.sizeLabel, p?.sizeLabel, derivedSize);
                  const color = firstNonEmpty(it.color, v?.colorLabel, p?.colorLabel, derivedColor);

                  const sku = firstNonEmpty(it.sku, v?.sku, p?.sku, p?.slug);
                  const barcode = firstNonEmpty(v?.barcode, p?.barcode);
                  const pid = firstNonEmpty(p?.id != null ? String(p.id) : null, p?.slug);
                  const vid = v?.id != null ? String(v.id) : it.variantId || null;

                  let thumbUrl = null;
                  let thumbAlt = title;
                  if (Array.isArray(v?.media) && v.media.length > 0) {
                    const mediaLink = v.media.find((m) => m?.media?.url) || v.media[0];
                    if (mediaLink?.media?.url) {
                      thumbUrl = ABS(mediaLink.media.url);
                      thumbAlt = mediaLink.media.alt || title;
                    }
                  }

                  return (
                    <li key={it.id} className="item">
                      <div className="item-left">
                        {thumbUrl && (
                          <div className="thumb-wrap">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumbUrl} alt={thumbAlt} className="thumb" draggable={false} />
                          </div>
                        )}
                        <div className="item-main">
                          <div className="title">{safe(title)}</div>

                          {(size || color) && (
                            <div className="meta meta-attrs">
                              {size && (
                                <>
                                  <span>Size: {safe(size)}</span>
                                  {color && <span>•</span>}
                                </>
                              )}
                              {color && <span>Color: {safe(color)}</span>}
                            </div>
                          )}

                          {(sku || barcode || pid || vid) && (
                            <div className="meta meta-codes">
                              {sku && <span>SKU: {safe(sku)}</span>}
                              {barcode && (
                                <>
                                  <span>•</span>
                                  <span>Barcode: {safe(barcode)}</span>
                                </>
                              )}
                              {pid && (
                                <>
                                  <span>•</span>
                                  <span>PID: {safe(pid)}</span>
                                </>
                              )}
                              {vid && (
                                <>
                                  <span>•</span>
                                  <span>VID: {safe(vid)}</span>
                                </>
                              )}
                            </div>
                          )}

                          <div className="meta meta-price mono">
                            <span>Qty: {qty}</span>
                            <span>•</span>
                            <span>Unit: {money(unit, currency)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="right mono">{money(effectiveLine, currency)}</div>
                    </li>
                  );
                })}

                {orderItems.length === 0 && (
                  <li className="item">
                    <div className="left">No items.</div>
                  </li>
                )}
              </ul>
            </section>

            <hr className="dash" />

            <section className="blk">
              <h3>Billing Address</h3>
              <div className="line">
                {order.billingAddress ? (
                  <>
                    {order.billingAddress.line1}
                    {order.billingAddress.line2 ? `, ${order.billingAddress.line2}` : ""}
                    <br />
                    {order.billingAddress.city}
                    {order.billingAddress.state ? `, ${order.billingAddress.state}` : ""}{" "}
                    {order.billingAddress.postalCode || ""}
                    <br />
                    {order.billingAddress.countryIso2}
                    {order.billingAddress.phone ? (
                      <>
                        <br />
                        {order.billingAddress.phone}
                      </>
                    ) : null}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </section>

            <hr className="cut" />

            <div className="foot">
              <div className="note">
                <b>Delivery &amp; Security:</b> Inspect packaging upon delivery. Never share OTPs or sensitive
                information. Official communications come only from verified TDLS channels.
              </div>

              <div className="actions no-print">
                <a
                  id="tdls-receipt-download"
                  href={invoiceHref}
                  className="btn"
                  download={downloadName}
                  data-filename={downloadName}
                >
                  Download Receipt
                </a>

                <ReceiptPrintButton className="btn" />

                {isLoggedIn ? (
                  <Link href="/customer/dashboard" className="btn alt">
                    My Orders
                  </Link>
                ) : null}

                <Link href="/product" className="btn">
                  Continue Shopping
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="h-24" />

        <Script
          id="tdls-receipt-download-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  var a = document.getElementById("tdls-receipt-download");
  if (!a) return;

  var busy = false;

  function isIOS(){
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  }

  a.addEventListener("click", function(e){
    if (busy) { e.preventDefault(); return; }

    var href = a.getAttribute("href") || "";
    if (!href) return;

    // iOS Safari: blob-download is unreliable/restricted.
    // Let the browser handle it (API must set Content-Disposition: attachment).
    if (isIOS()) return;

    var filename = a.getAttribute("download") || (a.dataset && a.dataset.filename) || "TDLS-receipt.pdf";

    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;

    e.preventDefault();
    busy = true;

    try { a.setAttribute("aria-busy","true"); } catch(_){}

    (async function(){
      try{
        var res = await fetch(href, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8" }
        });

        if (!res || !res.ok) throw new Error("HTTP_" + (res ? res.status : "0"));

        var ct = String(res.headers.get("content-type") || "").toLowerCase();
        var blob = await res.blob();

        // Hard validation: never download HTML/text errors as a file.
        // Check both content-type and actual PDF signature.
        var looksPdf = ct.indexOf("pdf") !== -1 || (blob && String(blob.type || "").toLowerCase().indexOf("pdf") !== -1);
        if (!looksPdf) {
          var head = await blob.slice(0, 4).text().catch(function(){ return ""; });
          if (head !== "%PDF") throw new Error("NON_PDF");
        }

        var url = URL.createObjectURL(blob);
        var tmp = document.createElement("a");
        tmp.href = url;
        tmp.download = filename;
        tmp.style.display = "none";
        document.body.appendChild(tmp);

        tmp.click();

        // Delay revoke: prevents Chrome download history "site not available".
        setTimeout(function(){
          try{ URL.revokeObjectURL(url); }catch(_){}
          try{ tmp.remove(); }catch(_){}
        }, 6000);

      }catch(err){
        // Fallback: navigate directly (still same-origin); relies on server headers.
        try{ window.location.assign(href); }catch(_){}
      }finally{
        busy = false;
        try { a.removeAttribute("aria-busy"); } catch(_){}
      }
    })();
  }, { passive: false });
})();
            `,
          }}
        />

        <style>{`
          .receipt{background:#fff;border-radius:18px;box-shadow:0 12px 40px rgba(15,33,71,.10);padding:18px 18px 16px;border:1px solid rgba(15,33,71,.08)}
          .rx-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
          .brand .logo{font-weight:800;letter-spacing:.12em;color:#0F2147;font-size:18px}
          .brand .tag{color:rgba(15,33,71,.75);font-size:12px;margin-top:2px}
          .brand .tiny{font-size:11px;opacity:.75}
          .right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
          .barcode{width:150px;height:auto;object-fit:contain}
          .code{font-weight:700;color:#0F2147}
          hr.cut{border:0;border-top:2px solid rgba(15,33,71,.12);margin:12px 0}
          hr.dash{border:0;border-top:1px dashed rgba(15,33,71,.18);margin:12px 0}
          .blk h3{font-weight:800;color:#0F2147;font-size:13px;margin:0 0 8px}
          .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
          .line{color:rgba(15,33,71,.85);font-size:12px;line-height:1.35}
          .break{word-break:break-word}
          .title{font-weight:800;color:#0F2147;font-size:13px;margin-bottom:2px}
          .focus{display:flex;justify-content:space-between;gap:12px;align-items:stretch}
          .kv{margin-bottom:8px}
          .k{font-size:11px;color:rgba(15,33,71,.65)}
          .v{font-size:12px;color:#0F2147;font-weight:700}
          .due{min-width:180px;border:1px solid rgba(212,175,55,.35);background:rgba(212,175,55,.10);border-radius:14px;padding:10px 12px}
          .amt{font-size:16px;font-weight:900;color:#0F2147;margin-top:2px}
          .info3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
          .info .v{font-weight:800;font-size:12px}
          .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
          .sum{display:flex;flex-direction:column;gap:8px}
          .row{display:flex;justify-content:space-between;gap:10px}
          .row .k{font-size:12px;color:rgba(15,33,71,.70)}
          .row .v{font-size:12px;color:#0F2147}
          .row .v.strong{font-size:13px;font-weight:900}
          .items{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
          .item{display:flex;justify-content:space-between;gap:12px;border:1px solid rgba(15,33,71,.10);border-radius:14px;padding:10px 10px}
          .item-left{display:flex;gap:10px;min-width:0}
          .thumb-wrap{width:52px;height:52px;border-radius:12px;overflow:hidden;border:1px solid rgba(15,33,71,.10);flex:0 0 auto}
          .thumb{width:100%;height:100%;object-fit:cover}
          .item-main{min-width:0}
          .meta{font-size:11px;color:rgba(15,33,71,.70);display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
          .foot{margin-top:10px}
          .note{font-size:11px;color:rgba(15,33,71,.70);line-height:1.35}
          .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
          .btn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:999px;border:1px solid rgba(15,33,71,.18);background:#0F2147;color:#fff;font-weight:800;font-size:12px;text-decoration:none}
          .btn.alt{background:#fff;color:#0F2147}
          .timeline{display:flex;flex-direction:column;gap:10px}
          .tl{display:flex;gap:10px}
          .tl-dot{width:8px;height:8px;border-radius:99px;background:#D4AF37;margin-top:6px;flex:0 0 auto}
          .tl-main{min-width:0;flex:1}
          .tl-top{display:flex;justify-content:space-between;gap:10px}
          .tl-kind{font-weight:900;color:#0F2147;font-size:12px}
          .tl-time{font-size:11px;color:rgba(15,33,71,.60)}
          .tl-msg{font-size:11px;color:rgba(15,33,71,.75);margin-top:2px}
          @media (max-width: 640px){
            .grid2{grid-template-columns:1fr}
            .info3{grid-template-columns:1fr 1fr}
            .focus{flex-direction:column}
            .due{width:100%}
            .barcode{width:130px}
          }
          @media print{
            @page{margin:6mm}
            #receipt-main{padding-top:0 !important;padding-bottom:0 !important;background:#fff !important}
            .no-print{display:none !important}
            body *{visibility:hidden !important}
            #tdls-receipt-print, #tdls-receipt-print *{visibility:visible !important}
            #tdls-receipt-print{position:absolute;left:0;top:0;width:100%}
            .receipt{box-shadow:none !important;border:0 !important}
            hr.cut, hr.dash{opacity:.9}
            html, body{background:#fff !important}
          }
        `}</style>
      </main>

      <BottomFloatingBar />
    </>
  );
}

function Info({ label, value }) {
  return (
    <div className="info">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

function Row({ label, value, strong = false, mono = false }) {
  return (
    <div className="row">
      <div className="k">{label}</div>
      <div className={`v ${strong ? "strong" : ""} ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
