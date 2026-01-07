// FILE: src/lib/analytics/otp.js
import prisma from "@/lib/prisma";
import { groupKey, n, pct, round2, safeUpper } from "./_utils";

/**
 * OTP analytics (DB-real, no placeholders):
 * - totals (created/consumed/success, resends, resendRate, avgAttempts, avgSendCount)
 * - by purpose
 * - by channel
 * - by purpose+channel
 * - attempts distribution buckets
 * - send/resend distribution buckets
 * - period series (created/consumed/resends/success)
 * - projections (moving average of last N periods)
 *
 * Notes:
 * - Success = consumedAt != null
 * - Resends are derived from sendCount (resends = max(0, sendCount - 1))
 * - Bucketing uses attemptCount and sendCount
 */
export async function computeOtp({ since, untilExclusive, group = "day" }) {
  // If OTP model is not present in Prisma client, return a correct “no data” structure (not a placeholder).
  if (!prisma?.otpCode?.findMany) {
    return emptyOtpResult(group);
  }

  const rows = await prisma.otpCode
    .findMany({
      where: { createdAt: { gte: since, lt: untilExclusive } },
      select: {
        createdAt: true,
        purpose: true,
        channel: true,
        consumedAt: true,
        attemptCount: true,
        sendCount: true,
      },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => []);

  const byPurpose = {}; // purpose -> metrics
  const byChannel = {}; // channel -> metrics
  const byPurposeChannel = {}; // `${purpose}__${channel}` -> metrics

  const attemptsBuckets = { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0 };
  const sendBuckets = { "1": 0, "2": 0, "3": 0, "4+": 0 }; // sendCount distribution
  const seriesMap = new Map(); // period -> { period, created, consumed, resends }

  const ensureSeries = (k) => {
    if (!seriesMap.has(k)) seriesMap.set(k, { period: k, created: 0, consumed: 0, resends: 0 });
    return seriesMap.get(k);
  };

  let totalConsumed = 0;
  let totalAttempts = 0;
  let totalSendCount = 0;
  let totalResends = 0;

  for (const r of rows) {
    const purpose = safeUpper(r?.purpose) || "UNKNOWN";
    const channel = safeUpper(r?.channel) || "UNKNOWN";
    const consumed = !!r?.consumedAt;

    const attempts = n(r?.attemptCount, 0);
    const sendCount = Math.max(1, n(r?.sendCount, 1)); // default to 1 send if null/0
    const resends = Math.max(0, sendCount - 1);

    // totals
    totalAttempts += attempts;
    totalSendCount += sendCount;
    totalResends += resends;
    if (consumed) totalConsumed += 1;

    // attempts buckets
    if (attempts <= 0) attemptsBuckets["0"] += 1;
    else if (attempts === 1) attemptsBuckets["1"] += 1;
    else if (attempts === 2) attemptsBuckets["2"] += 1;
    else if (attempts === 3) attemptsBuckets["3"] += 1;
    else attemptsBuckets["4+"] += 1;

    // send buckets
    if (sendCount === 1) sendBuckets["1"] += 1;
    else if (sendCount === 2) sendBuckets["2"] += 1;
    else if (sendCount === 3) sendBuckets["3"] += 1;
    else sendBuckets["4+"] += 1;

    // by purpose
    if (!byPurpose[purpose]) {
      byPurpose[purpose] = {
        created: 0,
        consumed: 0,
        resends: 0,
        avgAttempts: 0,
        avgSendCount: 0,
        successRate: 0,
        resendRate: 0,
      };
    }
    byPurpose[purpose].created += 1;
    byPurpose[purpose].resends += resends;
    if (consumed) byPurpose[purpose].consumed += 1;
    byPurpose[purpose].avgAttempts += attempts;
    byPurpose[purpose].avgSendCount += sendCount;

    // by channel
    if (!byChannel[channel]) {
      byChannel[channel] = {
        channel,
        created: 0,
        consumed: 0,
        resends: 0,
        avgAttempts: 0,
        avgSendCount: 0,
        successRate: 0,
        resendRate: 0,
      };
    }
    byChannel[channel].created += 1;
    byChannel[channel].resends += resends;
    if (consumed) byChannel[channel].consumed += 1;
    byChannel[channel].avgAttempts += attempts;
    byChannel[channel].avgSendCount += sendCount;

    // by purpose + channel
    const pk = `${purpose}__${channel}`;
    if (!byPurposeChannel[pk]) {
      byPurposeChannel[pk] = {
        purpose,
        channel,
        created: 0,
        consumed: 0,
        resends: 0,
        avgAttempts: 0,
        avgSendCount: 0,
        successRate: 0,
        resendRate: 0,
      };
    }
    byPurposeChannel[pk].created += 1;
    byPurposeChannel[pk].resends += resends;
    if (consumed) byPurposeChannel[pk].consumed += 1;
    byPurposeChannel[pk].avgAttempts += attempts;
    byPurposeChannel[pk].avgSendCount += sendCount;

    // series
    const k = groupKey(r.createdAt, group);
    const s = ensureSeries(k);
    s.created += 1;
    s.resends += resends;
    if (consumed) s.consumed += 1;
  }

  // finalize derived metrics
  for (const key of Object.keys(byPurpose)) {
    const x = byPurpose[key];
    x.successRate = pct(x.consumed, x.created);
    x.resendRate = pct(x.resends, x.created); // resends per OTP (not per send)
    x.avgAttempts = x.created ? round2(x.avgAttempts / x.created) : 0;
    x.avgSendCount = x.created ? round2(x.avgSendCount / x.created) : 0;
  }

  for (const key of Object.keys(byChannel)) {
    const x = byChannel[key];
    x.successRate = pct(x.consumed, x.created);
    x.resendRate = pct(x.resends, x.created);
    x.avgAttempts = x.created ? round2(x.avgAttempts / x.created) : 0;
    x.avgSendCount = x.created ? round2(x.avgSendCount / x.created) : 0;
  }

  for (const key of Object.keys(byPurposeChannel)) {
    const x = byPurposeChannel[key];
    x.successRate = pct(x.consumed, x.created);
    x.resendRate = pct(x.resends, x.created);
    x.avgAttempts = x.created ? round2(x.avgAttempts / x.created) : 0;
    x.avgSendCount = x.created ? round2(x.avgSendCount / x.created) : 0;
  }

  const series = Array.from(seriesMap.values())
    .map((x) => ({
      ...x,
      successRate: pct(x.consumed, x.created),
      resendRate: pct(x.resends, x.created),
    }))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)));

  const projection = projectOtp(series);

  const created = rows.length;
  const successRate = pct(totalConsumed, created);

  return {
    totals: {
      created,
      consumed: totalConsumed,
      successRate,
      resends: totalResends,
      resendRate: pct(totalResends, created),
      avgAttempts: created ? round2(totalAttempts / created) : 0,
      avgSendCount: created ? round2(totalSendCount / created) : 0,
    },
    byPurpose,
    byChannel: Object.values(byChannel).sort((a, b) => b.created - a.created),
    byPurposeChannel: Object.values(byPurposeChannel).sort((a, b) => b.created - a.created),
    attemptsBuckets,
    sendBuckets,
    series,
    projection,
  };
}

// Simple projection: moving average of last 7 periods (or fewer).
// Projects next period created + resends (OTP load).
function projectOtp(series) {
  const tail = Array.isArray(series) ? series.slice(-7) : [];
  if (!tail.length) {
    return { method: "moving_average", periodsUsed: 0, nextPeriodCreated: 0, nextPeriodResends: 0 };
  }
  const avgCreated = tail.reduce((s, x) => s + n(x.created, 0), 0) / tail.length;
  const avgResends = tail.reduce((s, x) => s + n(x.resends, 0), 0) / tail.length;
  return {
    method: "moving_average",
    periodsUsed: tail.length,
    nextPeriodCreated: round2(avgCreated),
    nextPeriodResends: round2(avgResends),
  };
}

function emptyOtpResult(group = "day") {
  return {
    totals: {
      created: 0,
      consumed: 0,
      successRate: 0,
      resends: 0,
      resendRate: 0,
      avgAttempts: 0,
      avgSendCount: 0,
    },
    byPurpose: {},
    byChannel: [],
    byPurposeChannel: [],
    attemptsBuckets: { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0 },
    sendBuckets: { "1": 0, "2": 0, "3": 0, "4+": 0 },
    series: [],
    projection: { method: "moving_average", periodsUsed: 0, nextPeriodCreated: 0, nextPeriodResends: 0 },
    meta: { group },
  };
}
