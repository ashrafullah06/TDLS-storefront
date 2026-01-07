// FILE: src/lib/analytics/pnl.js
// DB-only LIVE P&L engine (BDT).
// - computePnl: period totals + product-wise inside each period
// - computeProductPnl: variant/product focused P&L (DB-only)
// No external HTTP calls. No placeholders. If a value is absent in DB, output reflects that (e.g., costChosen null => COGS=0).

import prisma from "@/lib/prisma";

/* ===========================
 * PUBLIC: computePnl (preserved shape)
 * =========================== */

export async function computePnl({
  start,
  end,
  group = "month", // week|month|quarter|half|year|total
  // keep signature compatible, but avoid querying unknown enum fields
  statusFilter = null,
  filter = null, // { productId?, variantId?, sku? } — productId will be resolved via ProductVariant
}) {
  const range = { gte: start, lte: endOfDay(end) };

  // 1) Resolve filter → variantIds set (DB-only)
  const resolved = await resolveVariantFilter(filter);

  // 2) Fetch orders + items in a schema-safe way (items key = items)
  const orders = await getOrdersWithItemsDBOnly(range, statusFilter);

  // 3) Collect variantIds for label enrichment
  const variantIds = new Set();
  for (const o of orders) {
    for (const it of o.items || []) {
      if (it?.variantId) variantIds.add(String(it.variantId));
    }
  }

  // 4) Enrich labels from ProductVariant/Product (best-effort, DB-only)
  const variantLabelMap = await buildVariantLabelMap(Array.from(variantIds));

  // 5) Aggregate per period and per variant
  const periods = new Map(); // periodKey => { revenue, cogs, profit, byProduct: Map }
  const totals = { revenue: 0, cogs: 0, profit: 0 };

  for (const o of orders) {
    const prKey = keyOfPeriod(o.createdAt, group);
    const bucket = ensurePeriod(periods, prKey);

    for (const it of o.items || []) {
      if (!it) continue;

      // apply filter at line level (preserve existing flow)
      if (resolved && !matchesResolvedFilter(it, resolved)) continue;

      const qty = toInt(it.quantity);
      if (qty <= 0) continue;

      // Revenue: prefer stored total; else unitPrice * qty; else subtotal
      const revenue =
        toNum(it.total) ||
        (toNum(it.unitPrice) ? toNum(it.unitPrice) * qty : 0) ||
        toNum(it.subtotal);

      // COGS: strictly DB-only freeze field (OrderItem.costChosen)
      const costEach = toNum(it.costChosen);
      const cogs = costEach > 0 ? costEach * qty : 0;

      const profit = revenue - cogs;

      const key = it.variantId
        ? String(it.variantId)
        : it.sku
        ? `sku:${String(it.sku)}`
        : it.title
        ? `title:${String(it.title)}`
        : "unknown";

      const label =
        (it.variantId && variantLabelMap.get(String(it.variantId))) ||
        it.title ||
        it.sku ||
        key;

      // per-product bucket
      const pMap = bucket.byProduct;
      const pRow =
        pMap.get(key) || {
          id: key,
          label,
          units: 0,
          revenue: 0,
          cogs: 0,
          profit: 0,
          // diagnostics
          costCoverageUnits: 0,
        };

      pRow.units += qty;
      pRow.revenue += revenue;
      pRow.cogs += cogs;
      pRow.profit = pRow.revenue - pRow.cogs;
      if (costEach > 0) pRow.costCoverageUnits += qty;

      pMap.set(key, pRow);

      // period totals
      bucket.revenue += revenue;
      bucket.cogs += cogs;
      bucket.profit = bucket.revenue - bucket.cogs;

      totals.revenue += revenue;
      totals.cogs += cogs;
    }
  }

  totals.profit = totals.revenue - totals.cogs;

  const byPeriod = Array.from(periods.entries())
    .map(([k, v]) => ({
      period: k,
      revenue: round2(v.revenue),
      cogs: round2(v.cogs),
      profit: round2(v.profit),
      margin: percent(v.profit, v.revenue),
      byProduct: Array.from(v.byProduct.values())
        .map((r) => ({
          id: r.id,
          label: r.label,
          units: r.units,
          revenue: round2(r.revenue),
          cogs: round2(r.cogs),
          profit: round2(r.profit),
          margin: percent(r.profit, r.revenue),
          // how much of units had costChosen
          costCoveragePct: r.units ? round2((r.costCoverageUnits / r.units) * 100) : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => comparePeriodKey(a.period, b.period));

  let outFilter = undefined;
  if (filter && (filter.productId || filter.variantId || filter.sku)) {
    outFilter = {
      productId: filter.productId ?? null,
      variantId: filter.variantId ?? null,
      sku: filter.sku ?? null,
      label:
        (filter.variantId && variantLabelMap.get(String(filter.variantId))) ||
        (filter.sku ? `sku:${filter.sku}` : null) ||
        (filter.productId ? `product:${filter.productId}` : null),
    };
  }

  return {
    start: toISO(start),
    end: toISO(end),
    group,
    filter: outFilter,
    totals: {
      revenue: round2(totals.revenue),
      cogs: round2(totals.cogs),
      profit: round2(totals.profit),
      margin: percent(totals.profit, totals.revenue),
    },
    byPeriod,
  };
}

/* ===========================
 * PUBLIC: computeProductPnl (DB-only)
 * =========================== */

export async function computeProductPnl({
  productId,
  variantId,
  sku,
  startISO,
  endISO,
  group = "month",
}) {
  const start = parseISOStart(startISO);
  const end = parseISOEnd(endISO);

  // Resolve variant scope:
  // - if variantId present -> that one
  // - else if sku -> resolve variantId
  // - else if productId -> all variants of product
  let variantIds = [];

  if (variantId) {
    variantIds = [String(variantId)];
  } else if (sku) {
    const v = await prisma.productVariant?.findFirst?.({
      where: { sku: String(sku) },
      select: { id: true, productId: true },
    });
    if (!v?.id) throw new Error("variantId could not be resolved from DB by sku");
    variantIds = [String(v.id)];
    if (!productId) productId = v.productId || null;
  } else if (productId) {
    const vs = await prisma.productVariant?.findMany?.({
      where: { productId: String(productId) },
      select: { id: true },
    });
    variantIds = (vs || []).map((x) => String(x.id));
  } else {
    throw new Error("Provide productId, variantId, or sku");
  }

  // Fetch order items by variantIds
  const items = await prisma.orderItem.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      variantId: { in: variantIds },
    },
    select: {
      createdAt: true,
      variantId: true,
      sku: true,
      title: true,
      quantity: true,
      unitPrice: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      total: true,
      costChosen: true,
      costSource: true,
    },
  });

  const variantLabelMap = await buildVariantLabelMap(variantIds);

  const groupMap = new Map();

  for (const it of items) {
    const dt = new Date(it.createdAt);
    const gk = groupKey(dt, group);
    const key = gk.key;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        label: gk.label,
        units: 0,
        revenue: 0,
        discounts: 0,
        tax: 0,
        netSales: 0,
        cogs: 0,
        profit: 0,
        costCoverageUnits: 0,
      });
    }
    const g = groupMap.get(key);

    const qty = toInt(it.quantity);
    if (qty <= 0) continue;

    const revenue =
      toNum(it.total) ||
      (toNum(it.unitPrice) ? toNum(it.unitPrice) * qty : 0) ||
      toNum(it.subtotal);

    const discounts = toNum(it.discountTotal);
    const tax = toNum(it.taxTotal);

    // Net sales (DB-derived only; no guessing)
    const netSales = revenue - discounts - tax;

    const costEach = toNum(it.costChosen);
    const cogs = costEach > 0 ? costEach * qty : 0;

    const profit = netSales - cogs;

    g.units += qty;
    g.revenue += revenue;
    g.discounts += discounts;
    g.tax += tax;
    g.netSales += netSales;
    g.cogs += cogs;
    g.profit += profit;
    if (costEach > 0) g.costCoverageUnits += qty;
  }

  const rows = Array.from(groupMap.entries())
    .sort((a, b) => comparePeriodKey(a[0], b[0]))
    .map(([, r]) => ({
      ...r,
      revenue: round2(r.revenue),
      discounts: round2(r.discounts),
      tax: round2(r.tax),
      netSales: round2(r.netSales),
      cogs: round2(r.cogs),
      profit: round2(r.profit),
      margin: percent(r.profit, r.netSales),
      costCoveragePct: r.units ? round2((r.costCoverageUnits / r.units) * 100) : 0,
    }));

  const totals = rows.reduce(
    (t, r) => {
      t.units += r.units;
      t.revenue += r.revenue;
      t.discounts += r.discounts;
      t.tax += r.tax;
      t.netSales += r.netSales;
      t.cogs += r.cogs;
      t.profit += r.profit;
      return t;
    },
    {
      label: "Total",
      units: 0,
      revenue: 0,
      discounts: 0,
      tax: 0,
      netSales: 0,
      cogs: 0,
      profit: 0,
    }
  );

  totals.revenue = round2(totals.revenue);
  totals.discounts = round2(totals.discounts);
  totals.tax = round2(totals.tax);
  totals.netSales = round2(totals.netSales);
  totals.cogs = round2(totals.cogs);
  totals.profit = round2(totals.profit);

  return {
    productId: productId || null,
    variantId: variantId || (variantIds.length === 1 ? variantIds[0] : null),
    sku: sku || null,
    start: startISO,
    end: endISO,
    group,
    variants: variantIds.map((id) => ({
      id,
      label: variantLabelMap.get(id) || id,
    })),
    rows,
    totals: { ...totals, margin: percent(totals.profit, totals.netSales) },
  };
}

/* ===========================
 * INTERNAL: DB-only fetch helpers
 * =========================== */

async function getOrdersWithItemsDBOnly(range, statusFilter) {
  // We intentionally do NOT assume any enum field names beyond common ones.
  // If statusFilter is provided, we best-effort apply it; otherwise just date range.
  const baseWhere = { createdAt: range };

  // Try applying status filter to `status` if it exists; otherwise ignore.
  const tryWhere = [];
  if (Array.isArray(statusFilter) && statusFilter.length) {
    tryWhere.push({ ...baseWhere, status: { in: statusFilter } });
  }
  tryWhere.push(baseWhere);

  for (const where of tryWhere) {
    try {
      return await prisma.order.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          items: {
            select: {
              variantId: true,
              sku: true,
              title: true,
              quantity: true,
              unitPrice: true,
              subtotal: true,
              discountTotal: true,
              taxTotal: true,
              total: true,
              costChosen: true,
              costSource: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });
    } catch {
      // continue
    }
  }

  // Fallback: try `orderItems` key (some schemas use this)
  for (const where of tryWhere) {
    try {
      const rows = await prisma.order.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          orderItems: {
            select: {
              variantId: true,
              sku: true,
              title: true,
              quantity: true,
              unitPrice: true,
              subtotal: true,
              discountTotal: true,
              taxTotal: true,
              total: true,
              costChosen: true,
              costSource: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      // normalize to { items: [...] }
      return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, items: r.orderItems || [] }));
    } catch {
      // continue
    }
  }

  return [];
}

async function resolveVariantFilter(filter) {
  if (!filter) return null;

  // highest priority: variantId
  if (filter.variantId) {
    return { variantIds: new Set([String(filter.variantId)]), sku: filter.sku ? String(filter.sku) : null };
  }

  // sku -> resolve variantId
  if (filter.sku && prisma.productVariant?.findFirst) {
    const v = await prisma.productVariant.findFirst({
      where: { sku: String(filter.sku) },
      select: { id: true },
    });
    if (v?.id) return { variantIds: new Set([String(v.id)]), sku: String(filter.sku) };
    return { variantIds: new Set(), sku: String(filter.sku) };
  }

  // productId -> resolve all variants
  if (filter.productId && prisma.productVariant?.findMany) {
    const vs = await prisma.productVariant.findMany({
      where: { productId: String(filter.productId) },
      select: { id: true },
    });
    return { variantIds: new Set((vs || []).map((x) => String(x.id))), sku: null };
  }

  return null;
}

function matchesResolvedFilter(orderItem, resolved) {
  if (!resolved) return true;
  const vid = orderItem?.variantId ? String(orderItem.variantId) : null;
  if (vid && resolved.variantIds.has(vid)) return true;
  // if user filtered by sku but variant not found in DB, then nothing matches
  return false;
}

async function buildVariantLabelMap(variantIds) {
  const map = new Map();
  if (!variantIds?.length) return map;

  try {
    if (!prisma.productVariant?.findMany) return map;

    const rows = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        sku: true,
        title: true,
        sizeName: true,
        colorName: true,
        product: { select: { id: true, name: true, slug: true } },
      },
    });

    for (const v of rows) {
      const parts = [];
      const pName = v.product?.name || v.product?.slug;
      if (pName) parts.push(pName);
      if (v.colorName) parts.push(v.colorName);
      if (v.sizeName) parts.push(v.sizeName);

      const label =
        parts.filter(Boolean).join(" • ") ||
        v.title ||
        v.sku ||
        String(v.id);

      map.set(String(v.id), label);
    }
  } catch {
    // ignore; labels will fall back to orderItem.title/sku
  }

  return map;
}

/* ===========================
 * INTERNAL: date + grouping helpers
 * =========================== */

function parseISOStart(s) {
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) throw new Error("Invalid start");
  return d;
}

function parseISOEnd(s) {
  const d = new Date(`${s}T23:59:59.999`);
  if (isNaN(d.getTime())) throw new Error("Invalid end");
  return d;
}

function toISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toNum(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toInt(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function round2(x) {
  const v = Number(x);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

function percent(num, den) {
  const n = Number(num),
    d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return round2((n / d) * 100);
}

function ensurePeriod(map, key) {
  if (!map.has(key)) map.set(key, { revenue: 0, cogs: 0, profit: 0, byProduct: new Map() });
  return map.get(key);
}

function keyOfPeriod(d, g) {
  return groupKey(d, g).key;
}

function groupKey(d, g) {
  const dt = new Date(d);
  const Y = dt.getFullYear();
  const M = dt.getMonth() + 1;
  const D = dt.getDate();
  const m2 = String(M).padStart(2, "0");
  const d2 = String(D).padStart(2, "0");

  if (g === "all" || g === "total") return { key: "ALL", label: "Total" };
  if (g === "day") return { key: `${Y}-${m2}-${d2}`, label: `${d2}-${m2}-${Y}` };
  if (g === "month") return { key: `${Y}-${m2}`, label: `${monthShort(M)} ${Y}` };
  if (g === "year") return { key: `${Y}`, label: `${Y}` };
  if (g === "quarter") {
    const q = Math.floor((M - 1) / 3) + 1;
    return { key: `${Y}-Q${q}`, label: `Q${q} ${Y}` };
  }
  if (g === "half") {
    const h = M <= 6 ? 1 : 2;
    return { key: `${Y}-H${h}`, label: `H${h} ${Y}` };
  }
  if (g === "week") {
    const { wy, wk } = isoWeek(dt);
    return { key: `${wy}-W${String(wk).padStart(2, "0")}`, label: `W${wk} ${wy}` };
  }
  return { key: `${Y}-${m2}`, label: `${monthShort(M)} ${Y}` };
}

function monthShort(m) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1] || String(m);
}

function isoWeek(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const wy = tmp.getUTCFullYear();
  const yearStart = new Date(Date.UTC(wy, 0, 1));
  const wk = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  return { wy, wk };
}

function comparePeriodKey(a, b) {
  const A = String(a ?? ""),
    B = String(b ?? "");
  if (A === B) return 0;

  // yyyy-mm-dd
  let mA = /^(\d{4})-(\d{2})-(\d{2})$/.exec(A);
  let mB = /^(\d{4})-(\d{2})-(\d{2})$/.exec(B);
  if (mA && mB) return diff(+mA[1], +mA[2], +mA[3], +mB[1], +mB[2], +mB[3]);

  // yyyy-mm
  mA = /^(\d{4})-(\d{2})$/.exec(A);
  mB = /^(\d{4})-(\d{2})$/.exec(B);
  if (mA && mB) return diff(+mA[1], +mA[2], 0, +mB[1], +mB[2], 0);

  // yyyy-W## / yyyy-Q# / yyyy-H#
  mA = /^(\d{4})-(?:W|Q|H)(\d{1,2})$/.exec(A);
  mB = /^(\d{4})-(?:W|Q|H)(\d{1,2})$/.exec(B);
  if (mA && mB) return diff(+mA[1], +mA[2], 0, +mB[1], +mB[2], 0);

  // yyyy
  mA = /^(\d{4})$/.exec(A);
  mB = /^(\d{4})$/.exec(B);
  if (mA && mB) return +mA[1] - +mB[1];

  return A.localeCompare(B);
}

function diff(y1, x1, z1, y2, x2, z2) {
  if (y1 !== y2) return y1 - y2;
  if (x1 !== x2) return x1 - x2;
  return z1 - z2;
}
