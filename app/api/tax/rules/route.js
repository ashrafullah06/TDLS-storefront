// FILE: app/api/tax/rules/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Goal:
 * - Replace the old per-rule JSON textarea (e.g., {"country":"BD","rate":7.5})
 *   with a single, easy VAT % input like "15%".
 * - This route now acts as a thin facade over AppSetting.key="settings" → value.tax.vat.pct.
 * - GET  → returns { ok, vat_pct, pricing_mode }
 * - POST → accepts { vat_pct: "15%" | 15, pricing_mode?: "INCLUSIVE"|"EXCLUSIVE" } and saves.
 * - We keep a very small compatibility shim so nothing crashes if old UI code still calls it.
 */

/* ───────────────────────── helpers ───────────────────────── */

async function getPerms() {
  try {
    // Works on the server (absolute URL not required for Next API -> API)
    const r = await fetch("/api/admin/session", { cache: "no-store" });
    const j = await r.json();
    return j?.user?.permissions || [];
  } catch {
    return [];
  }
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

async function readSettings() {
  const rec = await prisma.appSetting.findUnique({ where: { key: "settings" } });
  const val = rec?.value || {};
  const tax = val?.tax || {};
  const vat = tax?.vat || {};
  return {
    recUpdatedAt: rec?.updatedAt || null,
    all: val,
    vat_pct: num(vat.pct, 15),
    pricing_mode: vat.pricing_mode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
    _version: num(val?._version, 1),
  };
}

async function writeSettings(nextValue) {
  return prisma.appSetting.upsert({
    where: { key: "settings" },
    create: { key: "settings", value: nextValue },
    update: { value: nextValue, updatedAt: new Date() },
  });
}

/* ──────────────────────────── GET ────────────────────────────
   New shape (simple):
     { ok: true, vat_pct: 15, pricing_mode: "INCLUSIVE" }

   A tiny legacy shim is included to avoid crashes if some old UI still
   expects "rules": we also include a read-only "rules_preview".
---------------------------------------------------------------- */
export async function GET() {
  try {
    const s = await readSettings();
    return NextResponse.json({
      ok: true,
      vat_pct: s.vat_pct,
      pricing_mode: s.pricing_mode,
      updatedAt: s.recUpdatedAt,
      _version: s._version,
      // legacy, read-only preview so older panes don't break visually
      rules_preview: [{ zone: "GLOBAL", rate: s.vat_pct, mode: s.pricing_mode }],
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "tax settings unavailable", detail: String(e) },
      { status: 503 }
    );
  }
}

/* ──────────────────────────── POST ────────────────────────────
   Accepts ONLY the simple VAT input now:

   Body:
     { vat_pct: "15%" | 15, pricing_mode?: "INCLUSIVE"|"EXCLUSIVE" }

   Permissions:
     requires MANAGE_TAX.
----------------------------------------------------------------- */
export async function POST(req) {
  const perms = await getPerms();
  if (!perms.includes("MANAGE_TAX")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !Object.prototype.hasOwnProperty.call(body, "vat_pct")) {
    return NextResponse.json(
      { error: "missing vat_pct; send e.g. { \"vat_pct\": \"15%\" }" },
      { status: 400 }
    );
  }

  // Parse "15%" or 15 → 15 (0–100)
  let raw = body.vat_pct;
  if (typeof raw === "string") raw = raw.replace("%", "").trim();
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return NextResponse.json({ error: "invalid vat_pct (0–100)" }, { status: 400 });
  }

  // Optional pricing mode
  const mode =
    body.pricing_mode === "EXCLUSIVE" || body.pricing_mode === "INCLUSIVE"
      ? body.pricing_mode
      : undefined;

  try {
    const s = await readSettings();
    const next = {
      ...(s.all || {}),
      tax: {
        ...(s.all?.tax || {}),
        vat: {
          pct,
          pricing_mode: mode || s.pricing_mode || "INCLUSIVE",
        },
        // retain any other tax fields unchanged
        ...(s.all?.tax ? { rounding: s.all.tax.rounding, tax_classes: s.all.tax.tax_classes } : {}),
      },
      _version: (s._version || 1) + 1,
    };

    const saved = await writeSettings(next);

    return NextResponse.json({
      ok: true,
      vat_pct: pct,
      pricing_mode: next.tax.vat.pricing_mode,
      updatedAt: saved.updatedAt,
      _version: next._version,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "tax settings write failed", detail: String(e) },
      { status: 503 }
    );
  }
}

/* ──────────────────────────── DELETE ────────────────────────────
   No longer supports deleting "rules". We reset to default VAT = 15%
   if someone calls DELETE (keeps older buttons from crashing).
------------------------------------------------------------------- */
export async function DELETE() {
  const perms = await getPerms();
  if (!perms.includes("MANAGE_TAX")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const s = await readSettings();
    const next = {
      ...(s.all || {}),
      tax: {
        ...(s.all?.tax || {}),
        vat: { pct: 15, pricing_mode: "INCLUSIVE" },
        ...(s.all?.tax ? { rounding: s.all.tax.rounding, tax_classes: s.all.tax.tax_classes } : {}),
      },
      _version: (s._version || 1) + 1,
    };
    const saved = await writeSettings(next);
    return NextResponse.json({
      ok: true,
      vat_pct: 15,
      pricing_mode: "INCLUSIVE",
      updatedAt: saved.updatedAt,
      _version: next._version,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "reset failed", detail: String(e) },
      { status: 503 }
    );
  }
}
