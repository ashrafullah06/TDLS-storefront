// FILE: lib/analytics/profit.js
import prisma from "@/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;

function toNum(v, d = 0) {
  if (v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function round2(n) {
  return Math.round((toNum(n, 0) + Number.EPSILON) * 100) / 100;
}

function startOfUTCDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function isoDayKey(dt) {
  const d = new Date(dt);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function weekKey(dt) {
  // ISO-like week key (simple UTC-based)
  const d = startOfUTCDay(dt);
  const day = d.getUTCDay() || 7; // 1..7, Monday=1
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / DAY) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(dt) {
  const d = new Date(dt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quarterKey(dt) {
  const d = new Date(dt);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

function halfKey(dt) {
  const d = new Date(dt);
  const h = d.getUTCMonth() < 6 ? 1 : 2;
  return `${d.getUTCFullYear()}-H${h}`;
}

function yearKey(dt) {
  return String(new Date(dt).getUTCFullYear());
}

function timeBucketKey(dt, group) {
  const g = String(group || "month").toLowerCase();
  if (g === "day") return isoDayKey(dt);
  if (g === "week") return weekKey(dt);
  if (g === "quarter") return quarterKey(dt);
  if (g === "half") return halfKey(dt);
  if (g === "year") return yearKey(dt);
  if (g === "total") return "TOTAL";
  return monthKey(dt);
}

const PAID_STATUSES = new Set(["PAID", "SETTLED", "CAPTURED", "SUCCEEDED"]);

function isPaid(paymentStatus) {
  const ps = String(paymentStatus || "").toUpperCase();
  return PAID_STATUSES.has(ps);
}

/**
 * Build a per-variant cost timeline from CostSnapshot:
 * costAt(t) = latest snapshot where createdAt <= t, else null.
 */
function buildCostTimeline(costSnapshotsAsc) {
  return {
    costAt(time) {
      const t = new Date(time).getTime();
      if (!Number.isFinite(t) || costSnapshotsAsc.length === 0) return null;
      // binary search last <= t
      let lo = 0,
        hi = costSnapshotsAsc.length - 1,
        ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const mt = new Date(costSnapshotsAsc[mid].createdAt).getTime();
        if (mt <= t) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (ans < 0) return null;
      const s = costSnapshotsAsc[ans];
      const unit = toNum(s.cogsUnit, 0) + toNum(s.overheadPerUnit, 0);
      return { unit: round2(unit), source: "SNAPSHOT", label: s.versionLabel || null };
    },
  };
}

/**
 * Compute Profit/Loss by:
 * - time bucket (group)
 * - dimension: product | variant | batch
 *
 * Notes:
 * - Sales: uses OrderItem.subtotal - discountTotal (excludes tax/shipping).
 * - Refund impact: uses ReturnLine.lineRefund, attributed by refund_date (default) or sale_date.
 */
export async function computeProfit({
  start,
  end,
  group = "month",
  dimension = "product", // product | variant | batch
  paidOnly = true,
  refundAttribution = "refund_date", // refund_date | sale_date
  limit = 200,
} = {}) {
  const startAt = startOfUTCDay(start instanceof Date ? start : new Date(start));
  const endAt = startOfUTCDay(end instanceof Date ? end : new Date(end));
  const endExclusive = new Date(endAt.getTime() + DAY); // include full end-day

  const dim = String(dimension || "product").toLowerCase();
  const wantsBatch = dim === "batch";

  // IMPORTANT: do not filter paid-only inside Prisma by paymentStatus IN (...) because
  // enums/casing can differ and would silently drop real paid orders.
  const orderWhere = {
    createdAt: { gte: startAt, lt: endExclusive },
  };

  // Pull order items in range (schema-safe optional batch)
  const items = await findOrderItemsSchemaSafe({
    orderWhere,
    wantsBatch,
    limit,
  });

  // Pull return lines (refunds) in range (schema-safe optional batch)
  const returnLines = await findReturnLinesSchemaSafe({
    startAt,
    endExclusive,
    wantsBatch,
  });

  // Prefetch CostSnapshots for all variants seen (for fallback cost)
  const variantIds = Array.from(new Set(items.map((it) => it.variantId).filter(Boolean)));

  const snapshots = variantIds.length
    ? await prisma.costSnapshot.findMany({
        where: {
          variantId: { in: variantIds },
          createdAt: { lte: endExclusive },
        },
        select: {
          variantId: true,
          createdAt: true,
          cogsUnit: true,
          overheadPerUnit: true,
          versionLabel: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const timelineByVariant = new Map();
  for (const s of snapshots) {
    if (!timelineByVariant.has(s.variantId)) timelineByVariant.set(s.variantId, []);
    timelineByVariant.get(s.variantId).push(s);
  }
  const costFnByVariant = new Map();
  for (const [vid, arr] of timelineByVariant.entries()) {
    costFnByVariant.set(vid, buildCostTimeline(arr));
  }

  function pickDimensionKey(it) {
    if (dim === "batch") {
      return it?.batch?.code || it?.batchId || "UNASSIGNED_BATCH";
    }
    if (dim === "variant") {
      return it?.variant?.id || it?.variantId || it?.sku || "UNKNOWN_VARIANT";
    }
    return it?.variant?.product?.id || it?.variant?.productId || "UNKNOWN_PRODUCT";
  }

  function dimensionLabel(it) {
    if (dim === "batch") return it?.batch?.code || "Unassigned batch";
    if (dim === "variant")
      return it?.variant?.title || it?.title || it?.variant?.sku || it?.sku || "Unknown variant";
    return it?.variant?.product?.name || "Unknown product";
  }

  function dimensionMeta(it) {
    if (dim === "batch") return { batchCode: it?.batch?.code || null, batchId: it?.batch?.id || it?.batchId || null };
    if (dim === "variant")
      return {
        variantId: it?.variant?.id || it?.variantId || null,
        sku: it?.variant?.sku || it?.sku || null,
        productId: it?.variant?.product?.id || it?.variant?.productId || null,
        productName: it?.variant?.product?.name || null,
        productSlug: it?.variant?.product?.slug || null,
      };
    return {
      productId: it?.variant?.product?.id || it?.variant?.productId || null,
      productName: it?.variant?.product?.name || null,
      productSlug: it?.variant?.product?.slug || null,
    };
  }

  function unitCostFor(it) {
    const frozen = toNum(it?.costChosen, NaN);
    if (Number.isFinite(frozen)) {
      return { unit: round2(frozen), source: it?.costSource || "LINE", label: null };
    }
    const vid = it?.variant?.id || it?.variantId;
    const fn = vid ? costFnByVariant.get(vid) : null;
    const got = fn?.costAt(it?.order?.createdAt || it?.createdAt);
    if (got) return got;
    return { unit: 0, source: "MISSING_COST", label: null };
  }

  // Aggregation map: bucket -> dimKey -> metrics
  const agg = new Map();

  function ensure(bucket, dimKey, sampleItem) {
    if (!agg.has(bucket)) agg.set(bucket, new Map());
    const b = agg.get(bucket);
    if (!b.has(dimKey)) {
      b.set(dimKey, {
        bucket,
        key: dimKey,
        label: dimensionLabel(sampleItem),
        meta: dimensionMeta(sampleItem),

        units: 0,

        salesNet: 0, // subtotal - discount
        tax: 0,
        salesGross: 0, // total

        refunds: 0,

        cogs: 0,
        grossProfit: 0,
        marginPct: 0,

        costSources: {}, // count by source
      });
    }
    return b.get(dimKey);
  }

  // Sales + COGS
  for (const it of items) {
    if (paidOnly && !isPaid(it?.order?.paymentStatus)) continue;

    const bucket = timeBucketKey(it?.order?.createdAt || it?.createdAt, group);
    const dimKey = pickDimensionKey(it);
    const m = ensure(bucket, dimKey, it);

    const qty = Number(it?.quantity || 0) || 0;
    const subtotal = toNum(it?.subtotal, 0);
    const discount = toNum(it?.discountTotal, 0);
    const tax = toNum(it?.taxTotal, 0);
    const total = toNum(it?.total, 0);

    const salesNet = Math.max(0, subtotal - discount);

    const cost = unitCostFor(it);
    const lineCogs = qty * toNum(cost.unit, 0);

    m.units += qty;
    m.salesNet += salesNet;
    m.tax += tax;
    m.salesGross += total;
    m.cogs += lineCogs;

    const src = String(cost.source || "UNKNOWN");
    m.costSources[src] = (m.costSources[src] || 0) + 1;
  }

  // Refunds (ReturnLine.lineRefund)
  for (const rl of returnLines) {
    const li = rl?.orderItem;
    if (!li) continue;

    const when =
      String(refundAttribution) === "sale_date"
        ? li?.order?.createdAt
        : rl?.returnRequest?.createdAt;

    const bucket = timeBucketKey(when, group);
    const dimKey = pickDimensionKey(li);

    const m = ensure(bucket, dimKey, li);
    m.refunds += toNum(rl?.lineRefund, 0);
  }

  // Finalize rows
  const out = [];
  for (const [, byDim] of agg.entries()) {
    for (const row of byDim.values()) {
      row.salesNet = round2(row.salesNet);
      row.tax = round2(row.tax);
      row.salesGross = round2(row.salesGross);
      row.refunds = round2(row.refunds);
      row.cogs = round2(row.cogs);

      const netRevenue = row.salesNet - row.refunds;
      row.grossProfit = round2(netRevenue - row.cogs);
      row.marginPct = netRevenue > 0 ? round2((row.grossProfit / netRevenue) * 100) : 0;

      out.push(row);
    }
  }

  out.sort((a, b) => {
    if (a.bucket === b.bucket) return b.salesNet - a.salesNet;
    return String(b.bucket).localeCompare(String(a.bucket));
  });

  const totals = out.reduce(
    (acc, r) => {
      acc.units += r.units;
      acc.salesNet += r.salesNet;
      acc.refunds += r.refunds;
      acc.cogs += r.cogs;
      acc.grossProfit += r.grossProfit;
      return acc;
    },
    { units: 0, salesNet: 0, refunds: 0, cogs: 0, grossProfit: 0, marginPct: 0 }
  );

  const netRevenue = totals.salesNet - totals.refunds;
  totals.marginPct = netRevenue > 0 ? round2((totals.grossProfit / netRevenue) * 100) : 0;

  return {
    ok: true,
    range: { start: startAt.toISOString(), end: endExclusive.toISOString() },
    group,
    dimension,
    paidOnly,
    refundAttribution,
    totals: {
      units: totals.units,
      salesNet: round2(totals.salesNet),
      refunds: round2(totals.refunds),
      cogs: round2(totals.cogs),
      grossProfit: round2(totals.grossProfit),
      marginPct: totals.marginPct,
    },
    rows: out,
  };
}

/* ===========================
 * Schema-safe Prisma fetchers
 * =========================== */

async function findOrderItemsSchemaSafe({ orderWhere, wantsBatch, limit }) {
  const take = Math.max(1, Math.min(50000, Number(limit) > 0 ? Number(limit) * 100 : 50000));

  const baseSelect = {
    id: true,
    quantity: true,
    subtotal: true,
    discountTotal: true,
    taxTotal: true,
    total: true,
    unitPrice: true,
    costChosen: true,
    costSource: true,
    createdAt: true,
    variantId: true,
    title: true,
    sku: true,
    order: {
      select: {
        id: true,
        createdAt: true,
        paymentStatus: true,
        status: true,
      },
    },
    variant: {
      select: {
        id: true,
        sku: true,
        title: true,
        productId: true,
        product: { select: { id: true, name: true, slug: true } },
      },
    },
  };

  // Try including batch fields only when requested, and fall back if schema doesn't have them.
  if (wantsBatch) {
    try {
      return await prisma.orderItem.findMany({
        where: { order: orderWhere },
        select: {
          ...baseSelect,
          batchId: true,
          batch: { select: { id: true, code: true } },
        },
        orderBy: { createdAt: "asc" },
        take,
      });
    } catch {
      // fall through to no-batch
    }
  }

  return await prisma.orderItem.findMany({
    where: { order: orderWhere },
    select: baseSelect,
    orderBy: { createdAt: "asc" },
    take,
  });
}

async function findReturnLinesSchemaSafe({ startAt, endExclusive, wantsBatch }) {
  const baseSelect = {
    quantity: true,
    lineRefund: true,
    orderItemId: true,
    returnRequest: { select: { createdAt: true, status: true } },
    orderItem: {
      select: {
        variantId: true,
        sku: true,
        title: true,
        variant: {
          select: {
            id: true,
            sku: true,
            title: true,
            productId: true,
            product: { select: { id: true, name: true, slug: true } },
          },
        },
        order: { select: { createdAt: true, paymentStatus: true } },
      },
    },
  };

  if (wantsBatch) {
    try {
      return await prisma.returnLine.findMany({
        where: { returnRequest: { createdAt: { gte: startAt, lt: endExclusive } } },
        select: {
          ...baseSelect,
          orderItem: {
            select: {
              ...baseSelect.orderItem.select,
              batchId: true,
              batch: { select: { id: true, code: true } },
            },
          },
        },
      });
    } catch {
      // fall through to no-batch
    }
  }

  return await prisma.returnLine.findMany({
    where: { returnRequest: { createdAt: { gte: startAt, lt: endExclusive } } },
    select: baseSelect,
  });
}
