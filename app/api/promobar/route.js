// app/api/promobar/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Accept either REST or GraphQL token envs
const STRAPI_URL = (
  process.env.STRAPI_URL ||
  process.env.NEXT_PUBLIC_STRAPI_API_URL ||
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  "http://127.0.0.1:1337"
).replace(/\/+$/, "");

const STRAPI_TOKEN =
  process.env.STRAPI_API_TOKEN || process.env.STRAPI_GRAPHQL_TOKEN || "";

const HEADERS = STRAPI_TOKEN
  ? { Authorization: `Bearer ${STRAPI_TOKEN}`, Accept: "application/json" }
  : { Accept: "application/json" };

// Preferred single-type + collection
const CFG = "/api/promobar-config?populate=*";
const MSG =
  "/api/promobar-messages?pagination[pageSize]=50&sort=order:asc&filters[enabled][$eq]=true";

// Fallbacks for legacy shapes
const CFG_FALLBACK = "/api/promobar?populate=*";
const MSG_FALLBACK =
  "/api/promobars?pagination[pageSize]=50&sort=updatedAt:desc&populate=*";

async function safeJson(url) {
  try {
    const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function pickAttr(obj, keys, fallback) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fallback;
}
function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function inWindow(start, end, now = new Date()) {
  const s = toDate(start);
  const e = toDate(end);
  if (s && now < s) return false;
  if (e && now > e) return false;
  return true;
}

function normalizeConfig(raw) {
  const a = raw?.data?.attributes || raw?.attributes || raw || {};
  return {
    enabled: !!pickAttr(a, ["enabled", "is_enabled", "isEnabled", "active"], true),
    bg: pickAttr(a, ["background_color", "bg_color", "bg", "backgroundColor"], "#0A0F1F"),
    fg: pickAttr(a, ["text_color", "fg_color", "fg", "color"], "#FFFFFF"),
    closable: !!pickAttr(a, ["closable", "closeable", "dismissible"], false),
    speed: Number(pickAttr(a, ["speed_px_per_sec", "speed", "px_per_sec"], 60)),
    gapMs: Number(pickAttr(a, ["gap_ms", "gap", "pause_ms"], 400)),
    dwellMs: Number(pickAttr(a, ["dwell_ms", "dwell", "message_dwell_ms"], 0)),
    animation: String(pickAttr(a, ["animation", "animation_style", "style"], "marquee")).toLowerCase(),
    startsAt: pickAttr(a, ["starts_at", "startsAt", "start_at", "startAt", "start_datetime"], null),
    endsAt: pickAttr(a, ["ends_at", "endsAt", "end_at", "endAt", "end_datetime"], null),
    dismissId: pickAttr(a, ["dismiss_id", "dismissId", "version"], null),
    singleMessage: String(pickAttr(a, ["message", "title", "text"], "") || "").trim(),
    singleLink: pickAttr(a, ["link", "url", "href", "linkUrl"], null),
  };
}

function normalizeMessages(raw) {
  const out = [];
  const arr = Array.isArray(raw?.data) ? raw.data : [];
  const now = new Date();
  for (const row of arr) {
    const a = row?.attributes || {};
    const enabled = !!pickAttr(a, ["enabled", "is_enabled", "isEnabled", "active"], true);
    if (!enabled) continue;
    const message = String(pickAttr(a, ["message", "title", "text"], "") || "").trim();
    if (!message) continue;
    const link = pickAttr(a, ["link", "url", "href", "linkUrl"], null);
    const startsAt = pickAttr(a, ["starts_at", "startsAt", "start_at", "startAt"], null);
    const endsAt = pickAttr(a, ["ends_at", "endsAt", "end_at", "endAt"], null);
    if (!inWindow(startsAt, endsAt, now)) continue;

    const animation = String(pickAttr(a, ["animation", "style", "anim"], "") || "")
      .trim()
      .toLowerCase();

    out.push({
      id: String(row.id ?? message).slice(0, 64),
      message,
      link,
      animation: animation || undefined,
    });
  }
  return out;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

export async function GET() {
  if (!STRAPI_URL) return new Response(null, { status: 204 });

  const [cfg1, msgs1] = await Promise.all([
    safeJson(`${STRAPI_URL}${CFG}`),
    safeJson(`${STRAPI_URL}${MSG}`),
  ]);
  const cfgRaw = cfg1?.data ? cfg1 : await safeJson(`${STRAPI_URL}${CFG_FALLBACK}`);
  const msgsRaw = msgs1?.data ? msgs1 : await safeJson(`${STRAPI_URL}${MSG_FALLBACK}`);

  if (!cfgRaw?.data) {
    return new Response(null, { status: 204, headers: { "cache-control": "private, max-age=30" } });
  }

  const cfg = normalizeConfig(cfgRaw);
  if (!cfg.enabled || !inWindow(cfg.startsAt, cfg.endsAt)) {
    return new Response(null, { status: 204, headers: { "cache-control": "private, max-age=30" } });
  }

  let messages = normalizeMessages(msgsRaw);
  if (!messages.length && cfg.singleMessage) {
    messages = [{ id: "single", message: cfg.singleMessage, link: cfg.singleLink }];
  }
  if (!messages.length) {
    return new Response(null, { status: 204, headers: { "cache-control": "private, max-age=30" } });
  }

  const dismissId =
    cfg.dismissId ||
    hashStr(
      JSON.stringify(messages.map((m) => m.message)).slice(0, 4096) +
      (cfg.startsAt || "") + (cfg.endsAt || "")
    );

  return new Response(
    JSON.stringify({
      enabled: true,
      bg: cfg.bg,
      fg: cfg.fg,
      closable: cfg.closable,
      speed: cfg.speed,
      gapMs: cfg.gapMs,
      dwellMs: cfg.dwellMs || 0,
      animation: cfg.animation || "marquee",
      startsAt: cfg.startsAt || null,
      endsAt: cfg.endsAt || null,
      dismissId,
      messages,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "private, max-age=30, stale-while-revalidate=300",
      },
    }
  );
}
