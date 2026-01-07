// FILE: app/api/checkout/preflight/route.js

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";

/* ───────────────── helpers: response ───────────────── */

function json(body, status = 200) {
  return new NextResponse(
    body === undefined ? "null" : JSON.stringify(body),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    }
  );
}

/* ───────────────── helpers: stock preflight ───────────────── */

/**
 * Check the current cart against InventoryItem rows.
 *
 * - Uses InventoryItem.onHand - reserved - safetyStock as "available".
 * - If any line requests more than available, returns a list of problematic lines.
 * - If there are no InventoryItem rows for a variant, we treat it as "unknown"
 *   and let /api/checkout/create-order enforce the hard guard.
 */
async function checkCartStock(cartId, userId) {
  if (!cartId) {
    return { ok: true, insufficient: [] };
  }

  const cart = await prisma.cart.findFirst({
    where: {
      id: cartId,
      ...(userId ? { userId } : {}),
    },
    include: {
      items: {
        include: {
          variant: {
            include: {
              inventoryItems: true,
              product: true,
            },
          },
        },
      },
    },
  });

  if (!cart) {
    return { ok: false, error: "CART_NOT_FOUND" };
  }

  const insufficient = [];

  for (const line of cart.items || []) {
    const v = line.variant;
    if (!v) continue;

    // Aggregate all inventory rows for this variant
    let available = null;
    if (Array.isArray(v.inventoryItems) && v.inventoryItems.length) {
      available = v.inventoryItems.reduce((sum, inv) => {
        const onHand = Number(inv.onHand ?? 0);
        const reserved = Number(inv.reserved ?? 0);
        const safety = Number(inv.safetyStock ?? 0);
        const net = onHand - reserved - safety;
        return sum + (net > 0 ? net : 0);
      }, 0);
    }

    // If we truly have no server knowledge, let create-order enforce later.
    if (available == null) continue;

    const requested = Number(line.quantity ?? 0);

    if (requested > available) {
      insufficient.push({
        cartItemId: line.id,
        variantId: line.variantId,
        requested,
        available,
        sku: v.sku ?? null,
        title:
          v.title ||
          v.product?.title ||
          v.product?.name ||
          line.title ||
          null,
      });
    }
  }

  return { ok: true, insufficient };
}

/* ───────────────── route: POST /api/checkout/preflight ───────────────── */

export async function POST(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const method = String(body?.method || "").toUpperCase();
    const grandTotal = Number(body?.grandTotal || 0);
    const phone = String(body?.phone || "").trim();
    const cartId = body?.cartId ? String(body.cartId) : null;

    /* ───── 1) STOCK PREFLIGHT: fail fast if inventory is short ───── */
    const stockCheck = await checkCartStock(cartId, userId);

    if (!stockCheck.ok && stockCheck.error === "CART_NOT_FOUND") {
      return json({ ok: false, error: "CART_NOT_FOUND" }, 404);
    }

    if (stockCheck.insufficient && stockCheck.insufficient.length) {
      // Frontend should show a message and send user back to cart
      return json(
        {
          ok: false,
          error: "INSUFFICIENT_STOCK",
          items: stockCheck.insufficient,
        },
        409
      );
    }

    /* ───── 2) USER + SETTINGS FOR OTP LOGIC ───── */

    // fetch user phone & verification
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, phoneVerifiedAt: true },
    });

    // settings (threshold)
    const setting = await prisma.appSetting
      .findUnique({ where: { key: "checkout" } })
      .catch(() => null);
    const cfg = (setting?.value ?? setting?.valueJson ?? null) || {};
    const threshold = Number(cfg?.riskThresholdBdt || 1500);

    // helper: check trusted device cookie (optional, best-effort)
    const cookies = req.headers.get("cookie") || "";
    const trustCookie = parseCookie(cookies)["tdls_otp_trust"];
    const trusted = await isTrustedDevice(trustCookie, user?.id, phone);

    /* ───── 3) OTP DECISION RULES ───── */

    // Rule 1: COD over threshold -> OTP required regardless
    if (method === "CASH_ON_DELIVERY" && grandTotal >= threshold) {
      return json({
        ok: true,
        needsOtp: true,
        reason: "cod_threshold",
      });
    }

    // Rule 2: if base phone and verified -> skip OTP (unless high risk, which we don't check here)
    const isBasePhone = !!user?.phone && phone && eqPhones(user.phone, phone);
    if (isBasePhone && user?.phoneVerifiedAt) {
      return json({
        ok: true,
        needsOtp: false,
        reason: trusted ? "trusted_device" : "base_phone_verified",
      });
    }

    // Rule 3: if delivery phone equals a previously verified address phone -> skip
    if (phone) {
      const addrs = await prisma.address.findMany({
        where: {
          userId,
          archivedAt: null,
          phoneVerifiedAt: { not: null },
        },
        select: { phoneVerifiedAt: true, granular: true },
      });

      const matched = addrs.find(
        (a) =>
          normalizePhone(a?.granular?.phone || "") ===
          normalizePhone(phone)
      );

      if (matched) {
        return json({
          ok: true,
          needsOtp: false,
          reason: "address_phone_verified",
        });
      }
    }

    // Default: needs OTP if a phone exists and isn’t the verified base
    const needs = !!phone && (!isBasePhone || !user?.phoneVerifiedAt);
    return json({
      ok: true,
      needsOtp: needs,
      reason: "default",
    });
  } catch (e) {
    return json(
      { ok: false, error: e?.message || "preflight_failed" },
      500
    );
  }
}

/* ───────────────── helpers: cookies & phone normalization ───────────────── */

function parseCookie(header) {
  return Object.fromEntries(
    (header || "")
      .split(/; */)
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        if (i < 0) return [decodeURIComponent(p.trim()), ""];
        return [
          decodeURIComponent(p.slice(0, i).trim()),
          decodeURIComponent(p.slice(i + 1).trim()),
        ];
      })
  );
}

function eqPhones(a, b) {
  return normalizePhone(a) === normalizePhone(b);
}

function normalizePhone(p) {
  const s = String(p || "").replace(/\D+/g, "");
  if (!s) return "";
  if (s.startsWith("8801")) return "+" + s;
  if (s.startsWith("01") && s.length === 11) return "+880" + s.slice(1);
  if (s.startsWith("880")) return "+880" + s.slice(3);
  if (s.startsWith("00880")) return "+" + s.slice(2);
  if (s.startsWith("+8801")) return s;
  return "+" + s;
}

// optional trust-cookie (best-effort, signature check if you set one)
async function isTrustedDevice(token, userId, phone) {
  try {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length < 3) return false;
    const [b64, sig] = [parts.slice(0, 2).join("."), parts[2]];
    const secret = process.env.OTP_TRUST_SECRET || "dev-secret";
    const h = crypto
      .createHmac("sha256", secret)
      .update(b64)
      .digest("base64url");
    if (h !== sig) return false;
    const json = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    );
    if (!json?.sub || !json?.ph || !json?.exp) return false;
    if (json.sub !== userId) return false;
    if (Date.now() / 1000 > Number(json.exp)) return false;
    const targetHash = crypto
      .createHash("sha256")
      .update(normalizePhone(phone))
      .digest("hex");
    return json.ph === targetHash;
  } catch {
    return false;
  }
}
