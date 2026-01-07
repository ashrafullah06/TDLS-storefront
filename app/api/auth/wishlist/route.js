// FILE: app/api/auth/wishlist/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * CUSTOMER WISHLIST (CANONICAL) — /api/auth/wishlist
 *
 * Why this is canonical:
 * - Many setups scope customer auth cookies to Path=/api/auth
 * - That means /api/wishlist/* may not receive cookies => false 401
 * - So we keep the canonical handler under /api/auth/*
 *
 * /api/wishlist is now a 307 redirect alias to this canonical route.
 */

function jsonNoStore(body, status = 200, extraHeaders = {}) {
  const authenticated = body?.authenticated === true ? "1" : "0";
  const allowed = body?.allowed === true ? "1" : "0";

  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      Vary: "Cookie, Authorization",
      "x-tdlc-scope": "customer",
      "x-tdlc-authenticated": authenticated,
      "x-tdlc-allowed": allowed,
      "x-tdlc-canonical": "/api/auth/wishlist",
      ...extraHeaders,
    },
  });
}

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s || "";
}

function safeInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function isAdminContext(req) {
  const plane = (req.headers.get("x-tdlc-plane") || "").toLowerCase();
  if (plane === "admin") return true;

  const ref = req.headers.get("referer") || "";
  if (!ref) return false;

  try {
    const u = new URL(ref);
    const p = String(u.pathname || "");
    return p === "/admin" || p.startsWith("/admin/");
  } catch {
    return false;
  }
}

function denyAdminPlane() {
  return jsonNoStore(
    { ok: false, error: "admin_plane_not_supported", reason: "customer_wishlist_is_customer_only" },
    404
  );
}

/* ────────────────────────────────────────────────────────────────
   Session resolution (centralized)
   ──────────────────────────────────────────────────────────────── */

async function getCustomerSession(req) {
  try {
    // IMPORTANT: Bind auth to the request in Route Handlers.
    let session = await auth(req).catch(() => null);
    if (!session) session = await auth().catch(() => null);
    if (!session) return null;

    const directId = session?.user?.id ? String(session.user.id) : "";
    if (directId) {
      return {
        id: directId,
        email: session?.user?.email ?? null,
        name: session?.user?.name ?? null,
      };
    }

    const candidate =
      session?.user?.sub ||
      session?.user?.userId ||
      session?.userId ||
      session?.uid ||
      null;

    if (candidate && prisma?.user && typeof prisma.user.findUnique === "function") {
      try {
        const row = await prisma.user.findUnique({
          where: { id: String(candidate) },
          select: { id: true, email: true, name: true },
        });
        if (row?.id) {
          return {
            id: String(row.id),
            email: row.email ?? (session?.user?.email ?? null),
            name: row.name ?? (session?.user?.name ?? null),
          };
        }
      } catch {}
    }

    const emailRaw = safeStr(session?.user?.email);
    const phoneRaw = safeStr(session?.user?.phone);

    if ((emailRaw || phoneRaw) && prisma?.user && typeof prisma.user.findFirst === "function") {
      const OR = [];

      if (emailRaw) {
        OR.push({ email: { equals: emailRaw, mode: "insensitive" } });
        OR.push({ email: emailRaw.toLowerCase() });
      }

      if (phoneRaw) {
        OR.push({ phone: phoneRaw });
        const norm = phoneRaw.replace(/[^\d+]/g, "");
        if (norm && norm !== phoneRaw) OR.push({ phone: norm });
      }

      try {
        const row = await prisma.user.findFirst({
          where: { OR },
          select: { id: true, email: true, name: true },
        });

        if (row?.id) {
          return {
            id: String(row.id),
            email: row.email ?? (session?.user?.email ?? null),
            name: row.name ?? (session?.user?.name ?? null),
          };
        }
      } catch {
        try {
          const OR2 = [];
          if (emailRaw) {
            OR2.push({ email: emailRaw });
            OR2.push({ email: emailRaw.toLowerCase() });
          }
          if (phoneRaw) OR2.push({ phone: phoneRaw });

          const row2 = OR2.length
            ? await prisma.user.findFirst({
                where: { OR: OR2 },
                select: { id: true, email: true, name: true },
              })
            : null;

          if (row2?.id) {
            return {
              id: String(row2.id),
              email: row2.email ?? (session?.user?.email ?? null),
              name: row2.name ?? (session?.user?.name ?? null),
            };
          }
        } catch {}
      }
    }

    return null;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────
   Prisma model helpers
   ──────────────────────────────────────────────────────────────── */

function pickModelClient(tx, candidates) {
  for (const name of candidates) {
    const c = tx?.[name];
    if (c && (typeof c.findFirst === "function" || typeof c.findUnique === "function")) {
      return c;
    }
  }
  return null;
}

function prismaModelAvailable(client, name) {
  try {
    const m = client?.[name];
    return !!(m && typeof m.findFirst === "function");
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────────
   FK-safe Product resolution
   ──────────────────────────────────────────────────────────────── */

async function productExistsById(tx, id) {
  const product = pickModelClient(tx, ["product"]);
  if (!product || !id) return false;

  try {
    const row = product.findUnique
      ? await product.findUnique({ where: { id }, select: { id: true } })
      : await product.findFirst({ where: { id }, select: { id: true } });
    return !!row?.id;
  } catch {
    return false;
  }
}

async function tryFindProductId(tx, where) {
  const product = pickModelClient(tx, ["product"]);
  if (!product) return "";

  try {
    const row = await product.findFirst({ where, select: { id: true } });
    return row?.id ? String(row.id) : "";
  } catch {
    return "";
  }
}

async function tryResolveProductIdViaVariant(tx, variantId) {
  if (!variantId) return "";

  const variant = pickModelClient(tx, ["productVariant", "variant"]);
  if (!variant) return "";

  try {
    if (variant.findUnique) {
      const row = await variant.findUnique({
        where: { id: variantId },
        select: { productId: true },
      });
      return row?.productId ? String(row.productId) : "";
    }
  } catch {}

  try {
    const row = variant.findUnique
      ? await variant.findUnique({
          where: { id: variantId },
          select: { product: { select: { id: true } } },
        })
      : await variant.findFirst({
          where: { id: variantId },
          select: { product: { select: { id: true } } },
        });

    return row?.product?.id ? String(row.product.id) : "";
  } catch {
    return "";
  }
}

async function resolveInternalProductId(tx, incoming) {
  const rawProductId = safeStr(incoming?.productId);
  const slug = safeStr(incoming?.slug);
  const productCode = safeStr(incoming?.productCode || incoming?.code || incoming?.sku);
  const pidRaw = safeStr(incoming?.pid);
  const variantId = safeStr(incoming?.variantId);

  if (rawProductId && (await productExistsById(tx, rawProductId))) return rawProductId;

  if (slug) {
    const bySlug = await tryFindProductId(tx, { slug });
    if (bySlug) return bySlug;
  }

  if (productCode) {
    const byProductCode = await tryFindProductId(tx, { productCode });
    if (byProductCode) return byProductCode;

    const bySku = await tryFindProductId(tx, { sku: productCode });
    if (bySku) return bySku;

    const byCode = await tryFindProductId(tx, { code: productCode });
    if (byCode) return byCode;
  }

  if (pidRaw) {
    const pidNum = Number.isFinite(Number(pidRaw)) ? Math.trunc(Number(pidRaw)) : null;
    const fields = ["pid", "documentId", "strapiId", "externalId", "strapiProductId"];

    for (const f of fields) {
      if (pidNum != null) {
        const byNum = await tryFindProductId(tx, { [f]: pidNum });
        if (byNum) return byNum;
      }
      const byStr = await tryFindProductId(tx, { [f]: pidRaw });
      if (byStr) return byStr;
    }
  }

  if (variantId) {
    const viaVariant = await tryResolveProductIdViaVariant(tx, variantId);
    if (viaVariant && (await productExistsById(tx, viaVariant))) return viaVariant;
  }

  if (rawProductId) {
    const rawNum = Number.isFinite(Number(rawProductId)) ? Math.trunc(Number(rawProductId)) : null;
    const fields = ["pid", "documentId", "strapiId", "externalId", "strapiProductId"];

    for (const f of fields) {
      if (rawNum != null) {
        const byNum = await tryFindProductId(tx, { [f]: rawNum });
        if (byNum) return byNum;
      }
      const byStr = await tryFindProductId(tx, { [f]: rawProductId });
      if (byStr) return byStr;
    }
  }

  return "";
}

/* ────────────────────────────────────────────────────────────────
   FK-safe Variant resolution
   ──────────────────────────────────────────────────────────────── */

async function variantExistsById(tx, id) {
  const variant = pickModelClient(tx, ["productVariant", "variant"]);
  if (!variant || !id) return false;

  try {
    const row = variant.findUnique
      ? await variant.findUnique({ where: { id }, select: { id: true } })
      : await variant.findFirst({ where: { id }, select: { id: true } });
    return !!row?.id;
  } catch {
    return false;
  }
}

async function tryFindVariantId(tx, where) {
  const variant = pickModelClient(tx, ["productVariant", "variant"]);
  if (!variant) return "";

  try {
    const row = await variant.findFirst({ where, select: { id: true } });
    return row?.id ? String(row.id) : "";
  } catch {
    return "";
  }
}

async function resolveInternalVariantId(tx, incoming, internalProductId) {
  const rawVariantId = safeStr(incoming?.variantId);
  const variantPid = safeStr(incoming?.variantPid);

  if (rawVariantId && (await variantExistsById(tx, rawVariantId))) return rawVariantId;

  const candidates = [];
  if (variantPid) candidates.push(variantPid);
  if (rawVariantId) candidates.push(rawVariantId);

  for (const raw of candidates) {
    if (!raw) continue;

    const rawNum = Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : null;

    const fields = ["pid", "documentId", "strapiId", "externalId", "strapiVariantId"];
    for (const f of fields) {
      if (rawNum != null) {
        const byNum = await tryFindVariantId(
          tx,
          internalProductId ? { [f]: rawNum, productId: internalProductId } : { [f]: rawNum }
        );
        if (byNum) return byNum;
      }

      const byStr = await tryFindVariantId(
        tx,
        internalProductId ? { [f]: raw, productId: internalProductId } : { [f]: raw }
      );
      if (byStr) return byStr;
    }
  }

  return null; // optional FK must be NULL-safe
}

/* ────────────────────────────────────────────────────────────────
   Wishlist helpers
   ──────────────────────────────────────────────────────────────── */

async function findDefaultWishlist(tx, userId) {
  if (!prismaModelAvailable(tx, "wishlist")) return null;

  const attempts = [
    () => tx.wishlist.findFirst({ where: { userId, isDefault: true } }),
    () => tx.wishlist.findFirst({ where: { userId, name: "My Wishlist" } }),
    () => tx.wishlist.findFirst({ where: { userId } }),
  ];

  for (const attempt of attempts) {
    try {
      const wl = await attempt();
      if (wl) return wl;
    } catch {}
  }
  return null;
}

async function getOrCreateDefaultWishlist(tx, userId) {
  if (!prismaModelAvailable(tx, "wishlist")) return { wishlist: null, reason: "model_missing_wishlist" };

  const existing = await findDefaultWishlist(tx, userId);
  if (existing) return { wishlist: existing, reason: "found" };

  const createAttempts = [
    () => tx.wishlist.create({ data: { userId, name: "My Wishlist", isDefault: true } }),
    () => tx.wishlist.create({ data: { userId, isDefault: true } }),
    () => tx.wishlist.create({ data: { userId } }),
  ];

  for (const attempt of createAttempts) {
    try {
      const wl = await attempt();
      if (wl) return { wishlist: wl, reason: "created" };
    } catch {}
  }

  return { wishlist: null, reason: "create_failed" };
}

function normalizeItemKey({ productId, variantId, sizeStockId }) {
  return {
    productId: safeStr(productId),
    variantId: safeStr(variantId) || null,
    sizeStockId: safeStr(sizeStockId) || null,
  };
}

async function findWishlistItem(tx, wishlistId, key) {
  if (!prismaModelAvailable(tx, "wishlistItem")) return null;

  const { productId, variantId, sizeStockId } = normalizeItemKey(key);
  if (!productId) return null;

  try {
    return await tx.wishlistItem.findFirst({
      where: { wishlistId, productId, variantId, sizeStockId },
      select: { id: true },
    });
  } catch {
    return null;
  }
}

async function createWishlistItem(tx, wishlistId, userId, payload) {
  if (!prismaModelAvailable(tx, "wishlistItem")) return { ok: false, error: "model_missing_wishlistItem" };

  const { productId, variantId, sizeStockId } = normalizeItemKey(payload);

  if (!productId) return { ok: false, error: "missing_productId" };
  if (!userId) return { ok: false, error: "missing_userId" };

  const qty = clamp(safeInt(payload?.qty, 1), 1, 999);
  const note = safeStr(payload?.note) || null;
  const addedFrom = safeStr(payload?.addedFrom) || null;

  try {
    const row = await tx.wishlistItem.create({
      data: {
        wishlistId,
        userId,
        productId,
        variantId,
        sizeStockId,
        qty,
        note,
        addedFrom,
      },
      select: { id: true },
    });

    return { ok: true, id: row?.id ?? null };
  } catch (e) {
    return { ok: false, error: e?.message || "create_failed" };
  }
}

async function deleteWishlistItemByIdScoped(tx, wishlistId, itemId) {
  if (!prismaModelAvailable(tx, "wishlistItem")) return { ok: false, error: "model_missing_wishlistItem" };

  try {
    const row = await tx.wishlistItem.findFirst({
      where: { id: itemId, wishlistId },
      select: { id: true },
    });
    if (!row?.id) return { ok: true, notFound: true };

    await tx.wishlistItem.delete({ where: { id: row.id } });
    return { ok: true, notFound: false };
  } catch (e) {
    return { ok: false, error: e?.message || "delete_failed" };
  }
}

function normalizeAction(rawAction) {
  const a = safeStr(rawAction).toLowerCase();
  if (!a) return "add";
  if (a === "toggle") return "add";
  if (a === "add" || a === "create" || a === "upsert") return "add";
  if (a === "remove" || a === "delete") return "remove";
  return "add";
}

function guestStatus() {
  return { ok: true, authenticated: false, allowed: false, reason: "login_required", inWishlist: false, wishlistId: null, itemId: null };
}

function guestList(page = 1, pageSize = 24) {
  return { ok: true, authenticated: false, allowed: false, reason: "login_required", wishlistId: null, pageInfo: { page, pageSize, total: 0, hasMore: false }, items: [] };
}

function guestNoop(action = "add") {
  return { ok: true, authenticated: false, allowed: false, reason: "login_required", performed: false, changed: false, action, inWishlist: false, wishlistId: null, itemId: null };
}

async function safeListItems(tx, wishlistId, page, pageSize) {
  const where = { wishlistId };

  const tries = [
    async () =>
      tx.wishlistItem.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: true, variant: true },
      }),
    async () =>
      tx.wishlistItem.findMany({
        where,
        orderBy: { addedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    async () =>
      tx.wishlistItem.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    async () =>
      tx.wishlistItem.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
  ];

  for (const fn of tries) {
    try {
      const rows = await fn();
      if (Array.isArray(rows)) return rows;
    } catch {}
  }
  return [];
}

/* ────────────────────────────────────────────────────────────────
   GET
   ──────────────────────────────────────────────────────────────── */

export async function GET(req) {
  const url = new URL(req.url);
  if (isAdminContext(req)) return denyAdminPlane();

  const productId = safeStr(url.searchParams.get("productId"));
  const variantId = safeStr(url.searchParams.get("variantId"));
  const sizeStockId = safeStr(url.searchParams.get("sizeStockId"));
  const statusMode = !!productId;

  const pid = safeStr(url.searchParams.get("pid"));
  const slug = safeStr(url.searchParams.get("slug"));
  const productCode = safeStr(url.searchParams.get("productCode"));
  const variantPid = safeStr(url.searchParams.get("variantPid"));

  const page = clamp(safeInt(url.searchParams.get("page"), 1), 1, 9999);
  const pageSize = clamp(safeInt(url.searchParams.get("pageSize"), 24), 1, 100);

  const sessionUser = await getCustomerSession(req);
  if (!sessionUser?.id) {
    const cookiePresent = !!req.headers.get("cookie");
    return jsonNoStore(
      statusMode ? guestStatus() : guestList(page, pageSize),
      401,
      { "x-tdlc-auth-reason": "no_customer_session", "x-tdlc-cookie-present": cookiePresent ? "1" : "0" }
    );
  }

  if (statusMode) {
    try {
      const out = await prisma.$transaction(async (tx) => {
        const wishlist = await findDefaultWishlist(tx, sessionUser.id);

        if (!wishlist || !prismaModelAvailable(tx, "wishlistItem")) {
          return { ok: true, authenticated: true, allowed: true, inWishlist: false, wishlistId: wishlist?.id ?? null, itemId: null };
        }

        const internalProductId = await resolveInternalProductId(tx, { productId, variantId, pid, slug, productCode, variantPid });
        if (!internalProductId) {
          return { ok: true, authenticated: true, allowed: true, inWishlist: false, wishlistId: wishlist.id, itemId: null, degraded: true, reason: "product_not_resolved_for_fk" };
        }

        const internalVariantId = await resolveInternalVariantId(tx, { variantId, variantPid }, internalProductId);

        const item = await findWishlistItem(tx, wishlist.id, {
          productId: internalProductId,
          variantId: internalVariantId,
          sizeStockId,
        });

        return { ok: true, authenticated: true, allowed: true, inWishlist: !!item, wishlistId: wishlist.id, itemId: item?.id ?? null };
      });

      return jsonNoStore(out);
    } catch (e) {
      return jsonNoStore({ ok: false, error: e?.message || "wishlist_status_failed" }, 500);
    }
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const { wishlist, reason } = await getOrCreateDefaultWishlist(tx, sessionUser.id);

      if (!wishlist || !prismaModelAvailable(tx, "wishlistItem")) {
        return { ok: true, authenticated: true, allowed: true, wishlistId: wishlist?.id ?? null, pageInfo: { page, pageSize, total: 0, hasMore: false }, items: [], degraded: true, reason };
      }

      let total = 0;
      try {
        total = await tx.wishlistItem.count({ where: { wishlistId: wishlist.id } });
      } catch {
        total = 0;
      }

      const items = await safeListItems(tx, wishlist.id, page, pageSize);

      return { ok: true, authenticated: true, allowed: true, wishlistId: wishlist.id, pageInfo: { page, pageSize, total, hasMore: page * pageSize < total }, items };
    });

    return jsonNoStore(out);
  } catch (e) {
    return jsonNoStore({ ok: false, error: e?.message || "wishlist_failed" }, 500);
  }
}

/* ────────────────────────────────────────────────────────────────
   POST
   ──────────────────────────────────────────────────────────────── */

export async function POST(req) {
  if (isAdminContext(req)) return denyAdminPlane();

  const body = await req.json().catch(() => null);
  let action = normalizeAction(body?.action);

  const sessionUser = await getCustomerSession(req);
  if (!sessionUser?.id) {
    const cookiePresent = !!req.headers.get("cookie");
    return jsonNoStore(
      guestNoop(action),
      401,
      { "x-tdlc-auth-reason": "no_customer_session", "x-tdlc-cookie-present": cookiePresent ? "1" : "0" }
    );
  }

  const incoming = {
    productId: safeStr(body?.productId),
    variantId: safeStr(body?.variantId) || null,
    sizeStockId: safeStr(body?.sizeStockId) || null,
    pid: safeStr(body?.pid),
    slug: safeStr(body?.slug),
    productCode: safeStr(body?.productCode || body?.code || body?.sku),
    variantPid: safeStr(body?.variantPid),
  };

  const itemId = safeStr(body?.itemId);
  if (action === "remove" && !itemId) action = "add";

  if (action === "add" && !incoming.productId && !incoming.slug && !incoming.pid && !incoming.productCode) {
    return jsonNoStore({ ok: false, error: "missing_product_identifier" }, 400);
  }

  if (action === "remove" && !itemId) {
    return jsonNoStore({ ok: false, error: "missing_itemId" }, 400);
  }

  const qty = body?.qty;
  const note = body?.note;
  const addedFrom = body?.addedFrom;

  try {
    const out = await prisma.$transaction(async (tx) => {
      const { wishlist, reason } = await getOrCreateDefaultWishlist(tx, sessionUser.id);
      if (!wishlist) return { ok: false, error: "wishlist_unavailable", reason };

      if (action === "remove") {
        const del = await deleteWishlistItemByIdScoped(tx, wishlist.id, itemId);
        const changed = !!(del?.ok && !del?.notFound);

        return {
          ok: del.ok,
          authenticated: true,
          allowed: true,
          performed: del.ok,
          changed,
          action: "remove",
          inWishlist: false,
          wishlistId: wishlist.id,
          itemId: null,
          message: del.ok ? (changed ? "removed" : "not_in_wishlist") : null,
          error: del.ok ? null : del.error,
        };
      }

      const internalProductId = await resolveInternalProductId(tx, incoming);
      if (!internalProductId) {
        return {
          ok: false,
          authenticated: true,
          allowed: true,
          performed: false,
          changed: false,
          action: "add",
          inWishlist: false,
          wishlistId: wishlist.id,
          itemId: null,
          error: "product_not_resolved_for_fk",
          details: "WishlistItem.productId is a required FK to Product.id. The provided identifiers did not resolve to an existing Product record.",
          debug: { incoming: { ...incoming } },
        };
      }

      const internalVariantId = await resolveInternalVariantId(tx, incoming, internalProductId);

      const resolvedKey = {
        productId: internalProductId,
        variantId: internalVariantId,
        sizeStockId: incoming.sizeStockId || null,
      };

      const existing = await findWishlistItem(tx, wishlist.id, resolvedKey);
      if (existing) {
        return {
          ok: true,
          authenticated: true,
          allowed: true,
          performed: true,
          changed: false,
          action: "add",
          inWishlist: true,
          alreadyInWishlist: true,
          wishlistId: wishlist.id,
          itemId: existing.id,
          message: "already_in_wishlist",
        };
      }

      const created = await createWishlistItem(tx, wishlist.id, sessionUser.id, {
        ...resolvedKey,
        qty,
        note,
        addedFrom,
      });

      return {
        ok: created.ok,
        authenticated: true,
        allowed: true,
        performed: created.ok,
        changed: created.ok,
        action: "add",
        inWishlist: created.ok,
        alreadyInWishlist: false,
        wishlistId: wishlist.id,
        itemId: created.id ?? null,
        message: created.ok ? "added" : null,
        error: created.ok ? null : created.error,
        debug: {
          resolved: { ...resolvedKey },
        },
      };
    });

    const status = out?.ok === true ? 200 : out?.error === "product_not_resolved_for_fk" ? 400 : 500;

    return jsonNoStore(out, status);
  } catch (e) {
    return jsonNoStore({ ok: false, error: e?.message || "wishlist_failed" }, 500);
  }
}
