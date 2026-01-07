// FILE: app/api/admin/catalog/diagnostics/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { appDb } from "@/lib/db";
import { api as strapiApi } from "@/lib/strapi";
import { getStrapiMediaUrl, pickBestImageUrl } from "@/lib/strapimedia";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function str(v) {
  return String(v ?? "").trim();
}

function int(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function boolParam(v) {
  const s = str(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeStrapiStatus(raw) {
  const v = str(raw);
  if (!v) return "";
  if (["Draft", "Active", "Archived"].includes(v)) return v;
  const lc = v.toLowerCase();
  if (lc === "draft") return "Draft";
  if (lc === "active") return "Active";
  if (lc === "archived") return "Archived";
  return "";
}

function normalizeMoney(v) {
  // Strapi can return number or string; Prisma Decimal returns object->string
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nearlyEqualMoney(a, b, eps = 0.01) {
  const x = normalizeMoney(a);
  const y = normalizeMoney(b);
  if (x == null || y == null) return false;
  return Math.abs(x - y) <= eps;
}

function normalizeMediaRelation(rel) {
  // Strapi REST: rel.data can be array/object
  const data = rel?.data;
  if (!data) return [];
  const arr = Array.isArray(data) ? data : [data];
  return arr
    .map((n) => {
      const a = n?.attributes || {};
      const url = pickBestImageUrl(a) || a?.url || null;
      return url ? getStrapiMediaUrl(url) : null;
    })
    .filter(Boolean);
}

function pickAnyThumbnail(attrs) {
  // Use only fields that may exist; do not fabricate.
  const images = normalizeMediaRelation(attrs?.images);
  if (images[0]) return images[0];

  const gallery = normalizeMediaRelation(attrs?.gallery);
  if (gallery[0]) return gallery[0];

  const thumb =
    attrs?.thumbnail?.data?.attributes?.url
      ? getStrapiMediaUrl(attrs.thumbnail.data.attributes.url)
      : null;
  if (thumb) return thumb;

  const cover =
    attrs?.cover?.data?.attributes?.url
      ? getStrapiMediaUrl(attrs.cover.data.attributes.url)
      : null;
  if (cover) return cover;

  return null;
}

function extractStrapiSizeStockIds(attrs) {
  const ids = [];
  const variants = Array.isArray(attrs?.product_variants) ? attrs.product_variants : [];
  for (const v of variants) {
    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of sizeStocks) {
      if (s?.id != null) ids.push(String(s.id));
    }
  }
  return Array.from(new Set(ids));
}

function extractStrapiSizeStockPricing(attrs) {
  // Map sizeStockId -> { priceOverride, price, compareAt, currency }
  const out = new Map();
  const currency = str(attrs?.currency) || null;
  const variants = Array.isArray(attrs?.product_variants) ? attrs.product_variants : [];
  for (const v of variants) {
    const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of sizeStocks) {
      const id = s?.id != null ? String(s.id) : "";
      if (!id) continue;
      out.set(id, {
        currency,
        priceOverride: typeof s?.price_override === "boolean" ? s.price_override : null,
        price: normalizeMoney(s?.price),
        compareAt: normalizeMoney(s?.compare_at_price),
      });
    }
  }
  return out;
}

function pickAppPriceForCurrency(prices, currency) {
  // Prefer: minQty=1, (maxQty null or >=1), currency match, and default list (priceListId null) if present
  const cur = str(currency);
  const rows = Array.isArray(prices) ? prices : [];
  const filtered = rows
    .filter((p) => str(p?.currency) === cur)
    .filter((p) => int(p?.minQty, 1) === 1)
    .filter((p) => {
      const mx = p?.maxQty == null ? null : int(p.maxQty, 0);
      return mx == null || mx >= 1;
    });

  if (!filtered.length) return null;

  const defaultList = filtered.filter((p) => p?.priceListId == null);
  const pool = defaultList.length ? defaultList : filtered;

  // Deterministic pick: lowest amount (common default), then newest as tie-breaker
  const sorted = pool
    .slice()
    .sort((a, b) => {
      const aa = normalizeMoney(a?.amount);
      const bb = normalizeMoney(b?.amount);
      if (aa == null && bb == null) return 0;
      if (aa == null) return 1;
      if (bb == null) return -1;
      if (aa !== bb) return aa - bb;
      const ad = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bd = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bd - ad;
    });

  const top = sorted[0];
  if (!top) return null;

  return {
    amount: normalizeMoney(top.amount),
    compareAt: normalizeMoney(top.compareAt),
    currency: str(top.currency) || null,
    priceListId: top.priceListId ?? null,
  };
}

function buildActions(issues) {
  const actions = [];
  const has = (code) => issues.some((i) => i?.code === code);

  if (has("MISSING_APP_BRIDGE_PRODUCT")) {
    actions.push({
      key: "SYNC_PRODUCT_BRIDGE",
      label: "Sync product bridge from Strapi to app DB",
      severity: "high",
    });
  }

  if (has("MISSING_APP_VARIANT_MAPPINGS") || has("ORPHAN_APP_VARIANTS")) {
    actions.push({
      key: "REPAIR_VARIANT_BRIDGE",
      label: "Repair variant mappings (strapiSizeId ⇄ size_stock.id)",
      severity: "high",
    });
  }

  if (has("MISSING_MEDIA")) {
    actions.push({
      key: "ADD_MEDIA_IN_STRAPI",
      label: "Add images/gallery media in Strapi",
      severity: "medium",
    });
  }

  if (has("PRICE_MISMATCH_PRODUCT") || has("PRICE_MISMATCH_VARIANT") || has("MISSING_APP_PRICE")) {
    actions.push({
      key: "RECONCILE_PRICES",
      label: "Reconcile prices between Strapi and app DB",
      severity: "medium",
    });
  }

  return actions;
}

export async function GET(req) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const url = new URL(req.url);

    const q = str(url.searchParams.get("q"));
    const status = normalizeStrapiStatus(url.searchParams.get("status"));
    const page = Math.max(1, int(url.searchParams.get("page"), 1));
    const pageSize = clamp(int(url.searchParams.get("pageSize"), 25), 1, 100);

    const onlyProblems = boolParam(url.searchParams.get("onlyProblems"));
    const includeOk = boolParam(url.searchParams.get("includeOk")) || !onlyProblems;

    // Scope controls (optional). If none provided, run all.
    const scope = str(url.searchParams.get("scope")).toLowerCase(); // "mapping"|"media"|"pricing"|"all"
    const doMapping = !scope || scope === "all" || scope === "mapping";
    const doMedia = !scope || scope === "all" || scope === "media";
    const doPricing = !scope || scope === "all" || scope === "pricing";

    // Sorting for Strapi list. Keep deterministic.
    const sortRaw = str(url.searchParams.get("sort")) || "updatedAt:desc";
    const sortStr = (() => {
      const [f, d] = sortRaw.split(":");
      const dir = (d || "desc").toLowerCase() === "asc" ? "asc" : "desc";
      if (f === "createdAt") return `createdAt:${dir}`;
      if (f === "name") return `name:${dir}`;
      if (f === "price") return `selling_price:${dir}`;
      return `updatedAt:${dir}`;
    })();

    const qs = [];
    qs.push(`pagination[page]=${page}`);
    qs.push(`pagination[pageSize]=${pageSize}`);
    qs.push(`sort=${encodeURIComponent(sortStr)}`);

    if (status) qs.push(`filters[status][$eq]=${encodeURIComponent(status)}`);

    if (q) {
      qs.push(`filters[$or][0][name][$containsi]=${encodeURIComponent(q)}`);
      qs.push(`filters[$or][1][slug][$containsi]=${encodeURIComponent(q)}`);
      qs.push(`filters[$or][2][product_code][$containsi]=${encodeURIComponent(q)}`);
      qs.push(`filters[$or][3][base_sku][$containsi]=${encodeURIComponent(q)}`);
    }

    // Populate only what is required for diagnostics.
    // Media relations need populate. Component product_variants comes inline.
    qs.push("populate[images]=*");
    qs.push("populate[gallery]=*");
    qs.push("populate[thumbnail]=*");
    qs.push("populate[cover]=*");

    const res = await strapiApi(`/api/products?${qs.join("&")}`);
    const nodes = Array.isArray(res?.data) ? res.data : [];
    const metaPag = res?.meta?.pagination || {};
    const total = int(metaPag?.total, nodes.length);

    const strapiProducts = nodes
      .map((n) => {
        const id = Number(n?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const a = n?.attributes || {};
        return {
          id,
          attrs: a,
          title: a.name ?? null,
          slug: a.slug ?? null,
          status: a.status ?? null,
          currency: a.currency ?? null,
          selling_price: a.selling_price ?? null,
          compare_price: a.compare_price ?? null,
        };
      })
      .filter(Boolean);

    const strapiIds = strapiProducts.map((p) => p.id);

    // Pull appDb bridges in bulk.
    // Includes prices + variants prices to support real price mismatch detection.
    const appProducts = strapiIds.length
      ? await appDb.product.findMany({
          where: { strapiId: { in: strapiIds } },
          select: {
            id: true,
            strapiId: true,
            archivedAt: true,
            prices: {
              select: {
                id: true,
                currency: true,
                amount: true,
                compareAt: true,
                minQty: true,
                maxQty: true,
                priceListId: true,
                updatedAt: true,
              },
            },
            variants: {
              select: {
                id: true,
                strapiSizeId: true,
                sku: true,
                barcode: true,
                sizeName: true,
                colorName: true,
                archivedAt: true,
                stockAvailable: true,
                prices: {
                  select: {
                    id: true,
                    currency: true,
                    amount: true,
                    compareAt: true,
                    minQty: true,
                    maxQty: true,
                    priceListId: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const appByStrapiId = new Map();
    for (const ap of appProducts) {
      const sid = Number(ap?.strapiId);
      if (Number.isFinite(sid)) appByStrapiId.set(sid, ap);
    }

    const diagnostics = [];
    for (const sp of strapiProducts) {
      const a = sp.attrs || {};
      const ap = appByStrapiId.get(sp.id) || null;

      const issues = [];

      // (1) Mapping / bridge checks
      let sizeStockIds = [];
      let sizeStockPricing = new Map();
      if (doMapping || doPricing) {
        sizeStockIds = extractStrapiSizeStockIds(a);
        sizeStockPricing = extractStrapiSizeStockPricing(a);
      }

      if (doMapping) {
        if (!ap) {
          issues.push({
            code: "MISSING_APP_BRIDGE_PRODUCT",
            severity: "high",
            message: "Strapi product exists but no appDb Product bridge row found (by strapiId).",
          });
        } else {
          const appVariants = Array.isArray(ap.variants) ? ap.variants : [];
          const appMap = new Map();
          for (const v of appVariants) {
            const key = str(v?.strapiSizeId);
            if (key) appMap.set(key, v);
          }

          // Missing mappings: Strapi size_stock.id not found in appDb ProductVariant.strapiSizeId
          const missing = sizeStockIds.filter((sid) => !appMap.has(sid));
          if (missing.length) {
            issues.push({
              code: "MISSING_APP_VARIANT_MAPPINGS",
              severity: "high",
              message:
                "One or more Strapi size stock rows have no mapped appDb ProductVariant (by strapiSizeId).",
              details: {
                missingCount: missing.length,
                exampleMissingStrapiSizeIds: missing.slice(0, 20),
              },
            });
          }

          // Orphan variants: appDb variants referencing size ids not present in Strapi product
          const strapiSet = new Set(sizeStockIds);
          const orphans = appVariants
            .map((v) => str(v?.strapiSizeId))
            .filter((sid) => sid && !strapiSet.has(sid));

          if (orphans.length) {
            issues.push({
              code: "ORPHAN_APP_VARIANTS",
              severity: "high",
              message:
                "One or more appDb variants reference strapiSizeId values not present in current Strapi product size_stocks.",
              details: {
                orphanCount: orphans.length,
                exampleOrphanStrapiSizeIds: orphans.slice(0, 20),
              },
            });
          }
        }
      }

      // (2) Media checks
      if (doMedia) {
        const thumb = pickAnyThumbnail(a);
        if (!thumb) {
          issues.push({
            code: "MISSING_MEDIA",
            severity: "medium",
            message:
              "No media found (images/gallery/thumbnail/cover). Catalog requires real images.",
          });
        }
      }

      // (3) Price mismatch checks (Strapi vs appDb)
      if (doPricing) {
        const currency = str(a.currency || "");
        const strapiBase = {
          selling: normalizeMoney(a.selling_price),
          compare: normalizeMoney(a.compare_price),
        };

        if (ap) {
          // Product-level price comparison (default prices tied to product, not variants)
          const appProductPrice = pickAppPriceForCurrency(ap.prices, currency);

          if (strapiBase.selling != null) {
            if (!appProductPrice) {
              issues.push({
                code: "MISSING_APP_PRICE",
                severity: "medium",
                message:
                  "Strapi has a base selling_price but appDb has no matching product Price (currency/minQty=1).",
                details: { currency: currency || null },
              });
            } else if (!nearlyEqualMoney(appProductPrice.amount, strapiBase.selling)) {
              issues.push({
                code: "PRICE_MISMATCH_PRODUCT",
                severity: "medium",
                message:
                  "Base selling price differs between Strapi product and appDb product Price (currency/minQty=1).",
                details: {
                  currency: currency || null,
                  strapiSellingPrice: strapiBase.selling,
                  appSellingPrice: appProductPrice.amount,
                  appPriceListId: appProductPrice.priceListId,
                },
              });
            }
          }

          // Variant-level checks: only enforce where Strapi explicitly uses override,
          // otherwise appDb variant prices may legitimately differ via price lists/promos.
          const appVariants = Array.isArray(ap.variants) ? ap.variants : [];
          const bySizeId = new Map();
          for (const v of appVariants) {
            const key = str(v?.strapiSizeId);
            if (key) bySizeId.set(key, v);
          }

          const variantMismatches = [];
          for (const sid of sizeStockIds) {
            const sInfo = sizeStockPricing.get(sid);
            if (!sInfo) continue;

            const v = bySizeId.get(sid);
            if (!v) continue; // mapping issue already reported separately

            const appVariantPrice = pickAppPriceForCurrency(v.prices, currency);

            const wantsOverride = sInfo.priceOverride === true && sInfo.price != null;
            if (wantsOverride) {
              if (!appVariantPrice) {
                variantMismatches.push({
                  strapiSizeId: sid,
                  type: "MISSING_APP_VARIANT_PRICE",
                  strapiPrice: sInfo.price,
                });
              } else if (!nearlyEqualMoney(appVariantPrice.amount, sInfo.price)) {
                variantMismatches.push({
                  strapiSizeId: sid,
                  type: "MISMATCH",
                  strapiPrice: sInfo.price,
                  appPrice: appVariantPrice.amount,
                  appPriceListId: appVariantPrice.priceListId,
                });
              }
            } else {
              // If no override in Strapi, only flag if app has a default variant priceListId=null
              // that diverges strongly from Strapi base (prevents noisy false positives).
              if (appVariantPrice && appVariantPrice.priceListId == null && strapiBase.selling != null) {
                if (!nearlyEqualMoney(appVariantPrice.amount, strapiBase.selling)) {
                  variantMismatches.push({
                    strapiSizeId: sid,
                    type: "APP_VARIANT_PRICE_DIFFERS_FROM_STRAPI_BASE",
                    strapiBasePrice: strapiBase.selling,
                    appPrice: appVariantPrice.amount,
                  });
                }
              }
            }
          }

          if (variantMismatches.length) {
            issues.push({
              code: "PRICE_MISMATCH_VARIANT",
              severity: "medium",
              message:
                "One or more variant prices differ between Strapi size stock pricing and appDb variant Price.",
              details: {
                currency: currency || null,
                mismatchCount: variantMismatches.length,
                examples: variantMismatches.slice(0, 25),
              },
            });
          }
        } else {
          // If product bridge is missing, we cannot compare appDb prices.
          if (strapiBase.selling != null) {
            issues.push({
              code: "PRICE_CHECK_SKIPPED_NO_APP_BRIDGE",
              severity: "info",
              message:
                "Price mismatch check against appDb skipped because appDb Product bridge is missing.",
            });
          }
        }
      }

      const actions = buildActions(issues);

      const item = {
        product: {
          strapiId: sp.id,
          title: sp.title,
          slug: sp.slug,
          status: sp.status,
          currency: sp.currency ?? null,
          selling_price: normalizeMoney(sp.selling_price),
          compare_price: normalizeMoney(sp.compare_price),
          thumbnail: doMedia ? pickAnyThumbnail(a) : null,
        },
        app: ap
          ? {
              productId: ap.id,
              archivedAt: ap.archivedAt ? new Date(ap.archivedAt).toISOString() : null,
              variantsCount: Array.isArray(ap.variants) ? ap.variants.length : 0,
            }
          : {
              productId: null,
              archivedAt: null,
              variantsCount: 0,
            },
        issues,
        actions,
      };

      const hasProblems = issues.some((i) => i?.severity === "high" || i?.severity === "medium");
      if ((onlyProblems && hasProblems) || (includeOk && !onlyProblems)) {
        diagnostics.push(item);
      } else if (onlyProblems && hasProblems) {
        diagnostics.push(item);
      }
    }

    // If onlyProblems=true, we may end with fewer than pageSize; we do not fabricate totals.
    // We return Strapi pagination totals (source-of-truth list size), plus resultCount for diagnostics output.
    return json({
      ok: true,
      items: diagnostics,
      pagination: {
        page,
        pageSize,
        total, // total products in Strapi matching the list query
        totalPages: int(metaPag?.pageCount, 0),
      },
      meta: {
        applied: {
          q: q || null,
          status: status || null,
          sort: sortRaw,
          onlyProblems,
          scope: scope || "all",
        },
        resultCount: diagnostics.length,
      },
    });
  } catch (err) {
    const status = Number(err?.status || 500);
    if (status === 401) return json({ ok: false, error: "Unauthorized" }, 401);
    if (status === 403) return json({ ok: false, error: "Forbidden" }, 403);

    console.error("[catalog/diagnostics][GET]", err);
    return json(
      {
        ok: false,
        error: "SERVER_ERROR",
        detail: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err),
      },
      500
    );
  }
}
