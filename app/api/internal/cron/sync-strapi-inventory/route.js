// PATH: app/api/internal/cron/sync-strapi-inventory/route.js
// Internal cron endpoint: Prisma (Inventory) → Strapi (size-row stock_quantity)
//
// Source of truth = Prisma:
//   - InventoryItem.onHand / safetyStock / reserved
//   - Fallback: ProductVariant.stockAvailable when no inventory rows
//
// This route is meant for CRON / schedulers (Neon cron, GitHub Actions, etc).
// Call examples:
//
//   GET http://localhost:3000/api/internal/cron/sync-strapi-inventory?secret=YOUR_TOKEN
//   GET http://localhost:3000/api/internal/cron/sync-strapi-inventory?secret=YOUR_TOKEN&dry=1
//
// Security:
//   INTERNAL_CRON_TOKEN (preferred) or CRON_SECRET (legacy) in .env

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import prisma from "@/lib/prisma";

// ───────────────────────── config ─────────────────────────

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
 *   - We **ignore** STRAPI_URL / STRAPI_API_URL even if they point to cms.thednalabstore.com
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

// Accept all the token variants you’ve been using
const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

// Prefer INTERNAL_CRON_TOKEN, fall back to CRON_SECRET
const CRON_SECRET =
  process.env.INTERNAL_CRON_TOKEN || process.env.CRON_SECRET || "";

// Optional override in case your endpoint path changes in Strapi
// Default assumes you have a custom Strapi route:
//   POST /api/tdlc-sync/update-stock
const STRAPI_STOCK_ENDPOINT_PATH =
  process.env.STRAPI_STOCK_ENDPOINT_PATH || "/api/tdlc-sync/update-stock";

// ───────────────────────── helpers ─────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function bad(code, status = 400, extra = {}) {
  return json({ ok: false, code, ...extra }, status);
}

function clampInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return Math.round(v);
}

/**
 * available = Σ(onHand - safetyStock - reserved), clamped at 0.
 * If there are no inventory rows, we fall back to ProductVariant.stockAvailable.
 */
function computeAvailableFromInventoryItems(items = [], fallbackStockAvailable) {
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

/**
 * Build payload items for Strapi's /api/tdlc-sync/update-stock:
 *
 *   [{ sizeId, stock }, ...]
 *
 * Uses Prisma as the stock master.
 * Assumes ProductVariant has a field `strapiSizeId` that points to the Strapi size-row.
 */
async function buildItemsPayload() {
  const variants = await prisma.productVariant.findMany({
    where: {
      // Only variants that know their Strapi "size_stocks" row id
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

  const items = variants.map((v) => {
    const stock = computeAvailableFromInventoryItems(
      v.inventoryItems,
      v.stockAvailable
    );

    return {
      sizeId: v.strapiSizeId,
      stock,
    };
  });

  return {
    variantsCount: variants.length,
    items,
  };
}

/**
 * Strapi POST helper → calls your custom endpoint:
 *   /api/tdlc-sync/update-stock  (or overridden path)
 *
 * Body shape:
 *   { items: [{ sizeId, stock }, ...] }
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
    `[CRON] POST → Strapi stock endpoint: ${url.toString()} (batch size: ${itemsBatch.length})`
  );
  console.log(`[CRON] NODE_ENV=${process.env.NODE_ENV} IS_DEV=${IS_DEV}`);
  console.log(`[CRON] STRAPI_BASE=${STRAPI_BASE}`);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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

/**
 * Validate cron secret from:
 *   - ?secret=... query param, or
 *   - x-cron-secret header
 */
function assertCronAuth(req) {
  if (!CRON_SECRET) {
    throw new Error("CRON_SECRET / INTERNAL_CRON_TOKEN not configured");
  }

  const url = new URL(req.url);
  const secretFromQuery = url.searchParams.get("secret");
  const secretFromHeader = req.headers.get("x-cron-secret");

  const token = secretFromQuery || secretFromHeader;

  if (!token || token !== CRON_SECRET) {
    throw new Error("UNAUTHORIZED_CRON_TOKEN");
  }
}

// ───────────────────────── GET (cron entrypoint) ─────────────────────────

export async function GET(req) {
  const startedAt = Date.now();

  try {
    // 1) Security: cron secret
    try {
      assertCronAuth(req);
    } catch (authErr) {
      console.error("[sync-strapi-inventory] Auth failed:", authErr);
      return bad("UNAUTHORIZED", 401, { error: authErr.message });
    }

    const url = new URL(req.url);
    const dry =
      url.searchParams.get("dry") === "1" ||
      url.searchParams.get("mode") === "snapshot";

    if (!STRAPI_BASE) {
      return bad("STRAPI_CONFIG_MISSING", 500, {
        detail:
          "STRAPI_API_URL / STRAPI_URL / NEXT_PUBLIC_STRAPI_API_URL must be configured.",
        STRAPI_BASE,
      });
    }

    if (!STRAPI_TOKEN && !dry) {
      // For dry-run we allow missing token, since we won't call Strapi
      return bad("STRAPI_TOKEN_MISSING", 500, {
        detail:
          "STRAPI_API_TOKEN / STRAPI_GRAPHQL_TOKEN (or equivalent) must be configured in env for inventory sync.",
      });
    }

    console.log("🔒 [CRON] Internal cron token validated");
    console.log("🌐 [CRON] STRAPI_BASE =", STRAPI_BASE);
    console.log(
      "🌐 [CRON] STRAPI_STOCK_ENDPOINT_PATH =",
      STRAPI_STOCK_ENDPOINT_PATH
    );
    console.log("🔄 [CRON] Building items payload from Prisma…");

    // 2) Build payload from Prisma (Inventory master)
    const { variantsCount, items } = await buildItemsPayload();

    if (!variantsCount || !items.length) {
      const ms = Date.now() - startedAt;

      try {
        await prisma.stockSyncLog.create({
          data: {
            triggeredByUserId: null,
            triggeredByEmail: null,
            status: "SUCCESS",
            message:
              "CRON Prisma → Strapi stock sync: no Strapi-linked variants found",
            totalVariants: 0,
            totalUpdated: 0,
            errorDetail: null,
          },
        });
      } catch (logErr) {
        console.error(
          "⚠️ [CRON] Failed to write StockSyncLog (SUCCESS / empty):",
          logErr
        );
      }

      return json({
        ok: true,
        summary: {
          variantsCount: 0,
          totalUpdated: 0,
          ms,
          note: "No Strapi-linked variants found to sync.",
        },
      });
    }

    console.log(
      `🔍 [CRON] Found ${variantsCount} variants with strapiSizeId to sync`
    );

    // DRY mode → skip Strapi and just return snapshot
    if (dry) {
      const ms = Date.now() - startedAt;
      console.log(
        "💤 [CRON] DRY RUN mode – NOT calling Strapi, returning Prisma snapshot only"
      );

      try {
        await prisma.stockSyncLog.create({
          data: {
            triggeredByUserId: null,
            triggeredByEmail: null,
            status: "SUCCESS",
            message: "CRON stock sync DRY RUN (no Strapi call)",
            totalVariants: variantsCount,
            totalUpdated: 0,
            errorDetail: null,
          },
        });
      } catch (logErr) {
        console.error(
          "⚠️ [CRON] Failed to write StockSyncLog (DRY RUN):",
          logErr
        );
      }

      return json({
        ok: true,
        summary: {
          variantsCount,
          totalUpdated: 0,
          ms,
          mode: "DRY_RUN",
          STRAPI_BASE,
        },
      });
    }

    // 3) Send in batches to Strapi /api/tdlc-sync/update-stock
    const batchSize = 200;
    let totalUpdated = 0;
    const batchSummaries = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      console.log(
        `➡️  [CRON] Updating Strapi stock for ${batch.length} size rows (batch ${
          i / batchSize + 1
        })`
      );

      const res = await strapiPostUpdateStock(batch);

      const updatedCount = Array.isArray(res?.updated)
        ? res.updated.length
        : 0;

      totalUpdated += updatedCount;

      batchSummaries.push({
        batch: i / batchSize + 1,
        sent: batch.length,
        updated: updatedCount,
      });

      console.log(
        `✅ [CRON] Strapi response: ${updatedCount} rows updated in this batch`
      );
    }

    const ms = Date.now() - startedAt;
    console.log("✅ [CRON] Prisma → Strapi stock sync complete");

    try {
      await prisma.stockSyncLog.create({
        data: {
          triggeredByUserId: null,
          triggeredByEmail: null,
          status: "SUCCESS",
          message: "CRON Prisma → Strapi stock sync complete",
          totalVariants: variantsCount,
          totalUpdated,
          errorDetail: null,
        },
      });
    } catch (logErr) {
      console.error("⚠️ [CRON] Failed to write StockSyncLog (SUCCESS):", logErr);
    }

    return json({
      ok: true,
      summary: {
        variantsCount,
        totalUpdated,
        ms,
        batches: batchSummaries,
        STRAPI_BASE,
      },
    });
  } catch (err) {
    console.error("[sync-strapi-inventory] Fatal error:", err);

    const errorDetail = err?.message || String(err);
    const ms = Date.now() - startedAt;

    try {
      await prisma.stockSyncLog.create({
        data: {
          triggeredByUserId: null,
          triggeredByEmail: null,
          status: "ERROR",
          message: "CRON stock sync failed",
          totalVariants: 0,
          totalUpdated: 0,
          errorDetail: errorDetail.slice(0, 2000),
        },
      });
    } catch (logErr) {
      console.error("⚠️ [CRON] Failed to write StockSyncLog (ERROR):", logErr);
    }

    return bad("INTERNAL_ERROR", 500, {
      error: errorDetail,
      ms,
      STRAPI_BASE,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        STRAPI_URL: process.env.STRAPI_URL,
        STRAPI_API_URL: process.env.STRAPI_API_URL,
        NEXT_PUBLIC_STRAPI_API_URL: process.env.NEXT_PUBLIC_STRAPI_API_URL,
        STRAPI_API_ORIGIN: process.env.STRAPI_API_ORIGIN,
      },
    });
  }
}
