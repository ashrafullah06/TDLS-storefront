// FILE: app/api/wishlist/status/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/**
 * Customer-scoped wishlist status endpoint.
 * - No admin-plane mixing
 * - NO DB writes (status checks must not create wishlists)
 *
 * FIX:
 * - Login detection is now central + deterministic via `auth()` (Auth.js / NextAuth),
 *   instead of fetching /api/auth/session and guessing cookie shapes.
 */

function jsonNoStore(body, status = 200, extraHeaders = {}) {
  const authenticated = body?.authenticated === true ? "1" : "0";

  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      Vary: "Cookie, Authorization",
      "x-tdlc-scope": "customer",
      "x-tdlc-authenticated": authenticated,
      ...extraHeaders,
    },
  });
}

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s || "";
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
    { ok: false, authenticated: false, inWishlist: false, error: "admin_plane_not_supported" },
    404
  );
}

async function getCustomerSession(req) {
  // IMPORTANT:
  // In Route Handlers, pass the Request object into `auth(req)` so Auth.js can
  // reliably read cookies for the current request. Calling `auth()` with no args
  // can resolve to null here even when the browser is logged in.
  try {
    const session = await auth(req);

    const userId =
      session?.user?.id ??
      session?.userId ??
      session?.user?.sub ??
      session?.uid ??
      null;

    if (!userId) return null;

    return {
      id: String(userId),
      email: session?.user?.email ?? null,
      name: session?.user?.name ?? null,
    };
  } catch {
    // Safe fallback (should rarely be needed)
    try {
      const session = await auth();

      const userId =
        session?.user?.id ??
        session?.userId ??
        session?.user?.sub ??
        session?.uid ??
        null;

      if (!userId) return null;

      return {
        id: String(userId),
        email: session?.user?.email ?? null,
        name: session?.user?.name ?? null,
      };
    } catch {
      return null;
    }
  }
}

function prismaModelAvailable(client, name) {
  try {
    const m = client?.[name];
    return !!(m && typeof m.findFirst === "function");
  } catch {
    return false;
  }
}

async function findDefaultWishlist(tx, userId) {
  if (!prismaModelAvailable(tx, "wishlist")) return null;

  const attempts = [
    () => tx.wishlist.findFirst({ where: { userId, isDefault: true } }),
    () => tx.wishlist.findFirst({ where: { userId, name: "Default" } }),
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

async function findWishlistItem(tx, wishlistId, keys) {
  if (!prismaModelAvailable(tx, "wishlistItem")) return null;

  const { productId, pid, productCode, slug } = keys;

  const attempts = [
    () => tx.wishlistItem.findFirst({ where: { wishlistId, productId }, select: { id: true } }),
    () => tx.wishlistItem.findFirst({ where: { wishlistId, pid }, select: { id: true } }),
    () => tx.wishlistItem.findFirst({ where: { wishlistId, productCode }, select: { id: true } }),
    () => tx.wishlistItem.findFirst({ where: { wishlistId, slug }, select: { id: true } }),
    () =>
      tx.wishlistItem.findFirst({
        where: {
          wishlistId,
          OR: [
            productId ? { productId } : undefined,
            pid ? { pid } : undefined,
            productCode ? { productCode } : undefined,
            slug ? { slug } : undefined,
          ].filter(Boolean),
        },
        select: { id: true },
      }),
  ];

  for (const attempt of attempts) {
    try {
      const row = await attempt();
      if (row) return row;
    } catch {}
  }
  return null;
}

export async function GET(req) {
  if (isAdminContext(req)) return denyAdminPlane();

  const url = new URL(req.url);

  const productId = safeStr(url.searchParams.get("productId"));
  const pid = safeStr(url.searchParams.get("pid"));
  const productCode = safeStr(url.searchParams.get("productCode"));
  const slug = safeStr(url.searchParams.get("slug"));

  if (!productId && !pid && !productCode && !slug) {
    return jsonNoStore(
      { ok: false, authenticated: false, inWishlist: false, error: "missing_product_identifier" },
      400
    );
  }

  const sessionUser = await getCustomerSession(req);
  if (!sessionUser?.id) {
    // Guest: status should be false (wishlist is account-only)
    return jsonNoStore({
      ok: true,
      authenticated: false,
      inWishlist: false,
      wishlistId: null,
      itemId: null,
    });
  }

  try {
    const out = await prisma.$transaction(async (tx) => {
      const wishlist = await findDefaultWishlist(tx, sessionUser.id);
      if (!wishlist) {
        return {
          ok: true,
          authenticated: true,
          inWishlist: false,
          wishlistId: null,
          itemId: null,
        };
      }

      const item = await findWishlistItem(tx, wishlist.id, { productId, pid, productCode, slug });

      return {
        ok: true,
        authenticated: true,
        inWishlist: !!item,
        wishlistId: wishlist.id,
        itemId: item?.id ?? null,
      };
    });

    return jsonNoStore(out);
  } catch (e) {
    return jsonNoStore(
      { ok: false, authenticated: true, inWishlist: false, error: e?.message || "wishlist_status_failed" },
      500
    );
  }
}
