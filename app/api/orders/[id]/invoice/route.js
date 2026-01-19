export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ---------- helpers ---------- */

function isAdmin(roles) {
  const arr = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const set = new Set(arr.map((r) => String(r || "").toLowerCase()));
  return set.has("admin") || set.has("superadmin");
}

function money(n, currency = "BDT") {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "৳0.00";
  const sym =
    currency === "BDT"
      ? "৳"
      : currency === "USD"
      ? "$"
      : currency === "EUR"
      ? "€"
      : currency === "GBP"
      ? "£"
      : currency + " ";
  return `${sym}${x.toFixed(2)}`;
}

function encodeRFC5987ValueChars(str) {
  // filename* needs RFC5987 encoding
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A")
    .replace(/%(7C|60|5E)/g, (m) => m.toLowerCase());
}

function textResponse(body, status = 200, filename = "invoice.txt") {
  const safeName = String(filename || "invoice.txt").replace(/[\r\n"]/g, "");
  const encoded = encodeRFC5987ValueChars(safeName);

  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // strong download behavior across browsers (incl iOS/Safari)
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`,
      "x-content-type-options": "nosniff",
      // hard no-cache for receipts (prevents stale or blocked downloads)
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

const PAIDLIKE = new Set([
  "PAID",
  "SETTLED",
  "CAPTURED",
  "SUCCEEDED",
  "AUTHORIZED",
]);

function sumPaid(payments = []) {
  return payments.reduce((sum, p) => {
    const st = String(p?.status || "").toUpperCase();
    return PAIDLIKE.has(st) ? sum + Number(p.amount || 0) : sum;
  }, 0);
}

function computePaymentMode(order) {
  // 1) canonical column saved by /api/checkout/create-order
  if (order?.paymentMethod) {
    return String(order.paymentMethod).replace(/_/g, " ");
  }

  // 2) first gateway provider (if any)
  if (order?.payments?.[0]?.provider) {
    return String(order.payments[0].provider).replace(/_/g, " ");
  }

  // 3) fallback: assume COD for unpaid / pending
  const st = String(order?.paymentStatus || "").toUpperCase();
  if (st === "UNPAID" || st === "PENDING") return "CASH ON DELIVERY";

  return "—";
}

/* small safe helpers */

const toNum = (v, fallback = 0) => {
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

function normEmail(v) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

function normPhone(v) {
  // digits-only compare (Bangladesh formats, +880, etc.)
  return String(v || "").replace(/\D/g, "");
}

function looksHighEntropyId(id) {
  const s = String(id || "");
  // cuid/uuid are typically long; this blocks short numeric ids
  if (s.length >= 20) return true;
  if (s.includes("-") && s.length >= 18) return true;
  return false;
}

function safeDateParts(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) {
    return { dateStr: "—", timeStr: "—" };
  }

  const dateOpts = { year: "numeric", month: "short", day: "numeric" };
  const timeOpts = { hour: "2-digit", minute: "2-digit" };

  // Try en-BD; fall back safely (Intl on some servers can be limited)
  let dateStr = "—";
  let timeStr = "—";

  try {
    dateStr = d.toLocaleDateString("en-BD", dateOpts);
  } catch {
    try {
      dateStr = d.toLocaleDateString("en-GB", dateOpts);
    } catch {
      dateStr = d.toISOString().slice(0, 10);
    }
  }

  try {
    timeStr = d.toLocaleTimeString("en-BD", timeOpts);
  } catch {
    try {
      timeStr = d.toLocaleTimeString("en-GB", timeOpts);
    } catch {
      timeStr = d.toISOString().slice(11, 16);
    }
  }

  return { dateStr, timeStr };
}

/**
 * Derive size & color from variant.optionValues when metadata is empty
 * (same idea as in /api/cart/items).
 */
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

    if (!out.size && name.includes("size")) {
      out.size = value;
    }
    if (
      !out.color &&
      (name.includes("color") ||
        name.includes("colour") ||
        name.includes("colorway"))
    ) {
      out.color = value;
    }
  }

  return out;
}

/* ---------- Guest access helpers ---------- */

function getReqAccessKey(req) {
  try {
    const u = new URL(req.url);
    const q = u.searchParams;

    const qp =
      q.get("key") ||
      q.get("k") ||
      q.get("token") ||
      q.get("t") ||
      q.get("receipt") ||
      q.get("receipt_key") ||
      q.get("receiptKey") ||
      q.get("access_key") ||
      q.get("accessKey") ||
      "";

    const hp =
      req.headers.get("x-order-receipt-key") ||
      req.headers.get("x-receipt-key") ||
      req.headers.get("x-guest-order-key") ||
      req.headers.get("x-access-key") ||
      "";

    const out = String(qp || hp || "").trim();
    return out || "";
  } catch {
    return "";
  }
}

function collectOrderAccessKeys(order) {
  const keys = [];

  // common scalar fields (safe to probe; if absent => undefined)
  const candidates = [
    order?.receiptKey,
    order?.receipt_key,
    order?.invoiceToken,
    order?.invoice_token,
    order?.receiptToken,
    order?.receipt_token,
    order?.publicToken,
    order?.public_token,
    order?.accessToken,
    order?.access_token,
    order?.checkoutToken,
    order?.checkout_token,
    order?.guestToken,
    order?.guest_token,
    order?.guestKey,
    order?.guest_key,
  ];

  candidates.forEach((v) => {
    const s = String(v || "").trim();
    if (s) keys.push(s);
  });

  // metadata keys (very common for guest flows)
  const md = order?.metadata && typeof order.metadata === "object" ? order.metadata : null;
  if (md) {
    const mdCandidates = [
      md.receiptKey,
      md.receipt_key,
      md.invoiceToken,
      md.invoice_token,
      md.receiptToken,
      md.receipt_token,
      md.publicToken,
      md.public_token,
      md.accessToken,
      md.access_token,
      md.checkoutToken,
      md.checkout_token,
      md.guestToken,
      md.guest_token,
      md.guestKey,
      md.guest_key,
    ];
    mdCandidates.forEach((v) => {
      const s = String(v || "").trim();
      if (s) keys.push(s);
    });
  }

  // de-dup
  return Array.from(new Set(keys));
}

function guestIdentityMatch(req, order) {
  const u = new URL(req.url);
  const q = u.searchParams;

  const qOrderNumber = String(q.get("orderNumber") || q.get("order_number") || "").trim();
  const qEmail = normEmail(q.get("email") || "");
  const qPhone = normPhone(q.get("phone") || q.get("mobile") || "");

  const orderNumber = String(order?.orderNumber || "").trim();
  const id = String(order?.id || "").trim();

  const orderNumberMatch =
    (qOrderNumber && orderNumber && qOrderNumber === orderNumber) ||
    (qOrderNumber && id && qOrderNumber === id);

  if (!orderNumberMatch) return false;

  const ship = order?.shippingAddress || null;
  const bill = order?.billingAddress || null;

  const storedEmail = normEmail(
    firstNonEmpty(
      order?.user?.email,
      order?.email,
      order?.customerEmail,
      ship?.email,
      bill?.email
    )
  );

  const storedPhone = normPhone(
    firstNonEmpty(
      order?.user?.phone,
      order?.phone,
      order?.customerPhone,
      ship?.phone,
      bill?.phone
    )
  );

  const emailOk = storedEmail && qEmail && storedEmail === qEmail;
  const phoneOk = storedPhone && qPhone && storedPhone === qPhone;

  // If we have something to compare, require a match
  if (storedEmail || storedPhone) return Boolean(emailOk || phoneOk);

  // Final conservative fallback: allow only if id is high entropy and order is truly guest-like
  const isGuestLike = !order?.userId && !order?.user;
  return isGuestLike && looksHighEntropyId(id);
}

/* ---------- GET /api/orders/[id]/invoice ---------- */

export async function GET(req, { params }) {
  try {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id || null;
    const roles = session?.user?.roles || session?.roles || [];

    const id = String(params?.id || "").trim();
    if (!id) return textResponse("ID_REQUIRED", 400, "error.txt");

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            // mirror cartItem includes as much as possible
            variant: {
              include: {
                product: true,
                media: { include: { media: true } },
                optionValues: {
                  include: {
                    optionValue: {
                      include: { option: true },
                    },
                  },
                },
                prices: true,
              },
            },
            product: true, // if you have direct product on OrderItem
          },
        },
        payments: true,
        shippingAddress: true,
        billingAddress: true,
        user: true,
      },
    });

    if (!order) return textResponse("NOT_FOUND", 404, "error.txt");

    // owner/admin can always download
    const authedOk =
      userId && (order.userId === userId || isAdmin(roles));

    // guest download path: key/token OR identity match (orderNumber + email/phone)
    let guestOk = false;
    if (!authedOk) {
      const reqKey = getReqAccessKey(req);
      if (reqKey) {
        const orderKeys = collectOrderAccessKeys(order);
        guestOk = orderKeys.includes(reqKey);
      }
      if (!guestOk) {
        guestOk = guestIdentityMatch(req, order);
      }
    }

    if (!authedOk && !guestOk) {
      return textResponse("FORBIDDEN", 403, "error.txt");
    }

    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const { dateStr, timeStr } = safeDateParts(createdAt);

    const subtotal = toNum(order.subtotal, 0);
    const shippingTotal = toNum(order.shippingTotal, 0);
    const discountTotal = toNum(order.discountTotal, 0);
    const taxTotal = toNum(order.taxTotal, 0);
    const grandTotal = toNum(
      order.grandTotal ??
        subtotal - discountTotal + taxTotal + shippingTotal,
      0
    );

    const paidAmount = sumPaid(order.payments || []);
    const amountDue = Math.max(grandTotal - paidAmount, 0);

    const mode = computePaymentMode(order);
    const currency = order.currency || "BDT";

    const ship = order.shippingAddress || null;
    const bill = order.billingAddress || null;

    const customerName = firstNonEmpty(
      order.user?.name,
      ship?.name,
      bill?.name,
      order.customerName,
      order.name
    ) || "—";

    const customerEmail = firstNonEmpty(
      order.user?.email,
      order.email,
      order.customerEmail,
      ship?.email,
      bill?.email
    ) || "—";

    const customerPhone = firstNonEmpty(
      order.user?.phone,
      order.phone,
      order.customerPhone,
      ship?.phone,
      bill?.phone
    ) || "—";

    const lines = [];

    lines.push("THE DNA LAB CLOTHING");
    lines.push("INVOICE");
    lines.push("============================================================");
    lines.push(`Invoice : ${order.orderNumber || order.id}`);
    lines.push(`OrderID : ${order.id}`);
    lines.push(`Date    : ${dateStr}  ${timeStr}`);
    lines.push(`Status  : ${order.status || "—"}`);
    lines.push(`Currency: ${currency}`);
    lines.push("");
    lines.push(`Customer: ${customerName}`);
    lines.push(`Email   : ${customerEmail}`);
    lines.push(`Phone   : ${customerPhone}`);
    lines.push("");

    if (ship) {
      lines.push("Shipping Address:");
      if (ship.name) lines.push(`  ${ship.name}`);
      if (ship.line1) lines.push(`  ${ship.line1}`);
      if (ship.line2) lines.push(`  ${ship.line2}`);
      lines.push(
        `  ${ship.city || ""}${ship.postalCode ? " " + ship.postalCode : ""}`
      );
      if (ship.state) lines.push(`  ${ship.state}`);
      if (ship.countryIso2) lines.push(`  ${ship.countryIso2}`);
      if (ship.phone) lines.push(`  Phone: ${ship.phone}`);
      lines.push("");
    }

    if (bill) {
      lines.push("Billing Address:");
      if (bill.name) lines.push(`  ${bill.name}`);
      if (bill.line1) lines.push(`  ${bill.line1}`);
      if (bill.line2) lines.push(`  ${bill.line2}`);
      lines.push(
        `  ${bill.city || ""}${bill.postalCode ? " " + bill.postalCode : ""}`
      );
      if (bill.state) lines.push(`  ${bill.state}`);
      if (bill.countryIso2) lines.push(`  ${bill.countryIso2}`);
      if (bill.phone) lines.push(`  Phone: ${bill.phone}`);
      lines.push("");
    }

    lines.push("Items:");
    lines.push("------------------------------------------------------------");

    (order.items || []).forEach((it, idx) => {
      const md = it.metadata || {};
      const v = it.variant || {};
      const p = v.product || it.product || {};

      // title: mirror frontend priority
      const title =
        it.title ||
        v.title ||
        p.title ||
        p.name ||
        md.productName ||
        md.variantTitle ||
        it.sku ||
        `Item ${idx + 1}`;

      const { size: derivedSize, color: derivedColor } =
        deriveSizeColorFromVariantOptions(v);

      const qty = toNum(it.quantity, 0);

      // charged unit price (what customer actually paid per unit)
      const unitPrice = toNum(
        it.unitPrice ??
          it.price ??
          it.unit_price ??
          md.unitPrice ??
          md.price ??
          md.unit_price,
        0
      );

      // base / original unit price used to compute discount
      const baseUnit =
        toNum(
          it.baseAmount ??
            it.compareAtPrice ??
            it.originalUnitPrice ??
            md.baseAmount ??
            md.compareAt ??
            md.compareAtPrice ??
            md.originalUnitPrice,
          0
        ) || unitPrice; // fallback to unitPrice if nothing stored

      const lineTotal = toNum(
        it.total ?? it.subtotal ?? qty * unitPrice,
        qty * unitPrice
      );

      /* --- meta fields using same order as frontend summary.jsx --- */

      const size = firstNonEmpty(
        it.size,
        it.options?.size,
        md.size,
        md.size_name,
        md.sizeName,
        md.selectedSize,
        v.sizeLabel,
        v.sizeName,
        v.size_name,
        v.size,
        p.sizeLabel,
        p.sizeName,
        p.size_name,
        p.size,
        derivedSize
      );

      const color = firstNonEmpty(
        it.color,
        it.options?.color,
        md.color,
        md.colour,
        md.color_name,
        md.colorName,
        md.selectedColor,
        v.colorLabel,
        v.colorName,
        v.color_name,
        v.color,
        p.colorLabel,
        p.colorName,
        p.color_name,
        p.color,
        derivedColor
      );

      const fabric = firstNonEmpty(
        it.fabric,
        md.fabric,
        md.fabricName,
        v.fabric,
        v.fabricName,
        p.fabric,
        p.fabricName,
        p.material
      );

      const gsm = firstNonEmpty(
        it.gsm,
        md.gsm,
        md.gsmValue,
        v.gsm,
        v.gsmValue,
        p.gsm,
        p.gsmValue
      );

      const fit = firstNonEmpty(
        it.fit,
        md.fit,
        md.fitName,
        v.fit,
        v.fitName,
        p.fit,
        p.fitName
      );

      const sku = firstNonEmpty(
        it.sku,
        md.sku,
        md.skuCode,
        v.sku,
        v.skuCode,
        v.sku_code,
        p.sku,
        p.skuCode,
        p.sku_code
      );

      const barcode = firstNonEmpty(
        it.barcode,
        it.barCode,
        it.ean13,
        it.ean,
        md.barcode,
        md.barCode,
        md.ean,
        md.ean13,
        md.barcode_ean13,
        v.barcode,
        v.barCode,
        v.ean13,
        v.ean,
        v.barcodeEan13,
        v.barcode_ean13,
        p.barcode,
        p.barCode,
        p.ean13,
        p.ean,
        p.barcodeEan13,
        p.barcode_ean13
      );

      const pid = firstNonEmpty(
        it.pid,
        it.productId,
        it.product_id,
        md.productId,
        md.pid,
        p.id != null ? String(p.id) : null,
        p.slug
      );

      const vidRaw = firstNonEmpty(
        it.vid,
        it.variantId,
        it.variant_id,
        md.variantId,
        md.vid,
        v.id != null ? String(v.id) : null
      );

      const vid =
        pid && vidRaw && String(pid) === String(vidRaw) ? "" : vidRaw;

      const perUnitDiscount =
        baseUnit > unitPrice ? baseUnit - unitPrice : 0;
      const lineDiscount = perUnitDiscount * qty;

      // main line
      lines.push(
        `${idx + 1}. ${title}\n   ${qty} x ${money(
          unitPrice,
          currency
        )}  =  ${money(lineTotal, currency)}`
      );

      // base/original price + savings
      if (baseUnit && baseUnit > unitPrice + 0.0001) {
        lines.push(
          `   Base price : ${money(
            baseUnit,
            currency
          )}   You saved: ${money(lineDiscount, currency)}`
        );
      }

      // mirror frontend meta-grid order:
      if (size) lines.push(`   Size     : ${size}`);
      if (color) lines.push(`   Color    : ${color}`);
      if (fabric) lines.push(`   Fabric   : ${fabric}`);
      if (gsm) lines.push(`   GSM      : ${gsm}`);
      if (fit) lines.push(`   Fit      : ${fit}`);
      if (sku) lines.push(`   SKU      : ${sku}`);
      if (barcode) lines.push(`   Barcode  : ${barcode}`);
      if (pid) lines.push(`   PID      : ${pid}`);
      if (vid) {
        lines.push(`   VID      : ${vid}`);
      } else if (it.variantId) {
        // legacy safety
        lines.push(`   VariantID: ${it.variantId}`);
      }
    });

    if (!order.items || order.items.length === 0) {
      lines.push("  (no items)");
    }

    lines.push("------------------------------------------------------------");
    lines.push(`Subtotal : ${money(subtotal, currency)}`);
    lines.push(`Shipping : ${money(shippingTotal, currency)}`);
    lines.push(`Discount : -${money(discountTotal, currency)}`);
    lines.push(`Tax      : ${money(taxTotal, currency)}`);
    lines.push("------------------------------------------------------------");
    lines.push(`TOTAL    : ${money(grandTotal, currency)}`);
    lines.push("");
    lines.push(`Payment status : ${order.paymentStatus || "UNPAID"}`);
    lines.push(`Payment mode   : ${mode}`);
    lines.push(`Paid amount    : ${money(paidAmount, currency)}`);
    lines.push(`Amount due     : ${money(amountDue, currency)}`);
    lines.push("");
    lines.push("Thank you for shopping with THE DNA LAB CLOTHING.");
    lines.push("Keep this invoice as proof of purchase.");
    lines.push("============================================================");

    const body = lines.join("\n");
    const filename = `invoice-${order.orderNumber || order.id}.txt`.replace(
      /[^A-Za-z0-9_.-]/g,
      "_"
    );

    return textResponse(body, 200, filename);
  } catch (err) {
    console.error("[api/orders/[id]/invoice GET] ", err);
    return textResponse("UNKNOWN_ERROR", 500, "error.txt");
  }
}
