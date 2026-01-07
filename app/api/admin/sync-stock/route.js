// FILE: app/api/admin/sync-stock/route.js
// Trigger Prisma → Strapi stock sync from TDLC admin + log each run

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prismaDirect from "@/lib/prisma-direct"; // ⬅️ direct client for admin
import { auth } from "@/lib/auth";

/* ───────────────── config: STRAPI base, token, endpoint ───────────────── */

function normalizeBaseUrl(raw) {
  let u = (raw || "").trim();
  if (!u) u = "http://127.0.0.1:1337";
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/^http:\/\/localhost(?=[/:]|$)/i, "http://127.0.0.1");
  return u.replace(/\/+$/, "");
}

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * In DEV:
 *   - ALWAYS talk to local Strapi at http://127.0.0.1:1337
 *   - Ignore remote CMS envs (cms.thednalabstore.com) for stock sync
 *
 * In PROD:
 *   - Use remote CMS envs as usual.
 */
const STRAPI_BASE = IS_DEV
  ? "http://127.0.0.1:1337"
  : normalizeBaseUrl(
      process.env.STRAPI_API_URL ||
        process.env.NEXT_PUBLIC_STRAPI_API_URL ||
        process.env.STRAPI_URL ||
        process.env.STRAPI_API_ORIGIN ||
        "https://cms.thednalabstore.com"
    );

// Accept all token variants (same as cron route)
const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

// Optional override in case your endpoint path changes in Strapi
// Default assumes you have custom Strapi route:
//   POST /api/tdlc-sync/update-stock
const STRAPI_STOCK_ENDPOINT_PATH =
  process.env.STRAPI_STOCK_ENDPOINT_PATH || "/api/tdlc-sync/update-stock";

/* ───────────────── helpers ───────────────── */

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function hasInventoryAccess(user) {
  if (!user) return false;

  const bag = new Set(
    []
      .concat(user.roles || [])
      .concat(user.permissions || [])
      .concat(user.perms || [])
      .concat(user.role ? [user.role] : [])
      .map((v) => String(v || "").toUpperCase())
  );

  return (
    bag.has("ADMIN") ||
    bag.has("SUPERADMIN") ||
    bag.has("MANAGE_CATALOG") ||
    bag.has("VIEW_ANALYTICS") ||
    bag.has("MANAGE_INVENTORY")
  );
}

/**
 * Strapi POST helper → calls your custom endpoint:
 *   /api/tdlc-sync/update-stock  (or overridden path)
 *
 * Body shape:
 *   { items: [{ sizeId, stock }, ...] }
 *
 * This mirrors the cron helper in:
 *   app/api/internal/cron/sync-strapi-inventory/route.js
 */
async function strapiPostUpdateStock(itemsBatch) {
  if (!STRAPI_BASE) {
    throw new Error(
      "STRAPI_BASE not configured – STRAPI_API_URL / STRAPI_URL / NEXT_PUBLIC_STRAPI_API_URL missing"
    );
  }

  let path = STRAPI_STOCK_ENDPOINT_PATH || "/api/tdlc-sync/update-stock";
  if (!path.startsWith("/")) path = `/${path}`;
  const url = new URL(path, STRAPI_BASE);

  console.log(
    `[API] POST → Strapi stock endpoint: ${url.toString()} (batch size: ${itemsBatch.length})`
  );
  console.log(`[API] NODE_ENV=${process.env.NODE_ENV} IS_DEV=${IS_DEV}`);
  console.log(`[API] STRAPI_BASE=${STRAPI_BASE}`);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
      },
      body: JSON.stringify({ items: itemsBatch }),
    });
  } catch (err) {
    throw new Error(
      `STRAPI_FETCH_FAILED: fetch to ${url.toString()} failed – ${
        err?.message || String(err)
      }`
    );
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `STRAPI_HTTP_ERROR: POST ${url.toString()} → ${res.status} ${
        res.statusText
      } – ${txt || "<no-body>"}`
    );
  }

  return res.json().catch(() => ({}));
}

/* ───────── shared logic with cron route: clamp + computeAvailable ───────── */

function clampInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.round(v);
}

/**
 * Compute available stock for a variant from InventoryItem rows,
 * falling back to ProductVariant.stockAvailable if no inventory rows.
 *
 * available = Σ(onHand - safetyStock - reserved), clamped at 0.
 *
 * This matches the logic used in:
 *   app/api/internal/cron/sync-strapi-inventory/route.js
 */
function computeAvailableFromInventoryItems(
  items = [],
  fallbackStockAvailable
) {
  if (!items || items.length === 0) {
    return clampInt(fallbackStockAvailable || 0);
  }

  const total = items.reduce((sum, inv) => {
    const onHand = Number(inv.onHand ?? 0);
    const safety = Number(inv.safetyStock ?? 0);
    const reserved = Number(inv.reserved ?? 0);
    return sum + (onHand - safety - reserved);
  }, 0);

  return clampInt(total);
}

/* ───────────────── handler ───────────────── */

export async function POST() {
  const session = await auth();

  if (!session?.user || !hasInventoryAccess(session.user)) {
    return json({ error: "Not authorized to sync stock" }, 403);
  }

  const userId =
    session?.user?.id != null
      ? String(session.user.id)
      : session?.user?.userId != null
      ? String(session.user.userId)
      : null;

  const userEmail =
    session?.user?.email != null ? String(session.user.email) : null;

  let totalVariants = 0;
  let totalUpdated = 0;

  try {
    console.log("🔄 [API] Reading stock from Prisma (direct)…");
    console.log("🌐 [API] STRAPI_BASE =", STRAPI_BASE);
    console.log(
      "🌐 [API] STRAPI_STOCK_ENDPOINT_PATH =",
      STRAPI_STOCK_ENDPOINT_PATH
    );

    const variants = await prismaDirect.productVariant.findMany({
      where: {
        // Only variants that know their Strapi size-row
        strapiSizeId: { not: null },
      },
      include: {
        inventoryItems: {
          select: {
            onHand: true,
            safetyStock: true,
            reserved: true,
          },
        },
      },
    });

    totalVariants = variants.length;

    console.log(
      `🔍 [API] Found ${totalVariants} variants with strapiSizeId to sync`
    );

    // Use the SAME availability logic as the cron route
    const itemsPayload = variants.map((v) => {
      const available = computeAvailableFromInventoryItems(
        v.inventoryItems,
        v.stockAvailable // fallback if no inventory rows
      );

      return {
        sizeId: v.strapiSizeId,
        stock: available,
      };
    });

    const batchSize = 200;

    for (let i = 0; i < itemsPayload.length; i += batchSize) {
      const batch = itemsPayload.slice(i, i + batchSize);

      console.log(
        `➡️  [API] Updating Strapi stock for ${batch.length} size rows (batch ${
          i / batchSize + 1
        })`
      );

      const res = await strapiPostUpdateStock(batch);

      const updatedCount = Array.isArray(res?.updated)
        ? res.updated.length
        : 0;

      totalUpdated += updatedCount;

      console.log(
        `✅ [API] Strapi response: ${updatedCount} rows updated in this batch`
      );
    }

    console.log("✅ [API] Prisma → Strapi stock sync complete");

    // ───────── log success ─────────
    try {
      await prismaDirect.stockSyncLog.create({
        data: {
          triggeredByUserId: userId,
          triggeredByEmail: userEmail,
          totalVariants: totalVariants,
          totalUpdated: totalUpdated,
          status: "SUCCESS",
          message: "Prisma → Strapi stock sync complete (admin)",
          errorDetail: null,
        },
      });
    } catch (logErr) {
      console.error("⚠️ [API] Failed to write StockSyncLog (SUCCESS):", logErr);
    }

    return json({
      ok: true,
      message: "Prisma → Strapi stock sync complete",
      totalVariants,
      totalUpdated,
    });
  } catch (err) {
    console.error("❌ [API] Stock sync failed:", err);

    const errorDetail =
      (err && err.message ? String(err.message) : String(err)).slice(0, 2000);

    // ───────── log failure ─────────
    try {
      await prismaDirect.stockSyncLog.create({
        data: {
          triggeredByUserId: userId,
          triggeredByEmail: userEmail,
          totalVariants: totalVariants,
          totalUpdated: totalUpdated,
          status: "ERROR",
          message: "Stock sync failed (admin)",
          errorDetail,
        },
      });
    } catch (logErr) {
      console.error("⚠️ [API] Failed to write StockSyncLog (ERROR):", logErr);
    }

    return json(
      {
        error: "Stock sync failed",
        detail: errorDetail,
      },
      500
    );
  }
}
