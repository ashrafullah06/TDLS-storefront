// FILE: app/api/admin/catalog/launch-drafts/[id]/validate/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { strapiWriteRequest } from "@/lib/strapi/strapi-write";
import {
  getFirstGalleryImage,
  getStrapiMediaUrl,
  getMediaArray,
} from "@/lib/strapimedia";

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

function str(v) {
  return String(v ?? "").trim();
}

function int(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function isEmptyRel(rel) {
  const d = rel?.data;
  if (Array.isArray(d)) return d.length === 0;
  return !d;
}

function countRel(rel) {
  const d = rel?.data;
  if (Array.isArray(d)) return d.length;
  return d ? 1 : 0;
}

function boolOrNull(v) {
  if (typeof v === "boolean") return v;
  return null;
}

function buildStrapiQS() {
  const p = new URLSearchParams();
  p.set("publicationState", "preview");

  p.set("populate[images]", "true");
  p.set("populate[gallery]", "true");

  p.set("populate[categories]", "true");
  p.set("populate[sub_categories]", "true");
  p.set("populate[super_categories]", "true");
  p.set("populate[audience_categories]", "true");
  p.set("populate[brand_tiers]", "true");
  p.set("populate[tags]", "true");
  p.set("populate[collections]", "true");

  p.set("populate[product_variants]", "true");
  return p.toString();
}

function pickTitle(attrs) {
  return (
    str(attrs?.name) ||
    str(attrs?.title) ||
    str(attrs?.product_name) ||
    str(attrs?.label) ||
    ""
  );
}

function normalizeSizeLabel(s) {
  return (
    str(s?.size_name) ||
    str(s?.sizeName) ||
    str(s?.primary_value) ||
    str(s?.secondary_value) ||
    str(s?.name) ||
    ""
  );
}

function normalizeColorLabel(v) {
  return (
    str(v?.color) ||
    str(v?.color_name) ||
    str(v?.colour) ||
    str(v?.colour_name) ||
    str(v?.name) ||
    ""
  );
}

function collectStrapiSizeIds(productAttrs) {
  const ids = [];
  const variants = Array.isArray(productAttrs?.product_variants)
    ? productAttrs.product_variants
    : [];
  for (const v of variants) {
    const stocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of stocks) {
      const sid = int(s?.id, 0);
      if (sid) ids.push(sid);
    }
  }
  return Array.from(new Set(ids));
}

function sumStrapiStock(productAttrs) {
  // Prefer explicit field if present; else sum size stock quantities if present.
  // We do NOT invent a quantity key. We only sum known keys if present.
  if (typeof productAttrs?.stock_total === "number") return productAttrs.stock_total;

  let sum = 0;
  const variants = Array.isArray(productAttrs?.product_variants)
    ? productAttrs.product_variants
    : [];
  for (const v of variants) {
    const stocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];
    for (const s of stocks) {
      // Common keys in your system can be stock/qty; we only add if numeric and key exists.
      const candidates = [
        s?.stock,
        s?.qty,
        s?.quantity,
        s?.stock_total,
        s?.available,
      ];
      const n = candidates.find((x) => typeof x === "number" && Number.isFinite(x));
      if (typeof n === "number") sum += n;
    }
  }
  return sum;
}

function severityRank(sev) {
  const s = str(sev).toLowerCase();
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 0;
}

function addIssue(issues, { code, severity, title, message, meta }) {
  issues.push({
    code: str(code) || "ISSUE",
    severity: str(severity) || "low",
    title: str(title) || str(code) || "Issue",
    message: str(message),
    meta: meta ?? null,
  });
}

function addAction(actions, { id, title, description, ctaLabel, request }) {
  actions.push({
    id: str(id) || str(title) || "action",
    title: str(title) || "Action",
    description: str(description),
    ctaLabel: str(ctaLabel) || null,
    request: request ?? null, // UI can render as a button (method/url/body)
  });
}

/* ───────────────── handler ───────────────── */

export async function GET(req, ctx) {
  try {
    await requireAdmin(req, {
      permissions: [Permissions.MANAGE_CATALOG, Permissions.VIEW_ANALYTICS],
    });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const qs = buildStrapiQS();
    const res = await strapiWriteRequest(`/products/${id}?${qs}`, { method: "GET" });

    const node = res?.data || null;
    if (!node?.id) return json({ ok: false, error: "Draft not found" }, 404);

    const a = node?.attributes || {};
    const issues = [];
    const actions = [];

    // Media
    const gallery = getMediaArray(a?.gallery);
    const images = getMediaArray(a?.images);
    const thumb =
      getFirstGalleryImage(a) ||
      (images.length ? images[0] : null) ||
      null;

    const thumbnailUrl = thumb ? getStrapiMediaUrl(thumb) : null;

    if (!thumbnailUrl) {
      addIssue(issues, {
        code: "MEDIA_THUMBNAIL_MISSING",
        severity: "medium",
        title: "Thumbnail missing",
        message:
          "No thumbnail could be derived from gallery/images. Add at least one gallery image (recommended).",
      });
      addAction(actions, {
        id: "add-media",
        title: "Add media to draft",
        description:
          "Upload at least one image and attach it to gallery/images in Strapi, then re-run validation.",
        ctaLabel: "Open Media step",
        request: null,
      });
    }

    // Core fields
    const title = pickTitle(a);
    const slug = str(a?.slug);

    if (!title) {
      addIssue(issues, {
        code: "TITLE_MISSING",
        severity: "high",
        title: "Title/name missing",
        message:
          "The product has no name/title field populated (name/title/product_name/label). Populate a human-readable title.",
      });
    }
    if (!slug) {
      addIssue(issues, {
        code: "SLUG_MISSING",
        severity: "high",
        title: "Slug missing",
        message:
          "The product has no slug. Ensure slug is generated/assigned and persisted on the draft.",
      });
    }

    // Taxonomy presence (warn only)
    if (a?.categories && isEmptyRel(a.categories)) {
      addIssue(issues, {
        code: "CATEGORIES_EMPTY",
        severity: "low",
        title: "No categories",
        message:
          "No categories are assigned. Assign at least one category for storefront navigation and filtering.",
        meta: { count: 0 },
      });
    }

    // Pricing sanity (only validate if fields exist)
    const hasSellingPrice = a?.selling_price !== undefined;
    const hasCurrency = a?.currency !== undefined;
    if (hasSellingPrice) {
      const sp = Number(a?.selling_price);
      if (!Number.isFinite(sp) || sp <= 0) {
        addIssue(issues, {
          code: "SELLING_PRICE_INVALID",
          severity: "high",
          title: "Selling price invalid",
          message:
            "selling_price is present but not a positive number. Set a valid selling_price before publish.",
          meta: { selling_price: a?.selling_price ?? null },
        });
      }
    } else {
      addIssue(issues, {
        code: "SELLING_PRICE_MISSING",
        severity: "medium",
        title: "Selling price missing",
        message:
          "selling_price is not present. If this product is intended for sale, set selling_price.",
      });
    }

    if (hasCurrency) {
      if (!str(a?.currency)) {
        addIssue(issues, {
          code: "CURRENCY_MISSING",
          severity: "medium",
          title: "Currency missing",
          message:
            "currency is present but empty. Set a currency (e.g., BDT) before publish.",
        });
      }
    } else {
      addIssue(issues, {
        code: "CURRENCY_MISSING",
        severity: "medium",
        title: "Currency missing",
        message:
          "currency is not present. If this product is intended for sale, set currency.",
      });
    }

    // Codes (only validate if field exists or expected in your schema)
    const productCode = str(a?.product_code);
    if (a?.product_code !== undefined && !productCode) {
      addIssue(issues, {
        code: "PRODUCT_CODE_MISSING",
        severity: "medium",
        title: "Product code missing",
        message:
          "product_code is empty. If your downstream systems rely on product_code, generate/assign it.",
      });
    }

    const baseSku = str(a?.base_sku);
    if (a?.base_sku !== undefined && !baseSku) {
      addIssue(issues, {
        code: "BASE_SKU_MISSING",
        severity: "medium",
        title: "Base SKU missing",
        message:
          "base_sku is empty. If you rely on base_sku for SKU generation, set it before launch.",
      });
    }

    // Variants sanity (validate only if product_variants present)
    const productVariants = Array.isArray(a?.product_variants) ? a.product_variants : null;
    if (productVariants) {
      if (productVariants.length === 0) {
        addIssue(issues, {
          code: "VARIANTS_EMPTY",
          severity: "medium",
          title: "No variants",
          message:
            "product_variants is present but empty. If this product uses a color/size matrix, add variants and size_stocks.",
        });
      } else {
        // Validate each variant for size_stocks
        for (const v of productVariants) {
          const colorLabel = normalizeColorLabel(v) || "(unnamed color)";
          const sizeStocks = Array.isArray(v?.size_stocks) ? v.size_stocks : [];

          if (sizeStocks.length === 0) {
            addIssue(issues, {
              code: "SIZE_STOCKS_EMPTY",
              severity: "medium",
              title: "Variant has no size stocks",
              message: `Variant "${colorLabel}" has no size_stocks entries.`,
              meta: { variantId: v?.id ?? null, color: colorLabel },
            });
          } else {
            for (const s of sizeStocks) {
              const sizeLabel = normalizeSizeLabel(s) || "(unnamed size)";
              const active = boolOrNull(s?.is_active);

              if (active === false) {
                addIssue(issues, {
                  code: "SIZE_STOCK_INACTIVE",
                  severity: "low",
                  title: "Inactive size stock",
                  message: `Variant "${colorLabel}" size "${sizeLabel}" is marked inactive.`,
                  meta: { variantId: v?.id ?? null, sizeStockId: s?.id ?? null },
                });
              }

              // If generated_sku exists in schema, validate presence.
              if (s?.generated_sku !== undefined && !str(s?.generated_sku)) {
                addIssue(issues, {
                  code: "SIZE_SKU_MISSING",
                  severity: "medium",
                  title: "Size SKU missing",
                  message: `Variant "${colorLabel}" size "${sizeLabel}" has no generated_sku.`,
                  meta: { sizeStockId: s?.id ?? null },
                });
              }
            }
          }
        }
      }
    }

    // App DB bridge checks
    const appProduct = await prisma.product.findUnique({
      where: { strapiId: Number(id) },
      select: {
        id: true,
        strapiId: true,
        slug: true,
        status: true,
        priceCurrency: true,
        priceSale: true,
        priceMrp: true,
      },
    });

    if (!appProduct) {
      addIssue(issues, {
        code: "APP_BRIDGE_MISSING",
        severity: "high",
        title: "App DB bridge missing",
        message:
          "This Strapi draft has no corresponding appDb product (Product.strapiId). Create/refresh the bridge before launch.",
        meta: { strapiId: id },
      });
      addAction(actions, {
        id: "bridge-create",
        title: "Create/refresh appDb bridge",
        description:
          "Use the launch-drafts endpoints to create/refresh the appDb product record for this draft.",
        ctaLabel: "Refresh bridge",
        request: {
          method: "PATCH",
          url: `/api/admin/catalog/launch-drafts/${id}`,
          body: { data: {} },
        },
      });
    } else {
      // Slug mismatch
      if (slug && appProduct.slug && slug !== appProduct.slug) {
        addIssue(issues, {
          code: "SLUG_MISMATCH",
          severity: "high",
          title: "Slug mismatch (Strapi vs appDb)",
          message:
            "The Strapi slug differs from appDb Product.slug. Refresh bridge to keep storefront routing consistent.",
          meta: { strapiSlug: slug, appSlug: appProduct.slug },
        });
        addAction(actions, {
          id: "bridge-refresh-slug",
          title: "Refresh bridge from Strapi",
          description:
            "Re-sync appDb Product fields from Strapi to align slug/title/pricing.",
          ctaLabel: "Sync from Strapi",
          request: {
            method: "PATCH",
            url: `/api/admin/catalog/launch-drafts/${id}`,
            body: { data: {} },
          },
        });
      }

      // Pricing mismatch (only compare when both sides are numeric)
      const sPrice = a?.selling_price;
      const sMrp = a?.compare_price;
      const sCur = str(a?.currency);

      const aSale = appProduct.priceSale;
      const aMrp = appProduct.priceMrp;
      const aCur = str(appProduct.priceCurrency);

      const sPriceN = typeof sPrice === "number" && Number.isFinite(sPrice) ? sPrice : null;
      const sMrpN = typeof sMrp === "number" && Number.isFinite(sMrp) ? sMrp : null;
      const aSaleN = typeof aSale === "number" && Number.isFinite(aSale) ? aSale : null;
      const aMrpN = typeof aMrp === "number" && Number.isFinite(aMrp) ? aMrp : null;

      const priceMismatch =
        (sPriceN != null && aSaleN != null && sPriceN !== aSaleN) ||
        (sMrpN != null && aMrpN != null && sMrpN !== aMrpN) ||
        (sCur && aCur && sCur !== aCur);

      if (priceMismatch) {
        addIssue(issues, {
          code: "PRICE_MISMATCH",
          severity: "medium",
          title: "Price mismatch (Strapi vs appDb)",
          message:
            "Strapi pricing differs from appDb pricing. Refresh bridge to align storefront checkout values.",
          meta: {
            strapi: { currency: sCur || null, selling_price: sPriceN, compare_price: sMrpN },
            appDb: { currency: aCur || null, priceSale: aSaleN, priceMrp: aMrpN },
          },
        });
        addAction(actions, {
          id: "bridge-refresh-price",
          title: "Sync pricing from Strapi",
          description:
            "Re-sync the appDb product pricing fields from this Strapi draft.",
          ctaLabel: "Sync pricing",
          request: {
            method: "PATCH",
            url: `/api/admin/catalog/launch-drafts/${id}`,
            body: { data: {} },
          },
        });
      }
    }

    // Variant mapping checks (only when size ids exist)
    const strapiSizeIds = collectStrapiSizeIds(a);

    if (strapiSizeIds.length) {
      const mapped = await prisma.productVariant.findMany({
        where: { strapiSizeId: { in: strapiSizeIds } },
        select: { id: true, strapiSizeId: true, productId: true, sku: true, barcode: true, stockAvailable: true },
      });

      const mappedSet = new Set(mapped.map((m) => Number(m.strapiSizeId)).filter(Number.isFinite));
      const missing = strapiSizeIds.filter((sid) => !mappedSet.has(sid));

      if (missing.length) {
        addIssue(issues, {
          code: "VARIANT_MAPPING_MISSING",
          severity: "high",
          title: "Missing variant mappings",
          message:
            "Some Strapi size_stocks are not mapped to appDb ProductVariant (by strapiSizeId). These will show as unavailable in admin availability joins.",
          meta: { missingStrapiSizeIds: missing, total: strapiSizeIds.length, mapped: mappedSet.size },
        });

        addAction(actions, {
          id: "run-diagnostics",
          title: "Run diagnostics for mappings",
          description:
            "Use diagnostics to identify missing bridges and take corrective actions (mapping, media, price sync).",
          ctaLabel: "Open diagnostics",
          request: {
            method: "GET",
            url: `/api/admin/catalog/diagnostics?scope=product&strapiId=${encodeURIComponent(String(id))}`,
          },
        });
      }
    }

    // Stock mismatch check (if we can compute Strapi and app totals)
    const strapiStock = sumStrapiStock(a);
    let appStock = null;

    if (appProduct?.id) {
      const g = await prisma.productVariant.groupBy({
        by: ["productId"],
        where: { productId: appProduct.id },
        _sum: { stockAvailable: true },
      });
      const row = Array.isArray(g) ? g[0] : null;
      appStock = row?._sum?.stockAvailable ?? 0;

      if (typeof strapiStock === "number" && Number.isFinite(strapiStock)) {
        if (Number(appStock) !== Number(strapiStock)) {
          addIssue(issues, {
            code: "STOCK_TOTAL_MISMATCH",
            severity: "low",
            title: "Stock total mismatch",
            message:
              "The computed/declared Strapi stock total differs from appDb summed stockAvailable. Verify your sync rules and choose the authoritative stock source for launch.",
            meta: { strapiStock, appStock },
          });
        }
      }
    }

    // Publishing safety: prevent publish if high severity issues exist
    const maxSev = issues.reduce((mx, it) => Math.max(mx, severityRank(it?.severity)), 0);
    const canPublish = maxSev < 3; // no "high"

    // Provide explicit publish action suggestion (UI can render)
    if (!canPublish) {
      addAction(actions, {
        id: "block-publish",
        title: "Publish is blocked",
        description:
          "Resolve all HIGH severity issues, then re-run validation. Publishing before that will cause operational inconsistencies.",
        ctaLabel: null,
        request: null,
      });
    } else if (!a?.publishedAt) {
      addAction(actions, {
        id: "publish",
        title: "Publish draft",
        description:
          "If you are satisfied with validation and diagnostics, you can publish this product from the admin launch system.",
        ctaLabel: "Publish",
        request: {
          method: "POST",
          url: `/api/admin/catalog/launch-drafts/${id}?action=publish`,
        },
      });
    }

    return json(
      {
        ok: true,
        strapiId: id,
        isDraft: !a?.publishedAt,
        publishedAt: a?.publishedAt || null,
        updatedAt: a?.updatedAt || null,
        summary: {
          title: pickTitle(a) || null,
          slug: slug || null,
          categoriesCount: a?.categories ? countRel(a.categories) : null,
          hasThumbnail: Boolean(thumbnailUrl),
          productVariantsCount: Array.isArray(a?.product_variants) ? a.product_variants.length : null,
        },
        canPublish,
        issues,
        actions,
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json(
      { ok: false, error: str(e?.message || e), code: e?.code || null },
      status
    );
  }
}
