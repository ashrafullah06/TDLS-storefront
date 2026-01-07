// FILE: app/api/internal/strapi-sync/products/route.js 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const STRAPI_ORIGIN =
  process.env.STRAPI_API_ORIGIN ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.STRAPI_API_URL ||
  "http://127.0.0.1:1337";

const SYNC_SECRET = process.env.STRAPI_SYNC_SECRET || "";

// Use the same REST API token as your admin sync / cron routes
const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN ||
  process.env.STRAPI_GRAPHQL_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_API_TOKEN ||
  process.env.NEXT_PUBLIC_STRAPI_TOKEN ||
  process.env.STRAPI_TOKEN ||
  "";

/* -------- tiny helpers -------- */

function j(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAttr(p) {
  return p && p.attributes ? p.attributes : p;
}

/**
 * Try to normalize Strapi’s webhook payload into a single
 * { id, slug, entry, model, isTest } object.
 */
function normalizeWebhookPayload(rawBody = {}) {
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};

  const event = body.event || body.action || "";
  const isTest =
    typeof event === "string" &&
    event.toLowerCase().includes("test"); // e.g. webhook:test

  const model =
    body.model ||
    body.uid ||
    body["content-type"] ||
    body.contentType ||
    (body.entry && body.entry.__contentType) ||
    (body.data && body.data.__contentType) ||
    "";

  const candidates = [];

  if (body.entry && typeof body.entry === "object") candidates.push(body.entry);
  if (body.product && typeof body.product === "object")
    candidates.push(body.product);
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data))
    candidates.push(body.data);
  if (
    Array.isArray(body.data) &&
    body.data.length > 0 &&
    typeof body.data[0] === "object"
  ) {
    candidates.push(body.data[0]);
  }
  if (
    Array.isArray(body.entries) &&
    body.entries.length > 0 &&
    typeof body.entries[0] === "object"
  ) {
    candidates.push(body.entries[0]);
  }
  if (
    Array.isArray(body.records) &&
    body.records.length > 0 &&
    typeof body.records[0] === "object"
  ) {
    candidates.push(body.records[0]);
  }

  if (!candidates.length) candidates.push(body);

  let id = null;
  let slug = null;
  let entry = candidates[0];

  for (const node of candidates) {
    if (!node || typeof node !== "object") continue;
    const a = getAttr(node);

    const candId = node.id ?? a?.id ?? a?.documentId ?? null;

    const candSlug =
      a?.slug ??
      node.slug ??
      a?.uid ??
      node.uid ??
      a?.handle ??
      null;

    if (candId != null && id == null) id = candId;
    if (candSlug && !slug) slug = candSlug;
  }

  if (id == null && body.id != null) id = body.id;
  if (!slug) slug = body.slug || body.uid || null;

  return { id, slug, entry, model, isTest };
}

/**
 * Extract variants from Strapi product.
 */
function getVariants(product) {
  const a = getAttr(product);
  let v =
    a?.variants ||
    a?.product_variants ||
    a?.product_variants_json ||
    a?.variants_json ||
    null;

  if (!v) return [];

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  if (Array.isArray(v?.data)) return v.data.map((x) => getAttr(x));
  if (Array.isArray(v)) return v;
  return [];
}

/**
 * Extract sizes from a variant node.
 */
function getSizes(variant) {
  const v = getAttr(variant);
  let s =
    v?.sizes ||
    v?.size_stocks ||
    v?.sizeStocks ||
    v?.sizes_json ||
    null;

  if (!s) return [];

  if (typeof s === "string") {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  if (Array.isArray(s?.data)) return s.data.map((x) => getAttr(x));
  if (Array.isArray(s)) return s;

  return [];
}

/* -------- Strapi fetch helper (with Authorization) -------- */

async function getJson(url) {
  const headers = {
    Accept: "application/json",
    ...(STRAPI_TOKEN ? { Authorization: `Bearer ${STRAPI_TOKEN}` } : {}),
  };

  console.log("[strapi-sync] Fetching from Strapi:", url);

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(
      `Strapi fetch failed ${res.status} ${res.statusText} – ${t}`
    );
    throw new Error(`Strapi fetch failed ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchStrapiProduct({ id, slug }) {
  const url = new URL("/api/products", STRAPI_ORIGIN);
  if (id) {
    url.searchParams.set("filters[id][$eq]", String(id));
  } else if (slug) {
    url.searchParams.set("filters[slug][$eq]", String(slug));
  }
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate", "deep,5");

  const json = await getJson(url.toString());
  const data = Array.isArray(json?.data) ? json.data : [];

  console.log(
    `[strapi-sync] Strapi returned ${data.length} product(s) for id=${
      id ?? "?"
    } slug="${slug ?? ""}"`
  );

  return data[0] || null;
}

/* -------- Prisma upsert helpers -------- */

async function upsertProductFromStrapiNode(node, db) {
  const a = getAttr(node);
  const strapiIdRaw = node?.id ?? a?.id ?? a?.documentId ?? null;
  const strapiId =
    strapiIdRaw != null && !Number.isNaN(Number(strapiIdRaw))
      ? Number(strapiIdRaw)
      : null;

  const slug = a?.slug ? String(a.slug) : a?.uid ? String(a.uid) : null;
  const title =
    a?.name || a?.title || slug || `strapi-${strapiId || "unknown"}`;

  if (!slug && strapiId == null) {
    console.warn("[strapi-sync] Skipping product with no slug/id:", {
      strapiIdRaw,
      slug,
    });
    return null;
  }

  const whereOR = [];
  if (strapiId != null) whereOR.push({ strapiId });
  if (slug) {
    whereOR.push({ slug });
    whereOR.push({ strapiSlug: slug });
  }

  let existing = null;
  if (whereOR.length) {
    existing = await db.product.findFirst({ where: { OR: whereOR } });
  }

  const baseData = { title: String(title) };
  if (slug) baseData.slug = slug;
  if (strapiId != null) baseData.strapiId = strapiId;
  if (slug) baseData.strapiSlug = slug;
  if (a?.updatedAt) baseData.strapiUpdatedAt = new Date(a.updatedAt);

  if (!existing) {
    const created = await db.product.create({ data: baseData });
    console.log(
      `[strapi-sync] Created Product id=${created.id} ← Strapi id=${strapiId} slug="${slug}"`
    );
    return created;
  }

  const updated = await db.product.update({
    where: { id: existing.id },
    data: baseData,
  });
  console.log(
    `[strapi-sync] Updated Product id=${updated.id} ← Strapi id=${strapiId} slug="${slug}"`
  );
  return updated;
}

/**
 * Upsert a ProductVariant and handle stock coming from Strapi size row.
 *
 * CREATE:
 *   - initialStock = stockQty
 *   - stockAvailable = stockQty
 *   - stockReserved = 0
 *
 * UPDATE:
 *   - always mirror Strapi into strapiStockRaw + strapiStockSyncedAt
 *   - if stockQty > current stockAvailable → RESTOCK:
 *       stockAvailable = stockQty
 *       initialStock = max(initialStock, stockQty)
 *   - if stockQty <= stockAvailable → keep Prisma as authority (orders).
 */
async function upsertVariantForSize(
  { prismaProduct, color, sizeId, sizeName, stockQty },
  db
) {
  const productId = prismaProduct.id;
  const colorLabel = (color || "default").toString().trim() || "default";
  const sizeLabel = (sizeName || "ONE").toString().trim() || "ONE";

  let existing = null;
  if (sizeId != null) {
    existing = await db.productVariant.findUnique({
      where: { strapiSizeId: sizeId },
    });
  }

  if (!existing) {
    existing = await db.productVariant.findFirst({
      where: { productId, colorLabel, sizeLabel },
    });
  }

  const baseData = { productId, colorLabel, sizeLabel };
  if (sizeId != null) baseData.strapiSizeId = sizeId;

  const safeStock =
    Number.isFinite(Number(stockQty)) && Number(stockQty) > 0
      ? Math.round(Number(stockQty))
      : 0;

  if (!existing) {
    const created = await db.productVariant.create({
      data: {
        ...baseData,
        initialStock: safeStock,
        stockAvailable: safeStock,
        stockReserved: 0,
        strapiStockRaw: safeStock,
        strapiStockSyncedAt: new Date(),
      },
    });
    console.log(
      `[strapi-sync]   CREATED variant id=${created.id} product=${productId} color="${colorLabel}" size="${sizeLabel}" strapiSizeId=${sizeId} stock=${safeStock}`
    );
    return created;
  }

  const currentAvailable = Number(existing.stockAvailable ?? 0) || 0;

  const updateData = {
    ...baseData,
    strapiStockRaw: safeStock,
    strapiStockSyncedAt: new Date(),
  };

  if (safeStock > currentAvailable) {
    // RESTOCK: Strapi has MORE stock than Prisma – bump Prisma up
    updateData.stockAvailable = safeStock;
    if ((existing.initialStock ?? 0) < safeStock) {
      updateData.initialStock = safeStock;
    }
    console.log(
      `[strapi-sync]   RESTOCK variant id=${existing.id} product=${productId} color="${colorLabel}" size="${sizeLabel}" Prisma=${currentAvailable} Strapi=${safeStock}`
    );
  } else if (safeStock < currentAvailable) {
    // Do NOT reduce Prisma stock from Strapi – orders live in Prisma
    console.log(
      `[strapi-sync]   NOTE: Strapi stock (${safeStock}) < Prisma stockAvailable (${currentAvailable}) for variant id=${existing.id}. Keeping Prisma as authority.`
    );
  } else {
    console.log(
      `[strapi-sync]   NO CHANGE variant id=${existing.id} product=${productId} color="${colorLabel}" size="${sizeLabel}" stock=${currentAvailable}`
    );
  }

  const updated = await db.productVariant.update({
    where: { id: existing.id },
    data: updateData,
  });
  return updated;
}

/**
 * Core sync logic so POST (webhook) and GET (manual) share 100% same behaviour.
 *
 * IMPORTANT:
 * - We avoid long interactive Prisma transactions; Neon + PgBouncer can throw
 *   "Transaction not found" with `prisma.$transaction(async (db)=>{...})`.
 * - Direction rules:
 *     Strapi → Prisma:
 *       - create / restock (only when Strapi stock > Prisma stockAvailable)
 *     Prisma → Strapi:
 *       - your existing cron / order-complete sync updates Strapi from Prisma.
 *   This prevents infinite loops while keeping both sides in sync.
 */
async function syncProductFromStrapi({ id, slug }) {
  console.log(
    `[strapi-sync] syncProductFromStrapi start id=${id ?? "?"} slug="${slug ?? ""}"`
  );

  const strapiProduct = await fetchStrapiProduct({ id, slug });

  if (!strapiProduct) {
    console.warn(
      `[strapi-sync] No product found in Strapi for id=${id ?? "?"} slug="${slug ?? ""}"`
    );
    return {
      ok: false,
      code: "PRODUCT_NOT_FOUND_IN_STRAPI",
      prismaProduct: null,
      createdVariants: 0,
      updatedVariants: 0,
      failedSizes: 0,
      removedVariants: 0,
      id,
      slug,
    };
  }

  const db = prisma;

  // 1) Upsert product itself
  const prismaProduct = await upsertProductFromStrapiNode(strapiProduct, db);
  if (!prismaProduct) {
    return {
      ok: false,
      code: "PRODUCT_UPSERT_FAILED",
      prismaProduct: null,
      createdVariants: 0,
      updatedVariants: 0,
      failedSizes: 0,
      removedVariants: 0,
    };
  }

  // 2) Upsert all variants / sizes
  const variants = getVariants(strapiProduct);
  console.log(
    `[strapi-sync] Product id=${prismaProduct.id} has ${variants.length} Strapi variant node(s)`
  );

  let createdVariants = 0;
  let updatedVariants = 0;
  let failedSizes = 0;
  const seenSizeIds = new Set();

  for (const v of variants) {
    const va = getAttr(v);

    const color =
      va.color ||
      va.colour ||
      va.color_label ||
      va.colorLabel ||
      va.colour_label ||
      va.colourLabel ||
      va.hex ||
      va.name ||
      "default";

    const sizes = getSizes(v);
    console.log(
      `[strapi-sync]   Variant color="${color}" has ${sizes.length} size row(s)`
    );
    if (!sizes.length) continue;

    for (const sRaw of sizes) {
      const s = getAttr(sRaw);

      const sizeIdRaw = s?.id ?? s?.strapi_id ?? s?.documentId ?? null;
      const sizeId =
        sizeIdRaw != null && !Number.isNaN(Number(sizeIdRaw))
          ? Number(sizeIdRaw)
          : null;

      const sizeName =
        s.size_name ||
        s.size ||
        s.label ||
        s.primary_value ||
        s.code ||
        "ONE";

      // 🔥 FULL-PROOF STOCK FIELD DETECTION
      // support both snake_case and camelCase used in Strapi / legacy components
      const rawStock =
        s.stock_quantity ??        // snake_case
        s.stockQuantity ??         // camelCase (very likely in your size component)
        s.stock ??                 // generic
        s.qty ??                   // generic
        s.quantity ??              // generic
        s.available_stock ??       // possible alternative
        s.availableStock ??        // camelCase alternative
        0;

      const numStock = Number(rawStock);
      const stockQty =
        Number.isFinite(numStock) && numStock > 0 ? Math.round(numStock) : 0;

      console.log(
        `[strapi-sync]     Size row sizeId=${sizeId ?? "?"} size="${sizeName}" rawStock=${rawStock} → stockQty=${stockQty}`
      );

      try {
        let before = null;
        if (sizeId != null) {
          before = await db.productVariant.findUnique({
            where: { strapiSizeId: sizeId },
          });
          seenSizeIds.add(sizeId);
        }

        const variant = await upsertVariantForSize(
          { prismaProduct, color, sizeId, sizeName, stockQty },
          db
        );

        if (!before && variant) createdVariants += 1;
        if (before && variant) updatedVariants += 1;
      } catch (err) {
        failedSizes += 1;
        console.warn(
          `[strapi-sync] FAILED size for product="${prismaProduct.slug}" color="${color}" size="${sizeName}" sizeId=${sizeId}:`,
          err?.message || err
        );
      }
    }
  }

  // 3) Cleanup stale variants for this product (when we have size IDs)
  let removedVariants = 0;
  if (seenSizeIds.size > 0) {
    const deleteRes = await db.productVariant.deleteMany({
      where: {
        productId: prismaProduct.id,
        strapiSizeId: {
          not: null,
          notIn: Array.from(seenSizeIds),
        },
      },
    });
    removedVariants = deleteRes.count || 0;
    if (removedVariants > 0) {
      console.log(
        `[strapi-sync]   Removed ${removedVariants} stale variants for product=${prismaProduct.id}`
      );
    }
  }

  console.log(
    `[strapi-sync] DONE product id=${prismaProduct.id} created=${createdVariants} updated=${updatedVariants} failedSizes=${failedSizes} removed=${removedVariants}`
  );

  return {
    ok: true,
    code: "OK",
    prismaProduct,
    createdVariants,
    updatedVariants,
    failedSizes,
    removedVariants,
  };
}

/* -------- GET: manual debug sync -------- */

export async function GET(req) {
  try {
    if (!SYNC_SECRET) {
      console.error(
        "[strapi-sync][GET] STRAPI_SYNC_SECRET not set in Next env; refusing sync"
      );
      return j({ ok: false, code: "SERVER_MISCONFIGURED" }, 500);
    }

    const url = new URL(req.url);
    const secret = url.searchParams.get("secret") || "";

    if (secret !== SYNC_SECRET) {
      console.warn("[strapi-sync][GET] Invalid secret");
      return j({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    const idParam = url.searchParams.get("id");
    const slug = url.searchParams.get("slug") || null;
    const id = idParam ? Number(idParam) : null;

    // Health check mode – just /products?secret=...
    if (!id && !slug) {
      console.log("[strapi-sync][GET] Health check OK");
      return j({
        ok: true,
        code: "HEALTH_OK",
        message:
          "Strapi → Prisma product sync endpoint is alive. Provide ?id= or ?slug= to sync a specific product.",
      });
    }

    console.log(
      `[strapi-sync][GET] Manual sync for product id=${id ?? "?"} slug="${slug ?? ""}"`
    );

    const result = await syncProductFromStrapi({ id, slug });

    if (!result.ok && result.code === "PRODUCT_NOT_FOUND_IN_STRAPI") {
      return j(result, 404);
    }
    if (!result.ok && result.code === "PRODUCT_UPSERT_FAILED") {
      return j(result, 500);
    }

    return j({
      ok: true,
      mode: "MANUAL_GET",
      productId: result.prismaProduct.id,
      createdVariants: result.createdVariants,
      updatedVariants: result.updatedVariants,
      failedSizes: result.failedSizes,
      removedVariants: result.removedVariants,
    });
  } catch (err) {
    console.error("[strapi-sync][GET] ERROR:", err);
    return j(
      {
        ok: false,
        code: "INTERNAL_ERROR",
        message: err?.message || String(err),
      },
      500
    );
  }
}

/* -------- POST: real Strapi webhook -------- */

export async function POST(req) {
  try {
    if (!SYNC_SECRET) {
      console.error(
        "[strapi-sync][POST] STRAPI_SYNC_SECRET not set in Next env; refusing sync"
      );
      return j({ ok: false, code: "SERVER_MISCONFIGURED" }, 500);
    }

    const headerSecret = req.headers.get("x-strapi-sync-secret") || "";
    if (headerSecret !== SYNC_SECRET) {
      console.warn("[strapi-sync][POST] Invalid secret header");
      return j({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    const raw = await req.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return j({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const { id, slug, model, isTest } = normalizeWebhookPayload(body);

    if (!id && !slug && isTest) {
      console.log("[strapi-sync][POST] Received test webhook, responding OK");
      return j({ ok: true, code: "TEST_WEBHOOK" }, 200);
    }

    if (model && !String(model).toLowerCase().includes("product")) {
      console.log(
        `[strapi-sync][POST] Ignoring webhook for non-product model="${model}"`
      );
      return j({ ok: true, code: "IGNORED_MODEL", model }, 200);
    }

    if (!id && !slug) {
      console.warn("[strapi-sync][POST] Missing id/slug in webhook payload");
      return j({ ok: false, code: "MISSING_KEYS" }, 400);
    }

    console.log(
      `[strapi-sync][POST] Webhook for product id=${id ?? "?"} slug="${
        slug ?? ""
      }" model="${model || ""}"`
    );

    const result = await syncProductFromStrapi({ id, slug });

    if (!result.ok && result.code === "PRODUCT_NOT_FOUND_IN_STRAPI") {
      return j(result, 404);
    }
    if (!result.ok && result.code === "PRODUCT_UPSERT_FAILED") {
      return j(result, 500);
    }

    return j({
      ok: true,
      productId: result.prismaProduct.id,
      createdVariants: result.createdVariants,
      updatedVariants: result.updatedVariants,
      failedSizes: result.failedSizes,
      removedVariants: result.removedVariants,
    });
  } catch (err) {
    console.error("[strapi-sync][POST] ERROR:", err);
    return j({ ok: false, code: "INTERNAL_ERROR" }, 500);
  }
}
