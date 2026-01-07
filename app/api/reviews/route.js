// PATH: app/api/reviews/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * REVIEWS API (Customer scope)
 *
 * FIXED RULES (as you required):
 * - Rating-only is allowed (no body needed).
 * - If body is provided, it must be >= 5 chars.
 * - Logged-in user: NO name input required; use account identity automatically.
 * - Guest user: name OPTIONAL; if missing => "Anonymous".
 *
 * CRITICAL FK FIX:
 * - Client may send productId (Prisma id), pid, slug, or strapiId.
 * - We ALWAYS resolve to canonical Prisma Product.id before ANY read/write.
 * - If not resolvable => return 404 (never attempt create that would trigger FK error).
 *
 * NOTE:
 * - Rating-only entries are approved immediately (no moderation needed).
 * - Written reviews remain pending approval (isApproved=false).
 * - Review list excludes rating-only (body === "") but summary counts include them.
 */

function jsonNoStore(body, status = 200, extraHeaders = {}) {
  return NextResponse.json(body ?? null, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Vary: "Cookie, Authorization",
      ...extraHeaders,
    },
  });
}

function safeInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function safeStr(v) {
  const s = String(v ?? "").trim();
  return s || "";
}

function isPrismaFkError(e) {
  // Prisma FK error code: P2003
  return !!(e && (e.code === "P2003" || String(e.message || "").includes("Foreign key constraint")));
}

async function getCustomerSession(req) {
  try {
    const origin = new URL(req.url).origin;
    const cookie = req.headers.get("cookie") || "";

    const controller = new AbortController();
    const timeout =
      typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(2500) : null;

    let t = null;
    if (!timeout) t = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${origin}/api/auth/session`, {
      headers: { cookie },
      cache: "no-store",
      signal: timeout || controller.signal,
    }).catch(() => null);

    if (t) clearTimeout(t);

    if (!res || !res.ok) return null;
    const s = await res.json().catch(() => null);
    const u = s?.user || null;
    if (!u) return null;

    // Accept typical Auth.js user shapes
    return u && (u.id || u.email) ? u : null;
  } catch {
    return null;
  }
}

async function resolveProductId({ productId, pid, slug, strapiId }) {
  // 0) normalize
  const candId = safeStr(productId);
  const candPid = safeStr(pid);
  const candSlug = safeStr(slug);
  const candStrapiIdRaw = safeStr(strapiId);

  // 1) Prisma Product.id (string cuid)
  for (const cand of [candId, candPid].filter(Boolean)) {
    try {
      const found = await prisma.product.findUnique({
        where: { id: cand },
        select: { id: true },
      });
      if (found?.id) return found.id;
    } catch {
      // ignore
    }
  }

  // 2) If your Product model has productUuid (common in TDLC setups)
  for (const cand of [candId, candPid].filter(Boolean)) {
    try {
      const found = await prisma.product.findFirst({
        where: { productUuid: cand },
        select: { id: true },
      });
      if (found?.id) return found.id;
    } catch {
      // ignore if field not present
    }
  }

  // 3) Strapi numeric id => Product.strapiId (if present)
  const parsedStrapi = clamp(safeInt(candStrapiIdRaw || candId, 0), 0, 2_147_483_647);
  if (parsedStrapi > 0) {
    try {
      const found = await prisma.product.findFirst({
        where: { strapiId: parsedStrapi },
        select: { id: true },
      });
      if (found?.id) return found.id;
    } catch {
      // ignore if field not present
    }
  }

  // 4) Slug lookup
  if (candSlug) {
    try {
      const found = await prisma.product.findFirst({
        where: { slug: candSlug },
        select: { id: true },
      });
      if (found?.id) return found.id;
    } catch {
      // ignore if no slug
    }
  }

  // 5) Fallback: sometimes client mistakenly sends slug in productId/pid
  for (const maybeSlug of [candId, candPid].filter(Boolean)) {
    try {
      const found = await prisma.product.findFirst({
        where: { slug: maybeSlug },
        select: { id: true },
      });
      if (found?.id) return found.id;
    } catch {
      // ignore
    }
  }

  return null;
}

async function getVoteAgg(reviewIds) {
  if (!reviewIds?.length) return { byId: new Map() };

  const rows = await prisma.productReviewVote.groupBy({
    by: ["reviewId", "value"],
    where: { reviewId: { in: reviewIds } },
    _count: { _all: true },
  });

  const byId = new Map();
  for (const r of rows) {
    const id = r.reviewId;
    const base = byId.get(id) || { helpfulCount: 0, notHelpfulCount: 0 };
    if (r.value === 1) base.helpfulCount = r._count?._all ?? 0;
    if (r.value === -1) base.notHelpfulCount = r._count?._all ?? 0;
    byId.set(id, base);
  }
  return { byId };
}

/**
 * Helpful sort:
 * - Only VISIBLE reviews: body !== "" (rating-only excluded from list)
 * - Sort by helpful votes desc, tie-breaker createdAt desc
 */
async function getHelpfulSortedPage({ productId, page, pageSize }) {
  const base = await prisma.productReview.findMany({
    where: { productId, isApproved: true, body: { not: "" } },
    select: { id: true, createdAt: true },
  });

  if (!base.length) return { pageIds: [], total: 0, orderIndex: new Map() };

  const ids = base.map((x) => x.id);

  const voteRows = await prisma.productReviewVote.groupBy({
    by: ["reviewId", "value"],
    where: { reviewId: { in: ids } },
    _count: { _all: true },
  });

  const helpfulMap = new Map();
  for (const r of voteRows) {
    if (r.value === 1) helpfulMap.set(r.reviewId, r._count?._all ?? 0);
  }

  const ranked = base
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      helpful: helpfulMap.get(r.id) ?? 0,
    }))
    .sort((a, b) => {
      if (b.helpful !== a.helpful) return b.helpful - a.helpful;
      return b.createdAt - a.createdAt;
    });

  const total = ranked.length;
  const start = (page - 1) * pageSize;
  const pageIds = ranked.slice(start, start + pageSize).map((x) => x.id);

  const orderIndex = new Map();
  pageIds.forEach((id, idx) => orderIndex.set(id, idx));

  return { pageIds, total, orderIndex };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    const productIdParam = safeStr(url.searchParams.get("productId"));
    const pid = safeStr(url.searchParams.get("pid"));
    const slug = safeStr(url.searchParams.get("slug"));
    const strapiId = safeStr(url.searchParams.get("strapiId"));

    const resolvedProductId = await resolveProductId({
      productId: productIdParam,
      pid,
      slug,
      strapiId,
    });

    if (!resolvedProductId) {
      return jsonNoStore(
        {
          error: "product_not_found",
          message:
            "Product not found in Prisma DB. Ensure this product is synced from Strapi to Prisma before allowing reviews.",
        },
        404
      );
    }

    const page = clamp(safeInt(url.searchParams.get("page"), 1), 1, 9999);
    const pageSize = clamp(safeInt(url.searchParams.get("pageSize"), 8), 1, 50);
    const sort = safeStr(url.searchParams.get("sort") || "recent");

    const sessionUser = await getCustomerSession(req);

    // Summary includes rating-only (approved)
    const [countAllApproved, avg, dist, visibleCount] = await Promise.all([
      prisma.productReview.count({
        where: { productId: resolvedProductId, isApproved: true },
      }),
      prisma.productReview.aggregate({
        where: { productId: resolvedProductId, isApproved: true },
        _avg: { rating: true },
      }),
      prisma.productReview.groupBy({
        by: ["rating"],
        where: { productId: resolvedProductId, isApproved: true },
        _count: { _all: true },
      }),
      // List excludes rating-only
      prisma.productReview.count({
        where: { productId: resolvedProductId, isApproved: true, body: { not: "" } },
      }),
    ]);

    const distribution = {};
    for (const row of dist) distribution[String(row.rating)] = row._count?._all ?? 0;

    let reviewsRaw = [];
    let hasMore = false;
    let totalForPageInfo = visibleCount;

    if (sort === "helpful") {
      const { pageIds, total, orderIndex } = await getHelpfulSortedPage({
        productId: resolvedProductId,
        page,
        pageSize,
      });

      totalForPageInfo = total;

      if (!pageIds.length) {
        return jsonNoStore({
          summary: { count: countAllApproved, avgRating: avg?._avg?.rating ?? 0, distribution },
          pageInfo: { page, pageSize, total: totalForPageInfo, hasMore: false },
          reviews: [],
        });
      }

      reviewsRaw = await prisma.productReview.findMany({
        where: { id: { in: pageIds } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          userId: true,
          displayName: true,
          rating: true,
          title: true,
          body: true,
          isVerifiedPurchase: true,
          wouldRecommend: true,
          fitFeedback: true,
          createdAt: true,
        },
      });

      reviewsRaw.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
      hasMore = page * pageSize < totalForPageInfo;
    } else {
      const orderBy =
        sort === "highest"
          ? [{ rating: "desc" }, { createdAt: "desc" }]
          : sort === "lowest"
          ? [{ rating: "asc" }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }];

      reviewsRaw = await prisma.productReview.findMany({
        where: { productId: resolvedProductId, isApproved: true, body: { not: "" } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          productId: true,
          variantId: true,
          userId: true,
          displayName: true,
          rating: true,
          title: true,
          body: true,
          isVerifiedPurchase: true,
          wouldRecommend: true,
          fitFeedback: true,
          createdAt: true,
        },
      });

      hasMore = page * pageSize < visibleCount;
    }

    const reviewIds = reviewsRaw.map((r) => r.id);

    const [{ byId: aggById }, myVotes] = await Promise.all([
      getVoteAgg(reviewIds),
      sessionUser?.id
        ? prisma.productReviewVote.findMany({
            where: { userId: sessionUser.id, reviewId: { in: reviewIds } },
            select: { reviewId: true, value: true },
          })
        : Promise.resolve([]),
    ]);

    const myVoteMap = new Map();
    for (const v of myVotes || []) myVoteMap.set(v.reviewId, v.value);

    const reviews = reviewsRaw.map((r) => {
      const agg = aggById.get(r.id);
      return {
        ...r,
        helpfulCount: agg?.helpfulCount ?? 0,
        notHelpfulCount: agg?.notHelpfulCount ?? 0,
        myVote: myVoteMap.get(r.id) ?? 0,
      };
    });

    return jsonNoStore({
      summary: { count: countAllApproved, avgRating: avg?._avg?.rating ?? 0, distribution },
      pageInfo: { page, pageSize, total: totalForPageInfo, hasMore },
      reviews,
    });
  } catch (e) {
    return jsonNoStore({ error: e?.message || "Failed to load reviews" }, 500);
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const action = safeStr(body?.action);

    if (!action) return jsonNoStore({ ok: false, error: "action is required" }, 400);

    const sessionUser = await getCustomerSession(req);

    if (action === "create") {
      const productIdParam = safeStr(body?.productId);
      const pid = safeStr(body?.pid);
      const slug = safeStr(body?.slug);
      const strapiId = safeStr(body?.strapiId);
      const variantId = body?.variantId ? safeStr(body.variantId) : null;

      const resolvedProductId = await resolveProductId({
        productId: productIdParam,
        pid,
        slug,
        strapiId,
      });

      if (!resolvedProductId) {
        return jsonNoStore(
          {
            ok: false,
            error: "product_not_found",
            message:
              "Product not found in Prisma DB. Sync this product to Prisma before accepting reviews.",
          },
          404
        );
      }

      const ratingRaw = safeInt(body?.rating, 0);
      const rating = clamp(ratingRaw, 1, 5);

      // rating must be provided
      if (ratingRaw < 1 || ratingRaw > 5) {
        return jsonNoStore({ ok: false, error: "rating is required (1-5)" }, 400);
      }

      const title = body?.title ? safeStr(body.title) : null;

      // body is OPTIONAL (rating-only allowed)
      const reviewBodyTrimmed = safeStr(body?.body);
      const hasBody = reviewBodyTrimmed.length > 0;

      // only enforce min length if body exists
      if (hasBody && reviewBodyTrimmed.length < 5) {
        return jsonNoStore({ ok: false, error: "body is required (min 5 chars)" }, 400);
      }

      const anonymous = !!body?.anonymous;

      // DISPLAY NAME RULES (exactly as you required)
      // - logged in: auto identity (no input)
      // - guest: optional, default Anonymous
      const userId = sessionUser?.id || null;
      const sessionLabel = safeStr(sessionUser?.name) || safeStr(sessionUser?.email) || "Customer";

      let resolvedDisplayName = "Anonymous";
      if (anonymous) {
        resolvedDisplayName = "Anonymous";
      } else if (userId) {
        resolvedDisplayName = sessionLabel;
      } else {
        const guestName = safeStr(body?.displayName);
        resolvedDisplayName = guestName || "Anonymous";
      }

      const wouldRecommend = body?.wouldRecommend === true;
      const fitFeedbackRaw = body?.fitFeedback ? safeStr(body.fitFeedback) : null;
      const fitFeedback =
        fitFeedbackRaw && ["RUNS_SMALL", "TRUE_TO_SIZE", "RUNS_LARGE"].includes(fitFeedbackRaw)
          ? fitFeedbackRaw
          : fitFeedbackRaw || null;

      const isRatingOnly = !hasBody;

      await prisma.productReview.create({
        data: {
          productId: resolvedProductId,
          variantId,
          userId,
          displayName: resolvedDisplayName,
          rating,
          title: title || null,
          body: hasBody ? reviewBodyTrimmed : "",

          wouldRecommend,
          fitFeedback,

          // keep your existing behavior unless you later wire verified purchase
          isVerifiedPurchase: false,

          // rating-only can be approved instantly
          isApproved: isRatingOnly ? true : false,
        },
      });

      return jsonNoStore({
        ok: true,
        message: isRatingOnly
          ? "Thanks. Your rating was submitted."
          : "Thanks. Your review was submitted and will be published after approval.",
      });
    }

    if (action === "vote") {
      const reviewId = safeStr(body?.reviewId);
      const value = safeInt(body?.value, 0);

      if (!reviewId) return jsonNoStore({ ok: false, error: "reviewId is required" }, 400);
      if (![1, -1].includes(value))
        return jsonNoStore({ ok: false, error: "value must be 1 or -1" }, 400);

      if (!sessionUser?.id)
        return jsonNoStore({ ok: false, error: "You must be signed in to vote" }, 401);

      await prisma.productReviewVote.upsert({
        where: { reviewId_userId: { reviewId, userId: sessionUser.id } },
        update: { value },
        create: { reviewId, userId: sessionUser.id, value },
      });

      const rows = await prisma.productReviewVote.groupBy({
        by: ["value"],
        where: { reviewId },
        _count: { _all: true },
      });

      let helpfulCount = 0;
      let notHelpfulCount = 0;
      for (const r of rows) {
        if (r.value === 1) helpfulCount = r._count?._all ?? 0;
        if (r.value === -1) notHelpfulCount = r._count?._all ?? 0;
      }

      return jsonNoStore({ ok: true, helpfulCount, notHelpfulCount, myVote: value });
    }

    if (action === "report") {
      const reviewId = safeStr(body?.reviewId);
      const reason = safeStr(body?.reason);

      if (!reviewId) return jsonNoStore({ ok: false, error: "reviewId is required" }, 400);
      if (!reason || reason.length < 3)
        return jsonNoStore({ ok: false, error: "reason is required (min 3 chars)" }, 400);

      await prisma.productReviewReport.create({
        data: {
          reviewId,
          userId: sessionUser?.id || null,
          reason,
          status: "OPEN",
        },
      });

      return jsonNoStore({ ok: true });
    }

    return jsonNoStore({ ok: false, error: "Unsupported action" }, 400);
  } catch (e) {
    // Convert FK errors into a clean product_not_found signal (no more vague UI failures)
    if (isPrismaFkError(e)) {
      return jsonNoStore(
        {
          ok: false,
          error: "product_not_found",
          message:
            "Product not found in Prisma DB (FK). Ensure product exists in Prisma (synced from Strapi).",
        },
        404
      );
    }
    return jsonNoStore({ ok: false, error: e?.message || "Request failed" }, 500);
  }
}
