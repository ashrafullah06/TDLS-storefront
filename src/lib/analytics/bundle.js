// FILE: lib/analytics/bundle.js
import * as Overview from "./overview";
import * as Orders from "./orders";
import * as Products from "./products";
import * as Customers from "./customers";
import * as Otp from "./otp";
import * as Returns from "./returns";
import * as Staff from "./staff";
import * as Inventory from "./inventory";
import { computeProjectionsFromSeries } from "./projections";

function pickFn(mod, names) {
  for (const name of names) {
    const fn = mod?.[name];
    if (typeof fn === "function") return fn;
  }
  return null;
}

function ensureDate(d) {
  if (d instanceof Date) return d;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t) : new Date();
}

export async function computeAnalyticsExtras(
  prisma,
  { start, end, filters = {}, series = [] } = {}
) {
  const s = ensureDate(start);
  const e = ensureDate(end);

  const DAY = 24 * 60 * 60 * 1000;
  const spanDays = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / DAY));

  // Compare window: immediately preceding window of equal length
  const compareEnd = new Date(s.getTime());
  const compareStart = new Date(s.getTime() - spanDays * DAY);

  // Resolve function names safely (keeps existing logic intact, avoids import-name crashes)
  const computeOverview =
    pickFn(Overview, ["computeOverview", "computeOverviewAnalytics"]) ||
    (async () => ({ ok: true }));

  const computeOrders =
    pickFn(Orders, ["computeOrdersAnalytics", "computeOrders"]) ||
    (async () => ({ ok: true }));

  const computeProducts =
    pickFn(Products, ["computeProductsAnalytics", "computeProducts"]) ||
    (async () => ({ ok: true }));

  const computeCustomers =
    pickFn(Customers, ["computeCustomersAnalytics", "computeCustomers"]) ||
    (async () => ({ ok: true }));

  const computeOtp =
    pickFn(Otp, ["computeOtpAnalytics", "computeOtp"]) ||
    (async () => ({ ok: true }));

  const computeReturns =
    pickFn(Returns, ["computeReturnsAnalytics", "computeReturns"]) ||
    (async () => ({ ok: true }));

  const computeStaff =
    pickFn(Staff, ["computeStaffAnalytics", "computeStaff"]) ||
    (async () => ({ ok: true }));

  const computeInventory =
    pickFn(Inventory, ["computeInventoryAnalytics", "computeInventory"]) ||
    (async () => ({ ok: true }));

  const [
    overview,
    orders,
    products,
    customers,
    otp,
    returns,
    staff,
    inventory,
  ] = await Promise.all([
    computeOverview(prisma, { start: s, end: e, filters }),
    computeOrders(prisma, { start: s, end: e, filters }),
    computeProducts(prisma, { start: s, end: e, compareStart, compareEnd }),
    computeCustomers(prisma, { start: s, end: e, filters }),
    computeOtp(prisma, { start: s, end: e }),
    computeReturns(prisma, { start: s, end: e }),
    computeStaff(prisma, { start: s, end: e }),
    computeInventory(prisma),
  ]);

  const projections = computeProjectionsFromSeries(series);

  return {
    ok: true,
    overview,
    orders,
    products,
    customers,
    otp,
    returns,
    staff,
    inventory,
    projections,
  };
}
