// PATH: app/api/admin/analytics/bundle.js
import prisma from "@/lib/prisma";
import { resolveTable } from "@/lib/analytics/_sql";

const DAY = 24 * 60 * 60 * 1000;

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

function clampRangeDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 1;
  return Math.max(1, Math.min(365, Math.round(x)));
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toUrl(reqOrUrl) {
  if (typeof reqOrUrl === "string") return new URL(reqOrUrl);
  return new URL(reqOrUrl.url);
}

async function tryImport(paths) {
  let lastErr = null;
  for (const p of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await import(p);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("IMPORT_FAILED");
}

function pickFn(mod, names) {
  for (const name of names) {
    if (typeof mod?.[name] === "function") return mod[name];
  }
  return null;
}

function parseInclude(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const parts = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  if (!parts.length) return null;
  if (parts.includes("all")) return ["all"];

  // aliases (non-breaking, additive)
  const alias = {
    // common UI names
    revenue: "orders",
    sales: "orders",
    kpi: "overview",
    kpis: "overview",
    ts: "timeseries",
    time: "timeseries",
    time_series: "timeseries",
    profitloss: "pnl",
    "p&l": "pnl",
  };

  const normalized = parts.map((p) => alias[p] || p);
  // de-dup while preserving order
  const seen = new Set();
  const out = [];
  for (const p of normalized) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length ? out : null;
}

function parseFilters(searchParams) {
  const f = {};
  const take = (k) => {
    const v = searchParams.get(k);
    if (v == null || v === "") return;

    // Allow comma-separated lists while preserving original string for legacy modules.
    // Modules can optionally interpret arrays if they choose to.
    const s = String(v);
    const list = s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    f[k] = list.length > 1 ? list : s;
  };

  take("status");
  take("paymentStatus");
  take("provider");
  take("audience");
  take("channel");
  take("warehouseId");
  take("productId");
  take("variantId");
  take("staffId");
  take("customerId");

  // additive filters (safe; ignored by modules that don't use them)
  take("currency");
  take("country");
  take("city");
  take("coupon");
  take("campaign");
  take("utmSource");
  take("utmMedium");
  take("utmCampaign");

  return f;
}

async function detectDbCoverage(prismaClient) {
  const models = {
    Order: Boolean(prismaClient?.order),
    OrderItem: Boolean(prismaClient?.orderItem),
    Product: Boolean(prismaClient?.product),
    ProductVariant: Boolean(prismaClient?.productVariant),
    InventoryItem: Boolean(prismaClient?.inventoryItem),
    StockMovement: Boolean(prismaClient?.stockMovement),
    StockReservation: Boolean(prismaClient?.stockReservation),
    Cart: Boolean(prismaClient?.cart),
    CartItem: Boolean(prismaClient?.cartItem),
    OtpCode: Boolean(prismaClient?.otpCode),
    ReturnRequest: Boolean(prismaClient?.returnRequest),
    ReturnLine: Boolean(prismaClient?.returnLine),
    ExchangeRequest: Boolean(prismaClient?.exchangeRequest),
    ExchangeLine: Boolean(prismaClient?.exchangeLine),
    Refund: Boolean(prismaClient?.refund),
    Payment: Boolean(prismaClient?.payment),
    Shipment: Boolean(prismaClient?.shipment),
    User: Boolean(prismaClient?.user),
    LoyaltyAccount: Boolean(prismaClient?.loyaltyAccount),
    LoyaltyTransaction: Boolean(prismaClient?.loyaltyTransaction),
    Review: Boolean(prismaClient?.review),
    LoginAttempt: Boolean(prismaClient?.loginAttempt),
    UserRiskProfile: Boolean(prismaClient?.userRiskProfile),

    // additive probes (safe booleans)
    Notification: Boolean(prismaClient?.notification),
    Coupon: Boolean(prismaClient?.coupon),
    Discount: Boolean(prismaClient?.discount),
    Wallet: Boolean(prismaClient?.wallet),
    WalletTransaction: Boolean(prismaClient?.walletTransaction),
    Address: Boolean(prismaClient?.address),
  };

  const tables = {
    OrderEvent: await resolveTable(prismaClient, ["OrderEvent", "order_events"]).catch(() => null),
    AuditLog: await resolveTable(prismaClient, ["AuditLog", "audit_logs"]).catch(() => null),
    Wishlist: await resolveTable(prismaClient, ["WishlistItem", "wishlist_items", "wishlist"]).catch(
      () => null
    ),
  };

  return { models, tables };
}

const MODULES = [
  {
    key: "timeseries",
    importPaths: ["@/src/lib/analytics/timeseries", "@/lib/analytics/timeseries"],
    fnNames: ["computeTimeseries"],
    callStyle: "ctx",
    summary: "Daily series: orders/revenuePaid/revenueGross/refunds/returns/newCustomers.",
  },
  {
    key: "overview",
    importPaths: ["@/src/lib/analytics/overview", "@/lib/analytics/overview"],
    fnNames: ["computeOverview"],
    callStyle: "ctx",
    summary: "Top tiles + headline KPIs + deltas.",
  },
  {
    key: "orders",
    importPaths: ["@/src/lib/analytics/orders", "@/lib/analytics/orders"],
    fnNames: ["computeOrders", "computeOrdersAnalytics"],
    callStyle: "ctx",
    summary: "Status pipeline, fulfillment, AOV, cohorts.",
  },
  {
    key: "products",
    importPaths: ["@/lib/analytics/products", "@/src/lib/analytics/products"],
    fnNames: ["computeProductsAnalytics", "computeProducts"],
    callStyle: "prisma",
    summary: "Best-selling, trending, velocity deltas.",
  },
  {
    key: "customers",
    importPaths: ["@/lib/analytics/customers", "@/src/lib/analytics/customers"],
    fnNames: ["computeCustomersAnalytics", "computeCustomers"],
    callStyle: "prisma",
    summary: "Account-wise orders/spend, cart value, cohorts, optional wishlist leaders.",
  },
  {
    key: "otp",
    importPaths: ["@/src/lib/analytics/otp", "@/lib/analytics/otp"],
    fnNames: ["computeOtp", "computeOtpAnalytics"],
    callStyle: "ctx",
    summary: "Purpose counts, success rate, resend rate, projections.",
  },
  {
    key: "returns",
    importPaths: ["@/src/lib/analytics/returns", "@/lib/analytics/returns"],
    fnNames: ["computeReturns", "computeReturnsAnalytics"],
    callStyle: "ctx",
    summary: "Returns/exchanges/refunds reasons + rates + top returned variants.",
  },
  {
    key: "staff",
    importPaths: ["@/lib/analytics/staff", "@/src/lib/analytics/staff"],
    fnNames: ["computeStaffAnalytics", "computeStaff"],
    callStyle: "prisma",
    summary: "OrderEvent + AuditLog aggregation (leaders, byType).",
  },
  {
    key: "inventory",
    importPaths: ["@/lib/analytics/inventory", "@/src/lib/analytics/inventory"],
    fnNames: ["computeInventoryAnalytics", "computeInventory"],
    callStyle: "prisma",
    summary: "On-hand/reserved/available, low stock.",
  },
  {
    key: "projections",
    importPaths: ["@/src/lib/analytics/projections", "@/lib/analytics/projections"],
    fnNames: ["computeProjections", "computeProjectionsAnalytics"],
    callStyle: "ctx",
    summary: "Monthly/quarterly/half-year/year forecasts (DB-based).",
  },
  {
    key: "profit",
    importPaths: ["@/lib/analytics/profit", "@/src/lib/analytics/profit"],
    fnNames: ["computeProfit", "computeProfitAnalytics"],
    callStyle: "ctx",
    summary: "Profit-loss by product/variant/batch/time (uses OrderItem.costChosen when present).",
  },
  {
    key: "pnl",
    importPaths: ["@/src/lib/analytics/pnl", "@/lib/analytics/pnl"],
    fnNames: ["computePnl"],
    callStyle: "ctx",
    summary: "P&L totals grouped by period (month/quarter/half/year/total).",
  },
];

function expandInclude(include) {
  const allKeys = MODULES.map((m) => m.key);
  if (!include) return ["overview", "timeseries"];
  if (include.includes("all")) return allKeys;

  const set = new Set(include);
  // stable order per MODULES, prevents UI jitter
  return allKeys.filter((k) => set.has(k));
}

function computeWindow({ daysParam, start, end }) {
  // end is treated as EXCLUSIVE window end.
  const now = new Date();
  let since = start || new Date(now.getTime() - (daysParam - 1) * DAY);
  let untilExclusive = end || null;

  if (start && end) {
    const spanDays = clampRangeDays(Math.ceil((end.getTime() - start.getTime()) / DAY));
    since = start;
    untilExclusive = end;
    return { since, untilExclusive, days: spanDays };
  }

  if (start && !end) {
    untilExclusive = new Date(since.getTime() + daysParam * DAY);
    return { since, untilExclusive, days: daysParam };
  }

  if (!start && end) {
    untilExclusive = end;
    since = new Date(untilExclusive.getTime() - daysParam * DAY);
    return { since, untilExclusive, days: daysParam };
  }

  // neither start nor end
  untilExclusive = new Date(since.getTime() + daysParam * DAY);
  return { since, untilExclusive, days: daysParam };
}

async function computeModule(modDef, ctx, { strict = false } = {}) {
  const t0 = Date.now();

  let mod;
  try {
    mod = await tryImport(modDef.importPaths);
  } catch (e) {
    const out = { ok: false, error: "IMPORT_FAILED", module: modDef.key, message: String(e?.message || e) };
    out.ms = Date.now() - t0;
    if (strict) throw Object.assign(new Error(out.message), { meta: out });
    return out;
  }

  const fn = pickFn(mod, modDef.fnNames);
  if (!fn) {
    const out = { ok: false, error: "MISSING_EXPORT", module: modDef.key };
    out.ms = Date.now() - t0;
    if (strict) throw Object.assign(new Error("MISSING_EXPORT"), { meta: out });
    return out;
  }

  try {
    let res;
    if (modDef.callStyle === "prisma") {
      res = await fn(ctx.prisma, ctx.args);
    } else {
      // Compatibility: ctx-style modules get prisma injected (harmless if unused)
      res = await fn({ prisma: ctx.prisma, ...ctx.args });
    }

    // Preserve module outputs; only add ms if it doesn't already exist
    if (res && typeof res === "object" && res.ms == null) res.ms = Date.now() - t0;
    return res;
  } catch (e) {
    const out = {
      ok: false,
      error: "MODULE_FAILED",
      module: modDef.key,
      message: String(e?.message || e),
      ms: Date.now() - t0,
    };
    if (strict) throw Object.assign(new Error(out.message), { meta: out });
    return out;
  }
}

export async function buildAdminAnalyticsBundle(reqOrUrl) {
  const tBundle0 = Date.now();

  const url = toUrl(reqOrUrl);
  const { searchParams } = url;

  const daysParam = clampDays(searchParams.get("days"));
  const start = parseDate(searchParams.get("start"));
  const end = parseDate(searchParams.get("end"));

  const win = computeWindow({ daysParam, start, end });
  const since = win.since;
  const untilExclusive = win.untilExclusive;
  const days = win.days;

  const group = (searchParams.get("group") || "day").toLowerCase();
  const tzOffsetMinutes = n(searchParams.get("tzOffsetMinutes"), 360);
  const compare = String(searchParams.get("compare") || "0") === "1";

  const includeRaw = parseInclude(searchParams.get("include"));
  const include = expandInclude(includeRaw);

  const filters = parseFilters(searchParams);

  // Controls (additive; ignored by callers if unused)
  const parallel = String(searchParams.get("parallel") || "0") === "1";
  const strict = String(searchParams.get("strict") || "0") === "1";

  const args = {
    // ctx-style modules
    since,
    untilExclusive,
    days,
    group,
    compare,
    tzOffsetMinutes,

    // prisma-arg modules
    start: since,
    end: untilExclusive,
    filters,

    // profit/pnl specifics
    dimension: (searchParams.get("dimension") || "product").toLowerCase(),
    paidOnly: String(searchParams.get("paidOnly") || "1") !== "0",
    refundAttribution: (searchParams.get("refundAttribution") || "refund_date").toLowerCase(),
    limit: n(searchParams.get("limit"), 200),
    pnlGroup: (searchParams.get("pnlGroup") || "month").toLowerCase(),

    // extra knobs (additive)
    currency: searchParams.get("currency") || null,
    locale: searchParams.get("locale") || null,
  };

  const dbCoverage = await detectDbCoverage(prisma);

  const apiSummary = {
    base: "/api/admin/analytics",
    include,
    params: {
      days: "7..365 (default 30)",
      start: "ISO date (optional)",
      end: "ISO date (optional, treated as exclusive window end)",
      include: "comma-separated module keys, aliases allowed, or 'all'",
      group: "day|week|month|quarter|half|year|total (module-dependent)",
      compare: "0|1 (some modules support prev window deltas)",
      tzOffsetMinutes: "client timezone offset minutes (default 360)",
      parallel: "0|1 (compute modules in parallel; default 0)",
      strict: "0|1 (fail bundle if any requested module fails; default 0)",
      filters:
        "status,paymentStatus,provider,audience,channel,warehouseId,productId,variantId,staffId,customerId (+optional: currency,country,city,coupon,campaign,utmSource,utmMedium,utmCampaign)",
      profit: "dimension=product|variant|batch, paidOnly=0|1, refundAttribution=refund_date|sale_date, limit",
      pnl: "pnlGroup=week|month|quarter|half|year|total",
    },
    exports: {
      pdf: "/api/admin/analytics/export/pdf",
      xlsx: "/api/admin/analytics/export/xlsx",
      docx: "/api/admin/analytics/export/docx",
    },
    modules: MODULES.reduce((acc, m) => {
      acc[m.key] = { key: m.key, summary: m.summary };
      return acc;
    }, {}),
  };

  const ctx = { prisma, args };

  const data = {};
  const moduleMeta = {};

  if (parallel) {
    // Parallel compute (optional) — does not change output shape
    const tasks = include.map(async (k) => {
      const def = MODULES.find((m) => m.key === k);
      if (!def) return { key: k, value: { ok: false, error: "UNKNOWN_MODULE", module: k } };

      const value = await computeModule(def, ctx, { strict });
      return { key: k, value };
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      data[r.key] = r.value;
      if (r?.value?.ms != null) moduleMeta[r.key] = { ms: r.value.ms };
    }
  } else {
    // Default: sequential (safer DB load)
    for (const k of include) {
      const def = MODULES.find((m) => m.key === k);
      if (!def) {
        data[k] = { ok: false, error: "UNKNOWN_MODULE", module: k };
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const value = await computeModule(def, ctx, { strict });
      data[k] = value;
      if (value?.ms != null) moduleMeta[k] = { ms: value.ms };
    }
  }

  // Cross-module enrich (non-breaking; only applied when both exist)
  if (data?.returns && data?.returns?.ok !== false) {
    const paidOrdersCount =
      data?.overview?.kpis?.paidOrdersCount ?? data?.orders?.totals?.paidOrders ?? null;

    if (paidOrdersCount != null) {
      data.returns.paidOrdersCount = paidOrdersCount;
    }
  }

  const tBundle1 = Date.now();

  return {
    ok: true,
    meta: {
      generatedAt: new Date().toISOString(),
      range: {
        sinceISO: since.toISOString(),
        untilExclusiveISO: untilExclusive.toISOString(),
        days,
        group,
        compare,
        tzOffsetMinutes,
        include,
      },
      filters,
      dbCoverage,
      apiSummary,
      perf: {
        bundleMs: tBundle1 - tBundle0,
        modules: moduleMeta,
        mode: parallel ? "parallel" : "sequential",
        strict,
      },
    },
    data,
  };
}
