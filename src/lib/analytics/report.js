// FILE: src/lib/analytics/report.js
import { DAY, rangeFromSearchParams } from "./_utils";

import * as OverviewMod from "./overview";
import * as OrdersMod from "./orders";
import * as ProductsMod from "./products";
import * as CustomersMod from "./customers";
import * as OtpMod from "./otp";
import * as ReturnsMod from "./returns";
import * as StaffMod from "./staff";
import * as InventoryMod from "./inventory";
import * as ProjectionsMod from "./projections";

import { computePnl } from "@/lib/analytics/pnl";

// pick an exported function by trying several candidates
function pickFn(mod, names) {
  for (const n of names) {
    if (typeof mod?.[n] === "function") return mod[n];
  }
  return null;
}

export async function buildAnalyticsReport(reqUrl) {
  const { searchParams } = new URL(reqUrl);
  const { tzOffsetMinutes, since, untilExclusive, days, mode } =
    rangeFromSearchParams(searchParams);

  const includeRaw = String(
    searchParams.get("include") || "overview,timeseries"
  ).trim();
  const include = includeRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const group = (searchParams.get("group") || "day").toLowerCase();

  const compare = String(searchParams.get("compare") || "0") === "1";
  const prevSince = new Date(since.getTime() - days * DAY);
  const prevUntilExclusive = new Date(since.getTime());

  const out = {
    meta: {
      tzOffsetMinutes,
      mode,
      days,
      group,
      sinceISO: since.toISOString(),
      untilExclusiveISO: untilExclusive.toISOString(),
      include,
      compare,
    },
    data: {},
  };

  // Resolve function names flexibly (compat across your evolving modules)
  const computeOverview = pickFn(OverviewMod, ["computeOverview"]);
  const computeOrders = pickFn(OrdersMod, ["computeOrders"]);
  const computeProducts = pickFn(ProductsMod, [
    "computeProducts",
    "computeProductsAnalytics",
  ]);
  const computeCustomers = pickFn(CustomersMod, [
    "computeCustomers",
    "computeCustomersAnalytics",
  ]);
  const computeOtp = pickFn(OtpMod, ["computeOtp", "computeOtpAnalytics"]);
  const computeReturns = pickFn(ReturnsMod, [
    "computeReturns",
    "computeReturnsAnalytics",
  ]);
  const computeStaff = pickFn(StaffMod, ["computeStaff", "computeStaffAnalytics"]);
  const computeInventory = pickFn(InventoryMod, [
    "computeInventory",
    "computeInventoryAnalytics",
  ]);
  const computeProjections = pickFn(ProjectionsMod, [
    "computeProjections",
    "computeProjectionsAnalytics",
  ]);

  // Build in dependency order (returns can use paidOrdersCount)
  if (include.includes("overview") && computeOverview) {
    out.data.overview = await computeOverview({
      since,
      untilExclusive,
      days,
      compare,
    });
  }

  if (include.includes("orders") && computeOrders) {
    out.data.orders = await computeOrders({
      since,
      untilExclusive,
      group: group === "day" ? "day" : group,
    });
  }

  if (include.includes("products") && computeProducts) {
    out.data.products = await computeProducts({
      // accept either { since/untilExclusive } or { start/end } patterns
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
      prevSince: compare ? prevSince : null,
      prevUntilExclusive: compare ? prevUntilExclusive : null,
      compareStart: compare ? prevSince : null,
      compareEnd: compare ? prevUntilExclusive : null,
    });
  }

  if (include.includes("customers") && computeCustomers) {
    out.data.customers = await computeCustomers({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
    });
  }

  if (include.includes("otp") && computeOtp) {
    out.data.otp = await computeOtp({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
      group: group === "day" ? "day" : group,
    });
  }

  if (include.includes("returns") && computeReturns) {
    // paidOrdersCount from overview/orders if present
    let paidOrdersCount =
      out.data.overview?.kpis?.paidOrdersCount ??
      out.data.orders?.totals?.paidOrders ??
      null;

    // If not present, ask returns module to compute rate without paidOrdersCount
    // but keep it best-effort: returns module may accept paidOrdersCount or not.
    out.data.returns = await computeReturns({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
      paidOrdersCount,
    });
  }

  if (include.includes("staff") && computeStaff) {
    out.data.staff = await computeStaff({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
    });
  }

  if (include.includes("inventory") && computeInventory) {
    out.data.inventory = await computeInventory({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
    });
  }

  if (include.includes("projections") && computeProjections) {
    out.data.projections = await computeProjections({
      since,
      untilExclusive,
      start: since,
      end: untilExclusive,
    });
  }

  if (include.includes("pnl")) {
    const pnlGroup = (searchParams.get("pnlGroup") || "month").toLowerCase();
    out.data.pnl = await computePnl({
      start: since,
      end: new Date(untilExclusive.getTime() - 1),
      group: pnlGroup,
    });
  }

  // If a requested module isn't available, surface a clear marker for debugging.
  // (Does not break existing consumers that ignore unknown keys.)
  const missing = [];
  if (include.includes("overview") && !computeOverview) missing.push("overview");
  if (include.includes("orders") && !computeOrders) missing.push("orders");
  if (include.includes("products") && !computeProducts) missing.push("products");
  if (include.includes("customers") && !computeCustomers) missing.push("customers");
  if (include.includes("otp") && !computeOtp) missing.push("otp");
  if (include.includes("returns") && !computeReturns) missing.push("returns");
  if (include.includes("staff") && !computeStaff) missing.push("staff");
  if (include.includes("inventory") && !computeInventory) missing.push("inventory");
  if (include.includes("projections") && !computeProjections) missing.push("projections");

  if (missing.length) out.meta.missing = missing;

  return out;
}
