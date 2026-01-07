// FILE: app/api/admin/catalog/launch-drafts/[id]/publish/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";
import { strapiWriteRequest } from "@/lib/strapi/strapi-write";

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
function bool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "y") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n") return false;
  return null;
}

/**
 * publish endpoint:
 * - Optionally runs quick safety checks (no guessing)
 * - Publishes Strapi entry (sets publishedAt)
 * - Ensures appDb Product status reflects publish
 * - Optional: push variants + bridge refresh via query flags
 *
 * Query flags:
 *   ?validate=1   => minimal checks; blocks publish if invalid
 *   ?push=1       => push/bridge into appDb before publishing
 *   ?dryRun=1     => no write, returns plan
 */
function minimalValidate(strapiNode, { requireSlug = true } = {}) {
  const a = strapiNode?.attributes || {};
  const issues = [];

  const slug = str(a?.slug);
  if (requireSlug && !slug) {
    issues.push({
      code: "SLUG_MISSING",
      severity: "high",
      message: "Slug is missing; cannot publish reliably.",
    });
  }

  // If selling_price exists, ensure positive numeric
  if (a?.selling_price !== undefined) {
    const sp = Number(a?.selling_price);
    if (!Number.isFinite(sp) || sp <= 0) {
      issues.push({
        code: "SELLING_PRICE_INVALID",
        severity: "high",
        message: "selling_price is present but not a positive number.",
        meta: { selling_price: a?.selling_price ?? null },
      });
    }
  }

  // If currency exists, ensure non-empty
  if (a?.currency !== undefined) {
    const cur = str(a?.currency);
    if (!cur) {
      issues.push({
        code: "CURRENCY_MISSING",
        severity: "high",
        message: "currency is present but empty.",
      });
    }
  }

  // If product has gallery/images populated, ensure at least one image
  // (only warn by default)
  const hasGallery = Boolean(a?.gallery);
  const hasImages = Boolean(a?.images);
  if ((hasGallery || hasImages) && !a?.gallery?.data && !a?.images?.data) {
    issues.push({
      code: "MEDIA_EMPTY",
      severity: "medium",
      message: "Media fields exist but contain no attached assets.",
    });
  }

  const maxSev = issues.reduce((mx, it) => (it.severity === "high" ? 3 : it.severity === "medium" ? 2 : 1), 0);
  return { ok: maxSev < 3, issues, slug };
}

async function pushBridgeToAppDb({ prisma, strapiId, strapiNode }) {
  // Push/bridge: same rules as /push route — no guessing.
  const a = strapiNode?.attributes || {};
  const slug = str(a?.slug);
  if (!slug) throw new Error("Cannot push to appDb: Strapi slug missing.");

  const title =
    str(a?.name) ||
    str(a?.title) ||
    str(a?.product_name) ||
    str(a?.label) ||
    slug;

  const publishedAt = a?.publishedAt || null;

  const priceCurrency = str(a?.currency) || null;
  const priceMrp = a?.compare_price ?? null;
  const priceSale = a?.selling_price ?? null;

  const strapiUpdatedAt = a?.updatedAt ? new Date(a.updatedAt) : null;

  const appProduct = await prisma.product.upsert({
    where: { strapiId: Number(strapiId) },
    create: {
      title,
      subtitle: a?.short_description ?? null,
      slug,
      description: a?.description ?? null,
      status: publishedAt ? "active" : "draft",
      brand: str(a?.brand) || null,

      fit: str(a?.fit) || null,
      sizeSystem: str(a?.size_system) || null,

      priceCurrency,
      priceMrp,
      priceSale,

      productUuid: str(a?.uuid) || null,
      productCode: str(a?.product_code) || null,
      baseSku: str(a?.base_sku) || null,
      productBarcode: str(a?.barcode) || null,
      hsCode: str(a?.hs_code) || null,

      seoJson: a?.seo ?? null,
      altNamesJson: a?.alt_names_entries ?? null,
      translationsJson: a?.translations ?? null,

      metaTitle: str(a?.meta_title) || null,
      metaDescription: str(a?.meta_description) || null,

      strapiId: Number(strapiId),
      strapiUpdatedAt,
      strapiSlug: slug,
    },
    update: {
      title,
      subtitle: a?.short_description ?? null,
      slug,
      description: a?.description ?? null,
      status: publishedAt ? "active" : "draft",
      brand: str(a?.brand) || null,

      fit: str(a?.fit) || null,
      sizeSystem: str(a?.size_system) || null,

      priceCurrency,
      priceMrp,
      priceSale,

      productUuid: str(a?.uuid) || null,
      productCode: str(a?.product_code) || null,
      baseSku: str(a?.base_sku) || null,
      productBarcode: str(a?.barcode) || null,
      hsCode: str(a?.hs_code) || null,

      seoJson: a?.seo ?? null,
      altNamesJson: a?.alt_names_entries ?? null,
      translationsJson: a?.translations ?? null,

      metaTitle: str(a?.meta_title) || null,
      metaDescription: str(a?.meta_description) || null,

      strapiUpdatedAt,
      strapiSlug: slug,
    },
    select: { id: true, title: true, slug: true, status: true, strapiId: true, updatedAt: true },
  });

  return appProduct;
}

/* ───────────────── handler ───────────────── */

export async function POST(req, ctx) {
  try {
    await requireAdmin(req, { permission: Permissions.MANAGE_CATALOG });

    const params = await ctx?.params;
    const id = int(params?.id, 0);
    if (!id) return json({ ok: false, error: "Draft id required" }, 400);

    const u = new URL(req.url);
    const validate = bool(u.searchParams.get("validate")) === true;
    const push = bool(u.searchParams.get("push")) === true;
    const dryRun = bool(u.searchParams.get("dryRun")) === true;

    // Fetch draft (preview)
    const qs = new URLSearchParams();
    qs.set("publicationState", "preview");
    const res = await strapiWriteRequest(`/products/${id}?${qs.toString()}`, { method: "GET" });

    const node = res?.data || null;
    if (!node?.id) return json({ ok: false, error: "Draft not found" }, 404);

    const a = node?.attributes || {};

    // If already published, be idempotent
    const alreadyPublished = Boolean(a?.publishedAt);

    // Optional minimal validation
    const v = validate ? minimalValidate(node) : { ok: true, issues: [], slug: str(a?.slug) };
    if (validate && !v.ok) {
      return json(
        {
          ok: false,
          error: "VALIDATION_FAILED",
          strapiId: id,
          issues: v.issues,
        },
        400
      );
    }

    const plan = {
      strapi: {
        id,
        alreadyPublished,
        willSetPublishedAt: alreadyPublished ? false : true,
      },
      appDb: {
        willPushBridge: push,
        willSetStatusActive: true,
      },
    };

    if (dryRun) {
      return json(
        {
          ok: true,
          dryRun: true,
          strapiId: id,
          plan,
          validation: validate ? { ok: v.ok, issues: v.issues } : null,
        },
        200
      );
    }

    // Optional bridge push before publish (so appDb is ready immediately after publishing)
    let appProduct = null;
    if (push) {
      appProduct = await pushBridgeToAppDb({ prisma, strapiId: id, strapiNode: node });
    }

    // Publish in Strapi if not already published
    let publishedNode = node;
    if (!alreadyPublished) {
      const publishedAt = new Date().toISOString();
      const updated = await strapiWriteRequest(`/products/${id}`, {
        method: "PUT",
        body: { data: { publishedAt } },
        json: true,
      });
      publishedNode = updated?.data || null;
    }

    const publishedAtFinal = publishedNode?.attributes?.publishedAt || a?.publishedAt || null;
    const slugFinal = str(publishedNode?.attributes?.slug || a?.slug);

    // Update appDb status => active (if bridged)
    // If appProduct already created by push, update it; else try update by strapiId (best-effort)
    let appUpdated = null;

    if (appProduct?.id) {
      appUpdated = await prisma.product.update({
        where: { id: appProduct.id },
        data: {
          status: "active",
          strapiUpdatedAt: publishedNode?.attributes?.updatedAt
            ? new Date(publishedNode.attributes.updatedAt)
            : null,
          strapiSlug: slugFinal || null,
        },
        select: { id: true, title: true, slug: true, status: true, strapiId: true, updatedAt: true },
      });
    } else {
      // Only if a bridge exists. Do not create here (no guessing).
      appUpdated = await prisma.product
        .update({
          where: { strapiId: Number(id) },
          data: {
            status: "active",
            strapiUpdatedAt: publishedNode?.attributes?.updatedAt
              ? new Date(publishedNode.attributes.updatedAt)
              : null,
            strapiSlug: slugFinal || null,
          },
          select: { id: true, title: true, slug: true, status: true, strapiId: true, updatedAt: true },
        })
        .catch(() => null);
    }

    return json(
      {
        ok: true,
        strapiId: id,
        publishedAt: publishedAtFinal,
        strapi: publishedNode,
        app: appUpdated,
        validation: validate ? { ok: v.ok, issues: v.issues } : null,
        notes: [
          alreadyPublished ? "Product was already published in Strapi." : "Product published in Strapi.",
          appUpdated ? "App DB product status set to active." : "No appDb bridge found to update (status not changed).",
        ],
      },
      200
    );
  } catch (e) {
    const status = e?.status || 500;
    return json({ ok: false, error: str(e?.message || e), code: e?.code || null }, status);
  }
}
