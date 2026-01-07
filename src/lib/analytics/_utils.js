// FILE: src/lib/analytics/_utils.js
import { Prisma } from "@prisma/client";

export const DAY = 24 * 60 * 60 * 1000;

// Paid-ish statuses across gateways (kept aligned with your admin routes)
export const PAID_STATUSES = new Set([
  "PAID",
  "SETTLED",
  "CAPTURED",
  "SUCCEEDED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);

export function safeUpper(v) {
  return String(v ?? "").trim().toUpperCase();
}

export function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

export function clampDays(d) {
  const x = Number(d);
  if (!Number.isFinite(x) || x <= 0) return 30;
  return Math.max(7, Math.min(365, Math.round(x)));
}

export function clampTzOffsetMinutes(v, fallback = 360) {
  const x = Number(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(-720, Math.min(840, Math.round(x)));
}

export function money(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  if (typeof v === "object" && typeof v.toNumber === "function") {
    try {
      const x = v.toNumber();
      return Number.isFinite(x) ? x : 0;
    } catch {}
  }
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function round2(x) {
  return Math.round((Number(x) + Number.EPSILON) * 100) / 100;
}

export function dayKeyFromOffset(dt, tzOffsetMinutes) {
  const ms = new Date(dt).getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function startOfLocalDayUtc(now, tzOffsetMinutes) {
  const ms = now.getTime();
  const shifted = ms + tzOffsetMinutes * 60 * 1000;
  const d = new Date(shifted);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - tzOffsetMinutes * 60 * 1000);
}

export function parseYYYYMMDDLocal(s, tzOffsetMinutes) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const yy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  const utcMidnight = Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0);
  return new Date(utcMidnight - tzOffsetMinutes * 60 * 1000);
}

export function parseDateAny(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Range rules:
 * - If start+end provided: treat YYYY-MM-DD as local dates; inclusive end.
 * - Else: use days back from *today local midnight* for stable daily charts.
 */
export function rangeFromSearchParams(searchParams) {
  const tzOffsetMinutes = clampTzOffsetMinutes(searchParams.get("tzOffsetMinutes"), 360);

  const startRaw = searchParams.get("start");
  const endRaw = searchParams.get("end");

  const start = parseYYYYMMDDLocal(startRaw, tzOffsetMinutes) || parseDateAny(startRaw);
  const endLocalStart = parseYYYYMMDDLocal(endRaw, tzOffsetMinutes) || parseDateAny(endRaw);

  if (start && endLocalStart) {
    const untilExclusive = new Date(endLocalStart.getTime() + DAY);
    const days = Math.max(1, Math.min(365, Math.round((untilExclusive - start) / DAY)));
    return { tzOffsetMinutes, since: start, untilExclusive, days, mode: "range" };
  }

  const days = clampDays(searchParams.get("days"));
  const now = new Date();
  const todayLocalStartUtc = startOfLocalDayUtc(now, tzOffsetMinutes);
  const since = new Date(todayLocalStartUtc.getTime() - (days - 1) * DAY);
  const untilExclusive = new Date(todayLocalStartUtc.getTime() + DAY);
  return { tzOffsetMinutes, since, untilExclusive, days, mode: "rolling" };
}

export function groupKey(dt, group = "day") {
  const d = new Date(dt);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();

  const m2 = String(M).padStart(2, "0");
  const d2 = String(D).padStart(2, "0");

  if (group === "day") return `${Y}-${m2}-${d2}`;
  if (group === "month") return `${Y}-${m2}`;
  if (group === "year") return `${Y}`;

  if (group === "quarter") {
    const q = Math.floor((M - 1) / 3) + 1;
    return `${Y}-Q${q}`;
  }
  if (group === "half") {
    const h = M <= 6 ? 1 : 2;
    return `${Y}-H${h}`;
  }
  if (group === "week") {
    const { wy, wk } = isoWeek(d);
    return `${wy}-W${String(wk).padStart(2, "0")}`;
  }
  return `${Y}-${m2}-${d2}`;
}

function isoWeek(d) {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const wy = tmp.getUTCFullYear();
  const yearStart = new Date(Date.UTC(wy, 0, 1));
  const wk = Math.ceil(((tmp - yearStart) / DAY + 1) / 7);
  return { wy, wk };
}

export async function safeGroupBy(model, args, fallback = []) {
  try {
    if (!model?.groupBy) return fallback;
    return await model.groupBy(args);
  } catch {
    return fallback;
  }
}

export async function safeAggregate(model, args, fallback = null) {
  try {
    if (!model?.aggregate) return fallback;
    return await model.aggregate(args);
  } catch {
    return fallback;
  }
}

export function enumContains(enumObj, value) {
  if (!enumObj) return false;
  const vals = Object.values(enumObj);
  return vals.map((v) => String(v).toUpperCase()).includes(String(value).toUpperCase());
}

export function normalizeBreakdown(rows, keyName) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r?.[keyName] ?? "UNKNOWN");
    out[k] = n(r?._count?._all, 0);
  }
  return out;
}

export function pct(num, den) {
  const a = n(num, 0);
  const b = n(den, 0);
  if (b <= 0) return 0;
  return Math.round((a / b) * 1000) / 10;
}
