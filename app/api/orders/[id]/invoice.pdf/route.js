// PATH: app/api/orders/[id]/invoice.pdf/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/** Buffer a pdfkit doc into a single Buffer */
function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function money(n) {
  return `৳${Number(n || 0).toFixed(2)}`;
}

export async function GET(_req, { params }) {
  try {
    // 1) Auth from cookies (Auth.js v5)
    const session = await auth();
    const userId = session?.user?.id || null;
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 2) Order fetch + ownership
    const id = String(params?.id || "");
    if (!id) {
      return new NextResponse("Order id required", { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        shippingAddress: true,
        billingAddress: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!order || (order.userId && order.userId !== userId)) {
      return new NextResponse("Not found", { status: 404 });
    }

    // 3) Numbers (server-truth)
    const subtotal = Number(order.subtotal ?? 0);
    const discount = Number(order.discountTotal ?? 0);
    const tax = Number(order.taxTotal ?? 0);
    const shipping = Number(order.shippingTotal ?? 0);
    const grand = Number(
      order.grandTotal ?? subtotal - discount + tax + shipping
    );

    const PAIDLIKE = new Set([
      "PAID",
      "SETTLED",
      "SUCCEEDED",
      "CAPTURED",
      "AUTHORIZED",
    ]);

    const paidSoFar = (order.payments || []).reduce(
      (acc, p) =>
        PAIDLIKE.has(String(p?.status || "").toUpperCase())
          ? acc + Number(p?.amount || 0)
          : acc,
      0
    );

    const amountDue = Math.max(grand - paidSoFar, 0);

    const mode =
      order.payments?.[0]?.provider
        ? String(order.payments[0].provider).replace(/_/g, " ")
        : order.paymentStatus === "UNPAID" || order.paymentStatus === "PENDING"
        ? "CASH ON DELIVERY"
        : "—";

    const payStatus = String(order.paymentStatus || "PENDING");

    // 4) Lazy deps (Node only)
    const { default: PDFDocument } = await import("pdfkit");
    const bwipModule = await import("bwip-js");
    const bwipjs = bwipModule.default || bwipModule;

    // 5) Build the PDF (premium TDLC invoice)
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const brand = "TDLC";

    /* ── Header ── */
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor("#0F2147")
      .text(brand, { align: "center" });

    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .fillColor("#6B7280")
      .text("Premium Order Invoice", { align: "center" });

    // Barcode (orderNo preferred, then orderNumber, then id)
    const codeText = String(order.orderNo || order.orderNumber || order.id);

    const barcodePng = await new Promise((resolve, reject) => {
      try {
        bwipjs.toBuffer(
          {
            bcid: "code128",
            text: codeText,
            scale: 3,
            height: 10,
            includetext: false,
            backgroundcolor: "FFFFFF",
            paddingwidth: 6,
            paddingheight: 6,
          },
          (err, png) => {
            if (err) return reject(err);
            resolve(png);
          }
        );
      } catch (e) {
        reject(e);
      }
    });

    const xCenter = (doc.page.width - 240) / 2;
    doc.image(barcodePng, xCenter, doc.y + 8, { width: 240 });
    doc.moveDown(1.2);

    /* ── Focus strip (Amount/Status/Mode) ── */
    drawFocus(doc, [
      ["Amount to Pay", money(amountDue)],
      ["Payment Status", payStatus],
      ["Payment Mode", mode],
    ]);

    /* ── Customer block (top-left prominence) ── */
    drawBox(doc, () => {
      sectionTitle(doc, "Customer");
      metaRow(doc, "Name", order.user?.name || "—");
      metaRow(doc, "Phone", order.user?.phone || "—");
      metaRow(doc, "Email", order.user?.email || "—");
    });

    /* ── Delivery (Shipping) + Billing ── */
    drawTwoCols(doc, (left, right) => {
      left.title("Delivery (Shipping) — Prominent");
      addressBlock(left, order.shippingAddress);

      right.title("Billing Address");
      addressBlock(right, order.billingAddress);
    });

    /* ── Order meta ── */
    drawBox(doc, () => {
      sectionTitle(doc, "Order Info");
      metaRow(
        doc,
        "Order Number",
        `#${String(order.orderNo || order.orderNumber || order.id)}`
      );
      metaRow(doc, "Order ID", order.id);
      metaRow(doc, "Customer ID", order.userId || "—");
      metaRow(doc, "Order Status", String(order.status || "PLACED"));
      metaRow(
        doc,
        "Fulfillment",
        String(order.fulfillmentStatus || "UNFULFILLED")
      );
      metaRow(
        doc,
        "Placed At",
        order.createdAt
          ? new Date(order.createdAt).toLocaleString("en-GB")
          : "—"
      );
      metaRow(doc, "Currency", String(order.currency || "BDT"));
    });

    /* ── Items ── */
    doc.moveDown(0.6);
    sectionTitle(doc, "Items");
    const tableStartY = doc.y + 6;
    tableHeader(doc, ["Title", "Variant", "Qty", "Unit", "Line"]);
    let y = tableStartY + 18;

    for (const it of order.items) {
      const qty = Number(it.quantity || 1);
      const unit = Number(it.unitPrice ?? it.price ?? it.unit_price ?? 0);
      const line = it.total != null ? Number(it.total) : qty * unit;

      y = tableRow(doc, y, [
        it.title || "Item",
        String(it.variantId ?? it.variant_id ?? "—"),
        qty.toString(),
        money(unit),
        money(line),
      ]);

      // simple page-break control
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 60;
        tableHeader(doc, ["Title", "Variant", "Qty", "Unit", "Line"], y - 14);
        y += 18;
      }
    }

    /* ── Totals ── */
    doc.moveDown(0.6);
    sectionTitle(doc, "Totals");
    kvRow(doc, "Subtotal", money(subtotal));
    kvRow(doc, "Discounts", money(-discount));
    kvRow(doc, "VAT", money(tax));
    kvRow(doc, "Shipping", money(shipping));
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0F2147");
    kvRow(doc, "Grand Total", money(grand));

    // Finish & buffer
    doc.end();
    const pdfBuffer = await pdfToBuffer(doc);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="invoice-${codeText}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/orders/[id]/invoice.pdf] ", err);
    return new NextResponse("Failed to generate PDF", { status: 500 });
  }
}

/* ───────── PDF helpers ───────── */
function sectionTitle(doc, text) {
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0F2147").text(text);
}

function drawBox(doc, cb) {
  doc.moveDown(0.6);
  const x = doc.page.margins.left;
  const y = doc.y;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 96;

  doc
    .save()
    .roundedRect(x, y, w, h, 8)
    .lineWidth(0.6)
    .stroke("#DFE3EC")
    .restore();

  doc.x = x + 12;
  doc.y = y + 10;
  cb?.();
  doc.y = y + h + 10;
}

function drawFocus(doc, rows) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const h = 50;
  const y = doc.y;

  doc.save().roundedRect(x, y, w, h, 10).fill("#0F2147").restore();

  const cellW = w / rows.length;
  rows.forEach(([k, v], idx) => {
    const cx = x + idx * cellW + 14;
    const cy = y + 12;
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica")
      .fontSize(9)
      .text(String(k), cx, cy);
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(String(v), cx, cy + 12);
  });

  doc.moveDown(2.0);
}

function metaRow(doc, k, v) {
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(k, { continued: true, width: 140 });

  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0F2147")
    .text(`  ${v}`);
}

function drawTwoCols(doc, cb) {
  doc.moveDown(0.6);
  const xL = doc.page.margins.left;
  const xR = doc.page.width / 2 + 6;
  const y0 = doc.y + 6;

  const left = makeCol(
    doc,
    xL,
    y0,
    doc.page.width / 2 - doc.page.margins.left - 12
  );
  const right = makeCol(
    doc,
    xR,
    y0,
    doc.page.width - xR - doc.page.margins.right
  );

  cb(left, right);
  doc.y = Math.max(left.y, right.y) + 12;
}

function makeCol(doc, x, y, width) {
  const api = {
    y,
    title(t) {
      doc.x = x;
      doc.y = api.y;
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#0F2147")
        .text(t);
      api.y = doc.y + 2;
    },
    line(t) {
      doc.x = x;
      doc.y = api.y;
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#111827")
        .text(String(t || "—"), { width });
      api.y = doc.y + 1;
    },
    sub(t) {
      doc.x = x;
      doc.y = api.y;
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#6B7280")
        .text(String(t || "—"), { width });
      api.y = doc.y + 1;
    },
    kv(k, v) {
      doc.x = x;
      doc.y = api.y;
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#6B7280")
        .text(k, { continued: true });
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#0F2147")
        .text(`  ${v}`);
      api.y = doc.y + 1;
    },
  };
  return api;
}

function addressBlock(col, a) {
  if (!a) {
    col.line("—");
    return;
  }
  const country = (a.countryIso2 || a.country || "").toString().toUpperCase();
  const line1 = [a.line1, a.line2].filter(Boolean).join(", ");
  const line2 = [[a.city, a.state].filter(Boolean).join(", "), a.postalCode]
    .filter(Boolean)
    .join(" ");

  if (a.name) col.line(a.name);
  if (a.phone) col.sub(a.phone);
  if (a.email) col.sub(String(a.email).toLowerCase());
  col.sub(line1 || "—");
  col.sub(line2 || "—");
  col.sub(country || "—");
}

function tableHeader(doc, headers, y) {
  if (typeof y === "number") doc.y = y;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0F2147");
  const cols = [0, 260, 370, 420, 480];
  doc.text(headers[0], 36 + cols[0], doc.y);
  doc.text(headers[1], 36 + cols[1], doc.y);
  doc.text(headers[2], 36 + cols[2], doc.y, { width: 40, align: "right" });
  doc.text(headers[3], 36 + cols[3], doc.y, { width: 52, align: "right" });
  doc.text(headers[4], 36 + cols[4], doc.y, { width: 72, align: "right" });
}

function tableRow(doc, y, cells) {
  const cols = [0, 260, 370, 420, 480];
  doc.font("Helvetica").fontSize(10).fillColor("#111827");
  doc.text(cells[0], 36 + cols[0], y, { width: 240 });
  doc.text(cells[1], 36 + cols[1], y, { width: 100 });
  doc.text(cells[2], 36 + cols[2], y, { width: 40, align: "right" });
  doc.text(cells[3], 36 + cols[3], y, { width: 52, align: "right" });
  doc.text(cells[4], 36 + cols[4], y, { width: 72, align: "right" });
  return y + 18;
}

function kvRow(doc, k, v) {
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#6B7280")
    .text(k, { continued: true });
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#0F2147")
    .text(`  ${v}`);
}
