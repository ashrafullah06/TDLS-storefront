export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ---------- helpers ---------- */

function isAdmin(roles) {
  const arr = Array.isArray(roles) ? roles : roles ? [roles] : [];
  const set = new Set(arr.map((r) => String(r || "").toLowerCase()));
  return set.has("admin") || set.has("superadmin");
}

/**
 * IMPORTANT:
 * PDF generator below is ASCII-safe. Avoid non-ASCII currency symbols in the PDF content.
 * (Otherwise PDF text encoding becomes unreliable without embedding fonts.)
 */
function money(n, currency = "BDT") {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return currency === "BDT" ? "BDT 0.00" : `${currency} 0.00`;

  const sym =
    currency === "BDT"
      ? "BDT "
      : currency === "USD"
      ? "$"
      : currency === "EUR"
      ? "EUR "
      : currency === "GBP"
      ? "GBP "
      : currency + " ";

  return `${sym}${x.toFixed(2)}`;
}

function encodeRFC5987(str) {
  // RFC 5987 encoding for filename*
  return encodeURIComponent(str);
}

function sanitizeFilename(name, fallback = "TDLS-receipt.pdf") {
  const raw = String(name || "").trim() || fallback;

  // Remove path separators, control chars, quotes; keep it attachment-safe across OS/browsers
  let s = raw
    .replace(/[\u0000-\u001F\u007F]+/g, "")
    .replace(/[\/\\]+/g, "-")
    .replace(/[:*?"<>|]+/g, "-")
    .replace(/[\r\n"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) s = fallback;

  // Ensure .pdf
  if (!/\.pdf$/i.test(s)) s = `${s}.pdf`;

  // Limit length (iOS/Safari + some FS limits)
  if (s.length > 180) {
    const ext = ".pdf";
    s = s.slice(0, 180 - ext.length).trim() + ext;
  }

  return s;
}

function noStoreHeaders(extra = {}) {
  return {
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    pragma: "no-cache",
    expires: "0",
    ...extra,
  };
}

function jsonError(code, status = 400, extra = {}) {
  return NextResponse.json(
    { ok: false, code },
    {
      status,
      headers: noStoreHeaders({
        "content-type": "application/json; charset=utf-8",
        ...extra,
      }),
    }
  );
}

/* ---------- PDF generator (no external deps) ---------- */

function pdfEscapeText(s) {
  // PDF literal string escape: \, (, )
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0000-\u001F\u007F]/g, " "); // drop control chars
}

function toAsciiSafeLine(s) {
  // Keep printable ASCII + basic whitespace; replace anything else (incl ৳) with safe text
  const str = String(s ?? "");
  // Replace common BDT symbol explicitly if it appears
  const normalized = str.replace(/৳/g, "BDT ");
  return normalized.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ");
}

function wrapLine(line, maxLen) {
  const s = toAsciiSafeLine(line);
  if (s.length <= maxLen) return [s];

  const out = [];
  let remaining = s;

  while (remaining.length > maxLen) {
    // Prefer breaking at last space within maxLen
    let cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = maxLen; // avoid tiny fragments
    out.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) out.push(remaining);
  return out;
}

function buildSimplePdfFromLines(lines) {
  // A4: 595 x 842 points
  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN_X = 40;
  const TOP_Y = 800;
  const FONT_SIZE = 10;
  const LEADING = 13;
  const MAX_CHARS = 96; // safe wrap for 10pt Helvetica at this width

  // Wrap + paginate
  const wrapped = [];
  for (const ln of lines) {
    wrapLine(ln, MAX_CHARS).forEach((x) => wrapped.push(x));
  }

  const linesPerPage = Math.max(1, Math.floor((TOP_Y - 60) / LEADING)); // bottom margin ~60
  const pages = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) {
    pages.push(wrapped.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(["(no content)"]);

  // Build PDF objects
  const parts = [];
  const offsets = [0]; // xref requires object 0

  const header = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  parts.push(header);

  const pushObj = (objNum, body) => {
    // record offset before writing this object
    const currentLen = parts.reduce((sum, b) => sum + b.length, 0);
    offsets[objNum] = currentLen;

    const obj = `\n${objNum} 0 obj\n${body}\nendobj\n`;
    parts.push(Buffer.from(obj, "utf8"));
  };

  // 1: Catalog
  // 2: Pages
  // 3.. : Page objects
  // font object: fixed number
  // content objects: after pages

  const fontObjNum = 5;
  // We will assign page objects starting at 3, content objects after that.

  const pageObjNums = [];
  const contentObjNums = [];

  let nextObj = 1;

  // Reserve catalog/pages/font numbers:
  // 1 = catalog
  // 2 = pages
  // 5 = font
  // pages start at 3,4,...; content start after pages
  // We'll compute content numbers after we know page count.

  const pageCount = pages.length;
  const firstPageObj = 3;
  const lastPageObj = firstPageObj + pageCount - 1;

  const firstContentObj = lastPageObj + 1;
  const lastContentObj = firstContentObj + pageCount - 1;

  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(firstPageObj + i);
    contentObjNums.push(firstContentObj + i);
  }

  // Catalog (1)
  pushObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);

  // Pages (2)
  pushObj(
    2,
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>`
  );

  // Font (5) - must be declared before pages reference? It's fine anywhere in file.
  pushObj(fontObjNum, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  // Page objects + content streams
  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageObjNums[i];
    const contentNum = contentObjNums[i];

    // Content stream
    const pageLines = pages[i];

    // Build content stream (text)
    const textLines = [];
    textLines.push("BT");
    textLines.push(`/F1 ${FONT_SIZE} Tf`);
    textLines.push(`1 0 0 1 ${MARGIN_X} ${TOP_Y} Tm`);

    for (let li = 0; li < pageLines.length; li++) {
      const t = pdfEscapeText(pageLines[li]);
      if (li === 0) {
        textLines.push(`(${t}) Tj`);
      } else {
        textLines.push(`0 -${LEADING} Td`);
        textLines.push(`(${t}) Tj`);
      }
    }

    textLines.push("ET");

    const contentStream = textLines.join("\n") + "\n";
    const contentBytes = Buffer.from(contentStream, "utf8");

    pushObj(
      contentNum,
      `<< /Length ${contentBytes.length} >>\nstream\n${contentStream}endstream`
    );

    // Page object
    pushObj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
  }

  // XRef
  const xrefStart = parts.reduce((sum, b) => sum + b.length, 0);

  // Number of objects = last object number + 1 (includes obj 0)
  const maxObj = Math.max(5, lastContentObj);
  const totalObjs = maxObj + 1;

  let xref = `\nxref\n0 ${totalObjs}\n`;
  // obj 0 free
  xref += `0000000000 65535 f \n`;

  for (let i = 1; i < totalObjs; i++) {
    const off = offsets[i] || 0;
    const off10 = String(off).padStart(10, "0");
    xref += `${off10} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  parts.push(Buffer.from(xref, "utf8"));
  parts.push(Buffer.from(trailer, "utf8"));

  return Buffer.concat(parts);
}

function pdfResponse(pdfBuffer, filename) {
  const safeName = sanitizeFilename(filename, "TDLS-receipt.pdf");
  const encoded = encodeRFC5987(safeName);

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: noStoreHeaders({
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`,
      "x-content-type-options": "nosniff",
      "content-length": String(pdfBuffer.length),
      // Prevent any proxy “help” that breaks downloads
      "content-transfer-encoding": "binary",
      vary: "cookie",
    }),
  });
}

const PAIDLIKE = new Set(["PAID", "SETTLED", "CAPTURED", "SUCCEEDED", "AUTHORIZED"]);

function sumPaid(payments = []) {
  return payments.reduce((sum, p) => {
    const st = String(p?.status || "").toUpperCase();
    return PAIDLIKE.has(st) ? sum + Number(p.amount || 0) : sum;
  }, 0);
}

function computePaymentMode(order) {
  if (order?.paymentMethod) return String(order.paymentMethod).replace(/_/g, " ");
  if (order?.payments?.[0]?.provider) return String(order.payments[0].provider).replace(/_/g, " ");

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
  return String(v || "").trim().toLowerCase();
}

function normPhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function looksHighEntropyId(id) {
  const s = String(id || "");
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

    if (!out.size && name.includes("size")) out.size = value;
    if (!out.color && (name.includes("color") || name.includes("colour") || name.includes("colorway"))) {
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
    firstNonEmpty(order?.user?.email, order?.email, order?.customerEmail, ship?.email, bill?.email)
  );

  const storedPhone = normPhone(
    firstNonEmpty(order?.user?.phone, order?.phone, order?.customerPhone, ship?.phone, bill?.phone)
  );

  const emailOk = storedEmail && qEmail && storedEmail === qEmail;
  const phoneOk = storedPhone && qPhone && storedPhone === qPhone;

  if (storedEmail || storedPhone) return Boolean(emailOk || phoneOk);

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
    if (!id) return jsonError("ID_REQUIRED", 400);

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: true,
                media: { include: { media: true } },
                optionValues: { include: { optionValue: { include: { option: true } } } },
                prices: true,
              },
            },
            product: true,
          },
        },
        payments: true,
        shippingAddress: true,
        billingAddress: true,
        user: true,
      },
    });

    if (!order) return jsonError("NOT_FOUND", 404);

    // owner/admin can always download
    const authedOk = userId && (order.userId === userId || isAdmin(roles));

    // guest download path: key/token OR identity match (orderNumber + email/phone)
    let guestOk = false;
    if (!authedOk) {
      const reqKey = getReqAccessKey(req);
      if (reqKey) {
        const orderKeys = collectOrderAccessKeys(order);
        guestOk = orderKeys.includes(reqKey);
      }
      if (!guestOk) guestOk = guestIdentityMatch(req, order);
    }

    if (!authedOk && !guestOk) {
      return jsonError("FORBIDDEN", 403);
    }

    // Filename from query param (receipt page already sends it)
    const url = new URL(req.url);
    const requestedFilename = url.searchParams.get("filename") || "";
    const downloadFilename = sanitizeFilename(
      requestedFilename,
      `TDLS-${order.orderNumber || order.id}.pdf`
    );

    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const { dateStr, timeStr } = safeDateParts(createdAt);

    const subtotal = toNum(order.subtotal, 0);
    const shippingTotal = toNum(order.shippingTotal, 0);
    const discountTotal = toNum(order.discountTotal, 0);
    const taxTotal = toNum(order.taxTotal, 0);
    const grandTotal = toNum(order.grandTotal ?? subtotal - discountTotal + taxTotal + shippingTotal, 0);

    const paidAmount = sumPaid(order.payments || []);
    const amountDue = Math.max(grandTotal - paidAmount, 0);

    const mode = computePaymentMode(order);
    const currency = order.currency || "BDT";

    const ship = order.shippingAddress || null;
    const bill = order.billingAddress || null;

    const customerName =
      firstNonEmpty(order.user?.name, ship?.name, bill?.name, order.customerName, order.name) || "—";

    const customerEmail =
      firstNonEmpty(order.user?.email, order.email, order.customerEmail, ship?.email, bill?.email) || "—";

    const customerPhone =
      firstNonEmpty(order.user?.phone, order.phone, order.customerPhone, ship?.phone, bill?.phone) || "—";

    const lines = [];

    // Branding/content only; logic unchanged
    lines.push("TDLS");
    lines.push("INVOICE / RECEIPT");
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
      lines.push(`  ${ship.city || ""}${ship.postalCode ? " " + ship.postalCode : ""}`);
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
      lines.push(`  ${bill.city || ""}${bill.postalCode ? " " + bill.postalCode : ""}`);
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

      const title =
        it.title ||
        v.title ||
        p.title ||
        p.name ||
        md.productName ||
        md.variantTitle ||
        it.sku ||
        `Item ${idx + 1}`;

      const { size: derivedSize, color: derivedColor } = deriveSizeColorFromVariantOptions(v);

      const qty = toNum(it.quantity, 0);

      const unitPrice = toNum(
        it.unitPrice ?? it.price ?? it.unit_price ?? md.unitPrice ?? md.price ?? md.unit_price,
        0
      );

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
        ) || unitPrice;

      const lineTotal = toNum(it.total ?? it.subtotal ?? qty * unitPrice, qty * unitPrice);

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

      const fabric = firstNonEmpty(it.fabric, md.fabric, md.fabricName, v.fabric, v.fabricName, p.fabric, p.fabricName, p.material);

      const gsm = firstNonEmpty(it.gsm, md.gsm, md.gsmValue, v.gsm, v.gsmValue, p.gsm, p.gsmValue);

      const fit = firstNonEmpty(it.fit, md.fit, md.fitName, v.fit, v.fitName, p.fit, p.fitName);

      const sku = firstNonEmpty(it.sku, md.sku, md.skuCode, v.sku, v.skuCode, v.sku_code, p.sku, p.skuCode, p.sku_code);

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

      const pid = firstNonEmpty(it.pid, it.productId, it.product_id, md.productId, md.pid, p.id != null ? String(p.id) : null, p.slug);

      const vidRaw = firstNonEmpty(it.vid, it.variantId, it.variant_id, md.variantId, md.vid, v.id != null ? String(v.id) : null);

      const vid = pid && vidRaw && String(pid) === String(vidRaw) ? "" : vidRaw;

      const perUnitDiscount = baseUnit > unitPrice ? baseUnit - unitPrice : 0;
      const lineDiscount = perUnitDiscount * qty;

      lines.push(
        `${idx + 1}. ${title}`
      );
      lines.push(
        `   ${qty} x ${money(unitPrice, currency)}  =  ${money(lineTotal, currency)}`
      );

      if (baseUnit && baseUnit > unitPrice + 0.0001) {
        lines.push(`   Base price : ${money(baseUnit, currency)}   You saved: ${money(lineDiscount, currency)}`);
      }

      if (size) lines.push(`   Size     : ${size}`);
      if (color) lines.push(`   Color    : ${color}`);
      if (fabric) lines.push(`   Fabric   : ${fabric}`);
      if (gsm) lines.push(`   GSM      : ${gsm}`);
      if (fit) lines.push(`   Fit      : ${fit}`);
      if (sku) lines.push(`   SKU      : ${sku}`);
      if (barcode) lines.push(`   Barcode  : ${barcode}`);
      if (pid) lines.push(`   PID      : ${pid}`);
      if (vid) lines.push(`   VID      : ${vid}`);
      else if (it.variantId) lines.push(`   VariantID: ${it.variantId}`);

      lines.push("");
    });

    if (!order.items || order.items.length === 0) {
      lines.push("  (no items)");
      lines.push("");
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
    lines.push("Thank you for shopping with TDLS.");
    lines.push("Keep this receipt as proof of purchase.");
    lines.push("============================================================");

    const pdf = buildSimplePdfFromLines(lines);
    return pdfResponse(pdf, downloadFilename);
  } catch (err) {
    console.error("[api/orders/[id]/invoice GET] ", err);
    // Do NOT return an attachment error.txt (prevents “error.txt download” issue)
    return jsonError("UNKNOWN_ERROR", 500);
  }
}
