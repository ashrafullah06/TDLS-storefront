// FILE: app/api/admin/settings/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { auth } from "@/auth"; // NextAuth v5 helper in your repo
import prisma from "@/lib/prisma";

/* ───────────────────────────── helpers ───────────────────────────── */

function isAdmin(session) {
  const r = session?.user?.role || session?.user?.roles?.[0];
  return r === "admin" || r === "superadmin";
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) => (typeof v === "boolean" ? v : d);
const str = (v, d = "") => (typeof v === "string" ? v : d);

function json(body, status = 200, headers = {}) {
  return new NextResponse(body === undefined ? "null" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/* ───────────────────────────── defaults ───────────────────────────── */

const DEFAULT_SHIPPING = {
  inside_dhaka: 70,
  outside_dhaka: 120,
  remote_zone: 180,
  free_threshold: 1999,
  cod: { enabled: true, base_fee: 20, by_zone: {} },
  reship: { default_fee: 120, waive_on: "COURIER_MISTAKE" },
  auto_zone_by_postcode: true,
  zones: [
    { code: "INSIDE_DHAKA", fee: 70, postcodes: [] },
    { code: "OUTSIDE_DHAKA", fee: 120, postcodes: [] },
    { code: "REMOTE", fee: 180, postcodes: [] },
  ],
  weight_tiers: [
    { maxKg: 1, inside: 70, outside: 120, remote: 180 },
    { maxKg: 3, inside: 90, outside: 150, remote: 200 },
    { maxKg: null, inside: 120, outside: 200, remote: 250 },
  ],
  courier_rules: [
    { zone: "INSIDE_DHAKA", service: "DEFAULT-STD", etaDays: 2 },
    { zone: "OUTSIDE_DHAKA", service: "DEFAULT-STD", etaDays: 3 },
    { zone: "REMOTE", service: "DEFAULT-STD", etaDays: 5 },
  ],
  fallback_service: "DEFAULT-STD",
  free_shipping_rules: [{ kind: "MIN_AMOUNT", amount: 1999 }],
  flags: { progressive_discounts: false, beta_zone_matcher: false },
};

const DEFAULT_TAX = {
  vat: { pct: 15, pricing_mode: "INCLUSIVE" }, // INCLUSIVE | EXCLUSIVE
  tax_classes: [{ id: "DEFAULT", pct: 15 }],
  rounding: { method: "HALF_UP", decimals: 2 },
  invoice: { show_tax_breakdown: true, show_inclusive_note: true },
};

const DEFAULT_SETTINGS = {
  currency: "BDT",
  shipping: DEFAULT_SHIPPING,
  tax: DEFAULT_TAX,
  effective_from: () => new Date().toISOString(),
  _version: 1,
};

/* ─────────────────────── validation (no external deps) ─────────────────────── */

function asArray(v, d = []) {
  return Array.isArray(v) ? v : d;
}
function isNonNeg(n) {
  return Number.isFinite(n) && n >= 0;
}
function isPosInt(n) {
  return Number.isInteger(n) && n > 0;
}
function isPct(n) {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function validateZone(z) {
  if (!z || typeof z !== "object") throw new Error("zone must be an object");
  if (!z.code || typeof z.code !== "string") throw new Error("zone.code is required");
  if (!isNonNeg(Number(z.fee))) throw new Error(`zone.fee must be non-negative: ${z.code}`);
  if (z.postcodes != null && !Array.isArray(z.postcodes)) throw new Error("zone.postcodes must be an array");
}

function validateWeightTier(t) {
  if (!t || typeof t !== "object") throw new Error("weight tier must be an object");
  if (t.maxKg != null && !(Number.isFinite(Number(t.maxKg)) && Number(t.maxKg) > 0))
    throw new Error("weight_tiers.maxKg must be positive or null");
  ["inside", "outside", "remote"].forEach((k) => {
    if (!isNonNeg(Number(t[k]))) throw new Error(`weight_tiers.${k} must be non-negative`);
  });
}

function validateCourierRule(r) {
  if (!r || typeof r !== "object") throw new Error("courier rule must be an object");
  if (!r.zone || !r.service) throw new Error("courier_rules require zone and service");
  if (!isPosInt(Number(r.etaDays))) throw new Error("courier_rules.etaDays must be a positive integer");
}

function validateFreeRule(fr) {
  if (!fr || typeof fr !== "object") throw new Error("free_shipping_rules item must be an object");
  if (!fr.kind) throw new Error("free_shipping_rules.kind is required");
  if (fr.kind === "MIN_AMOUNT" && !isNonNeg(Number(fr.amount))) throw new Error("MIN_AMOUNT.amount must be non-negative");
  if (fr.kind === "MIN_ITEMS" && !isPosInt(Number(fr.count))) throw new Error("MIN_ITEMS.count must be positive integer");
  if (fr.kind === "TIER" && (!Array.isArray(fr.tiers) || fr.tiers.length === 0))
    throw new Error("TIER.tiers must be a non-empty array");
  if (!["MIN_AMOUNT", "MIN_ITEMS", "TIER"].includes(fr.kind))
    throw new Error("free_shipping_rules.kind must be one of MIN_AMOUNT | MIN_ITEMS | TIER");
}

function validateShipping(s) {
  if (!s || typeof s !== "object") throw new Error("shipping must be an object");
  ["inside_dhaka", "outside_dhaka", "remote_zone", "free_threshold"].forEach((k) => {
    if (!isNonNeg(Number(s[k]))) throw new Error(`shipping.${k} must be non-negative`);
  });
  if (!s.cod || typeof s.cod !== "object") throw new Error("shipping.cod is required");
  if (typeof s.cod.enabled !== "boolean") throw new Error("shipping.cod.enabled must be boolean");
  if (!isNonNeg(Number(s.cod.base_fee))) throw new Error("shipping.cod.base_fee must be non-negative");
  if (s.cod.by_zone != null && typeof s.cod.by_zone !== "object") throw new Error("shipping.cod.by_zone must be an object");
  if (typeof s.auto_zone_by_postcode !== "boolean")
    throw new Error("shipping.auto_zone_by_postcode must be boolean");
  if (!s.fallback_service || typeof s.fallback_service !== "string")
    throw new Error("shipping.fallback_service is required");

  const zones = asArray(s.zones);
  zones.forEach(validateZone);

  const tiers = asArray(s.weight_tiers);
  tiers.forEach(validateWeightTier);

  const crules = asArray(s.courier_rules);
  crules.forEach(validateCourierRule);

  const frees = asArray(s.free_shipping_rules);
  frees.forEach(validateFreeRule);
}

function validateTax(t) {
  if (!t || typeof t !== "object") throw new Error("tax must be an object");
  if (!t.vat || typeof t.vat !== "object") throw new Error("tax.vat is required");
  if (!isPct(Number(t.vat.pct))) throw new Error("tax.vat.pct must be within 0–100");
  if (!["INCLUSIVE", "EXCLUSIVE"].includes(t.vat.pricing_mode))
    throw new Error('tax.vat.pricing_mode must be "INCLUSIVE" or "EXCLUSIVE"');

  const classes = asArray(t.tax_classes);
  classes.forEach((c) => {
    if (!c || typeof c !== "object") throw new Error("tax.tax_classes[] must be objects");
    if (!c.id || typeof c.id !== "string") throw new Error("tax.tax_classes[].id is required");
    if (!isPct(Number(c.pct))) throw new Error("tax.tax_classes[].pct must be within 0–100");
  });

  if (!t.rounding || typeof t.rounding !== "object") throw new Error("tax.rounding is required");
  if (!["HALF_UP", "HALF_DOWN", "BANKERS"].includes(t.rounding.method || "HALF_UP"))
    throw new Error('tax.rounding.method must be "HALF_UP" | "HALF_DOWN" | "BANKERS"');
  const dec = Number(t.rounding.decimals ?? 2);
  if (!(Number.isInteger(dec) && dec >= 0 && dec <= 4))
    throw new Error("tax.rounding.decimals must be an integer between 0 and 4");

  if (!t.invoice || typeof t.invoice !== "object") throw new Error("tax.invoice is required");
  if (typeof t.invoice.show_tax_breakdown !== "boolean")
    throw new Error("tax.invoice.show_tax_breakdown must be boolean");
  if (typeof t.invoice.show_inclusive_note !== "boolean")
    throw new Error("tax.invoice.show_inclusive_note must be boolean");
}

function validateSettings(s) {
  if (!s || typeof s !== "object") throw new Error("settings must be an object");
  if (!s.currency || typeof s.currency !== "string") throw new Error("currency is required");
  validateShipping(s.shipping);
  validateTax(s.tax);
  if (!s.effective_from || !Number.isFinite(Date.parse(s.effective_from)))
    throw new Error("effective_from must be an ISO datetime string");
  if (!Number.isInteger(Number(s._version)) || Number(s._version) < 1)
    throw new Error("_version must be integer >= 1");
}

/* ────────────────────────── normalization ────────────────────────── */

function mergeDeep(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch ?? base;
  if (typeof base === "object" && typeof patch === "object" && base && patch) {
    const out = { ...base };
    for (const k of Object.keys(patch)) out[k] = mergeDeep(base[k], patch[k]);
    return out;
  }
  return patch ?? base;
}

function normalizeSettings(dbValue) {
  const merged = mergeDeep(
    {
      currency: DEFAULT_SETTINGS.currency,
      shipping: DEFAULT_SHIPPING,
      tax: DEFAULT_TAX,
      effective_from: DEFAULT_SETTINGS.effective_from(),
      _version: DEFAULT_SETTINGS._version,
    },
    dbValue || {}
  );

  merged.shipping.inside_dhaka = num(merged.shipping.inside_dhaka, DEFAULT_SHIPPING.inside_dhaka);
  merged.shipping.outside_dhaka = num(merged.shipping.outside_dhaka, DEFAULT_SHIPPING.outside_dhaka);
  merged.shipping.remote_zone = num(merged.shipping.remote_zone, DEFAULT_SHIPPING.remote_zone);
  merged.shipping.free_threshold = num(merged.shipping.free_threshold, DEFAULT_SHIPPING.free_threshold);
  merged.shipping.cod.enabled = bool(merged.shipping.cod.enabled, DEFAULT_SHIPPING.cod.enabled);
  merged.shipping.cod.base_fee = num(merged.shipping.cod.base_fee, DEFAULT_SHIPPING.cod.base_fee);
  merged.shipping.cod.by_zone = merged.shipping.cod.by_zone || {};
  merged.shipping.auto_zone_by_postcode = bool(
    merged.shipping.auto_zone_by_postcode,
    DEFAULT_SHIPPING.auto_zone_by_postcode
  );
  merged.shipping.fallback_service = str(merged.shipping.fallback_service, DEFAULT_SHIPPING.fallback_service);

  merged.shipping.zones = asArray(merged.shipping.zones, []);
  merged.shipping.weight_tiers = asArray(merged.shipping.weight_tiers, []);
  merged.shipping.courier_rules = asArray(merged.shipping.courier_rules, []);
  merged.shipping.free_shipping_rules = asArray(merged.shipping.free_shipping_rules, []);

  merged.tax.vat.pct = num(merged.tax.vat.pct, DEFAULT_TAX.vat.pct);
  merged.tax.vat.pricing_mode =
    merged.tax.vat.pricing_mode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE";
  merged.tax.tax_classes = asArray(merged.tax.tax_classes, [{ id: "DEFAULT", pct: 15 }]).map((c) => ({
    id: String(c.id || "DEFAULT"),
    pct: num(c.pct, 15),
  }));
  merged.tax.rounding.method = ["HALF_UP", "HALF_DOWN", "BANKERS"].includes(merged.tax.rounding.method)
    ? merged.tax.rounding.method
    : "HALF_UP";
  merged.tax.rounding.decimals = num(merged.tax.rounding.decimals, DEFAULT_TAX.rounding.decimals);
  merged.invoice = merged.invoice || DEFAULT_TAX.invoice;
  merged._version = num(merged._version, 1);

  // Validate (throws with clear message on problem)
  validateSettings(merged);
  return merged;
}

/* NEW: derive a stable public zones map { inside_dhaka, outside_dhaka, remote_zone } */
function zonesMapFrom(normalizedShipping) {
  // Prefer configured zones[] if present
  const byCode = {};
  for (const z of asArray(normalizedShipping?.zones)) {
    const code = String(z.code || "").toUpperCase();
    if (!code) continue;
    const fee = num(z.fee, 0);
    if (code.includes("INSIDE") && code.includes("DHAKA")) byCode.inside_dhaka = fee;
    else if (code.includes("OUTSIDE") && code.includes("DHAKA")) byCode.outside_dhaka = fee;
    else if (code.includes("REMOTE")) byCode.remote_zone = fee;
  }

  return {
    inside_dhaka: num(byCode.inside_dhaka, num(normalizedShipping?.inside_dhaka, 0)),
    outside_dhaka: num(byCode.outside_dhaka, num(normalizedShipping?.outside_dhaka, 0)),
    remote_zone: num(byCode.remote_zone, num(normalizedShipping?.remote_zone, 0)),
  };
}

function publicPayload(settings) {
  // Only expose what the storefront needs: currency, zone fees, tax headline, and COD basics.
  const zones = zonesMapFrom(settings.shipping);
  return {
    ok: true,
    currency: settings.currency || "BDT",
    shipping: {
      zones, // ← storefront can now read per-zone fees (no guessing)
      cod: {
        enabled: !!settings.shipping?.cod?.enabled,
        base_fee_bdt: num(settings.shipping?.cod?.base_fee, 0),
        by_zone: settings.shipping?.cod?.by_zone || {},
      },
      // NOTE: intentionally omitting any free-shipping fields from the public payload.
    },
    tax: {
      vat_pct: num(settings.tax?.vat?.pct, 15),
      pricing_mode: settings.tax?.vat?.pricing_mode || "INCLUSIVE",
    },
  };
}

/* ─────────────────────────── auditing ─────────────────────────── */

async function writeAudit({ userId, action, reason, before, after, ip, ua }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: action || "ADMIN_SETTINGS_UPDATE",
        subject: "app_setting:settings",
        subjectType: "AppSetting",
        metadata: { before, after, reason },
        ip: ip || null,
        userAgent: ua || null,
      },
    });
  } catch (e) {
    console.error("[settings][auditLog] failed", e);
  }
}

/* ─────────────────────────── ETag helpers ─────────────────────────── */

function etagFor(rec) {
  const ts = new Date(rec?.updatedAt || Date.now()).getTime();
  const v = (rec?.value && rec.value._version) || 1;
  return `"settings:${v}:${ts}"`;
}

/* ─────────────────────────────── GET ─────────────────────────────── */

export async function GET(req) {
  const session = await auth().catch(() => null);
  const url = new URL(req.url);
  const op = url.searchParams.get("op"); // "validate" | "vat"
  const ifNoneMatch = req.headers.get("if-none-match");

  const rec = await prisma.appSetting.findUnique({ where: { key: "settings" } });
  let normalized;
  try {
    normalized = normalizeSettings(rec?.value);
  } catch (e) {
    // surface invalid DB state to admins; hide from public
    if (!session || !isAdmin(session)) {
      return json({ ok: true, currency: "BDT", shipping: {}, tax: {} }, 200);
    }
    return json({ error: "INVALID_SETTINGS", message: String(e?.message || e) }, 500);
  }

  // Admin-only: quick VAT read
  if (op === "vat") {
    if (!session || !isAdmin(session)) return json({ error: "forbidden" }, 403);
    return json({
      ok: true,
      vat_pct: normalized.tax.vat.pct,
      pricing_mode: normalized.tax.vat.pricing_mode,
      _version: normalized._version,
      updatedAt: rec?.updatedAt || null,
    });
  }

  // Admin-only validation
  if (op === "validate") {
    if (!session || !isAdmin(session)) return json({ error: "forbidden" }, 403);
    const issues = [];
    const codes = new Set();
    for (const z of normalized.shipping.zones) {
      if (codes.has(z.code)) issues.push(`Duplicate zone code: ${z.code}`);
      codes.add(z.code);
    }
    let last = 0;
    for (const t of normalized.shipping.weight_tiers) {
      if (t.maxKg != null && t.maxKg <= last) {
        issues.push("weight_tiers must be strictly ascending by maxKg (null last).");
        break;
      }
      if (t.maxKg != null) last = t.maxKg;
    }
    if (normalized.shipping.cod.base_fee < 0) issues.push("cod.base_fee cannot be negative.");
    return json({ ok: issues.length === 0, issues });
  }

  // Public (non-admin)
  if (!session || !isAdmin(session)) {
    const etag = etagFor(rec);
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "public, max-age=900" },
      });
    }
    return json(publicPayload(normalized), 200, { ETag: etag, "Cache-Control": "public, max-age=900" });
  }

  // Admin full payload
  return json({
    key: "settings",
    value: normalized,
    meta: { _version: normalized._version, updatedAt: rec?.updatedAt || null },
  });
}

/* ─────────────────────────────── POST ───────────────────────────────
   Accepts either:
   A) Full settings blob:
      { value: <settings JSON>, _version: <number>, reason?: string }

   B) Quick VAT update:
      { vat_pct: "15%" | 15, pricing_mode?: "INCLUSIVE"|"EXCLUSIVE", reason?: string, _version?: number }
------------------------------------------------------------------------ */

export async function POST(req) {
  const session = await auth().catch(() => null);
  if (!session || !isAdmin(session)) return json({ error: "forbidden" }, 403);

  const url = new URL(req.url);
  const op = url.searchParams.get("op"); // supports "dry-run" for (A)

  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent") || null;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "invalid payload" }, 400);

  // ── Path B: Quick VAT micro-update ────────────────────────────────
  if (Object.prototype.hasOwnProperty.call(body, "vat_pct")) {
    const rec = await prisma.appSetting.findUnique({ where: { key: "settings" } });
    const current = normalizeSettings(rec?.value);

    let raw = body.vat_pct;
    if (typeof raw === "string") raw = raw.replace("%", "").trim();
    const pct = Number(raw);
    if (!isPct(pct)) return json({ error: "invalid vat_pct (0–100)" }, 400);

    const mode =
      body.pricing_mode === "EXCLUSIVE" || body.pricing_mode === "INCLUSIVE"
        ? body.pricing_mode
        : current.tax.vat.pricing_mode;

    const reason = str(body.reason, "Quick VAT update");

    const next = {
      ...current,
      tax: { ...current.tax, vat: { pct, pricing_mode: mode } },
      _version: current._version + 1,
    };

    // Validate before save (defensive)
    try {
      validateSettings(next);
    } catch (e) {
      return json({ error: "INVALID_SETTINGS", message: String(e?.message || e) }, 400);
    }

    const saved = await prisma.appSetting.upsert({
      where: { key: "settings" },
      create: { key: "settings", value: next },
      update: { value: next, updatedAt: new Date() },
    });

    await writeAudit({
      userId: session.user?.id,
      action: "ADMIN_SETTINGS_UPDATE",
      reason,
      before: current,
      after: next,
      ip,
      ua,
    });

    return json({
      ok: true,
      key: "settings",
      value: next,
      meta: {
        _version: next._version,
        updatedAt: saved.updatedAt,
        updatedByName: session.user?.name || null,
        updatedByEmail: session.user?.email || null,
      },
    });
  }

  // ── Path A: Full settings blob ────────────────────────────────────
  const incomingValue = body.value;
  const reason = str(body.reason, "");
  const clientVersion = Number(body._version);

  if (!incomingValue || typeof incomingValue !== "object") return json({ error: "missing value" }, 400);
  if (!Number.isInteger(clientVersion) || clientVersion < 1)
    return json({ error: "missing or invalid _version" }, 409);

  const rec = await prisma.appSetting.findUnique({ where: { key: "settings" } });
  const current = normalizeSettings(rec?.value);

  if (clientVersion !== current._version) {
    return json(
      {
        error: "STALE_VERSION",
        message: "Settings changed since you opened the form. Please reload.",
        currentVersion: current._version,
        updatedAt: rec?.updatedAt || null,
      },
      409
    );
  }

  let merged;
  try {
    merged = normalizeSettings(mergeDeep(current, incomingValue));
  } catch (e) {
    return json({ error: "INVALID_SETTINGS", message: String(e?.message || e) }, 400);
  }
  const toSave = { ...merged, _version: current._version + 1 };

  if (op === "dry-run") {
    return json({
      ok: true,
      key: "settings",
      value: toSave,
      meta: { _version: toSave._version, updatedByName: session.user?.name || null, dryRun: true },
    });
  }

  const saved = await prisma.appSetting.upsert({
    where: { key: "settings" },
    create: { key: "settings", value: toSave },
    update: { value: toSave, updatedAt: new Date() },
  });

  await writeAudit({
    userId: session.user?.id,
    action: "ADMIN_SETTINGS_UPDATE",
    reason,
    before: current,
    after: toSave,
    ip,
    ua,
  });

  return json({
    key: "settings",
    value: toSave,
    meta: {
      _version: toSave._version,
      updatedAt: saved.updatedAt,
      updatedByName: session.user?.name || null,
      updatedByEmail: session.user?.email || null,
    },
  });
}
