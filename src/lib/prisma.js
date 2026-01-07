// FILE: src/lib/prisma.js
import { PrismaClient } from "@prisma/client";

/**
 * Hardened Prisma singleton for Next.js (Turbopack/Dev/Prod).
 *
 * Goals:
 * 1) Never fail just because a SYSTEM DATABASE_URL is malformed if another valid candidate exists
 *    (common on Windows after a bad "setx DATABASE_URL=...").
 * 2) Prefer app-specific vars (APP_DB_*) first, then fall back to DATABASE_URL / provider defaults.
 * 3) Provide actionable, redacted error messages.
 *
 * Optional controls (non-breaking):
 * - TDLC_DB_TARGET: "app" | "admin" | "customer" | "strapi" (default: "app")
 *   (Only changes candidate ordering; does not affect schema or Prisma models.)
 */

function stripOneSideQuotes(s) {
  let out = s;
  // remove leading quotes/backticks even if unmatched
  while (out.length && (out[0] === '"' || out[0] === "'" || out[0] === "`")) {
    out = out.slice(1);
  }
  // remove trailing quotes/backticks even if unmatched
  while (
    out.length &&
    (out[out.length - 1] === '"' ||
      out[out.length - 1] === "'" ||
      out[out.length - 1] === "`")
  ) {
    out = out.slice(0, -1);
  }
  return out;
}

function cleanEnvValue(raw) {
  if (raw == null) return "";

  // Normalize to string and remove null chars (can appear from copy/paste)
  let s = String(raw).replace(/\u0000/g, "");

  // If value accidentally became multi-line, keep only first line
  // (dotenv should avoid this, but Windows/system env sometimes contains newlines)
  if (s.includes("\n")) s = s.split("\n")[0];
  if (s.includes("\r")) s = s.split("\r")[0];

  s = s.trim();

  // remove wrapping quotes/backticks if they became part of the value (matched)
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }

  // also remove unmatched quotes at either side (common copy/paste)
  s = stripOneSideQuotes(s).trim();

  // remove accidental trailing semicolon
  if (s.endsWith(";")) s = s.slice(0, -1).trim();

  // URLs must not contain whitespace; remove any (safe for URLs)
  s = s.replace(/\s+/g, "");

  return s;
}

function looksLikePlaceholder(s) {
  const v = String(s || "");
  if (!v) return true;

  // Unexpanded env interpolation (Next/Node do not expand ${...} in runtime env)
  if (v.includes("${") && v.includes("}")) return true;

  // Common placeholders
  const upper = v.toUpperCase();
  if (upper.includes("REPLACE_ME")) return true;
  if (v.includes("<") || v.includes(">")) return true;
  if (upper.includes("YOUR-") || upper.includes("YOUR_")) return true;

  // obvious fake host fragments
  if (v.includes("your-neon-host") || v.includes("your_host")) return true;

  return false;
}

function redactDbUrl(u) {
  try {
    const url = new URL(u);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable>";
  }
}

export function assertValidDbUrl(name, raw) {
  const cleaned = cleanEnvValue(raw);

  if (!cleaned) {
    throw new Error(
      `[prisma] Missing ${name}. Set ${name} in .env.local (or system env).\n` +
        `Expected: postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require\n` +
        `Tip: If PASSWORD has special characters (@ : / # ? &), use the provider-generated encoded URL.`
    );
  }

  if (looksLikePlaceholder(cleaned)) {
    throw new Error(
      `[prisma] Invalid ${name}: appears to be a placeholder/unexpanded value.\n` +
        `Preview: ${redactDbUrl(cleaned)}\n` +
        `Fix: set ${name} to a real postgresql:// URL (no \${VARS}, no <placeholders>).`
    );
  }

  let url;
  try {
    url = new URL(cleaned);
  } catch (e) {
    throw new Error(
      `[prisma] Invalid ${name}: ${String(e?.message || e)}\n` +
        `Preview: ${redactDbUrl(cleaned)}\n` +
        `Common causes:\n` +
        `- wrapping quotes are included in the actual env value\n` +
        `- whitespace/newlines exist in the env value\n` +
        `- password contains special characters and is not URL-encoded\n` +
        `Expected: postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require`
    );
  }

  const proto = String(url.protocol || "").toLowerCase();
  const okProto =
    proto === "postgres:" || proto === "postgresql:" || proto === "file:";
  if (!okProto) {
    throw new Error(
      `[prisma] Invalid ${name}: unsupported protocol "${url.protocol}".\n` +
        `Preview: ${redactDbUrl(cleaned)}\n` +
        `Allowed: postgresql:// or postgres:// (and file: for sqlite).`
    );
  }

  return cleaned;
}

function getDbTarget() {
  const v = String(process.env.TDLC_DB_TARGET || "")
    .trim()
    .toLowerCase();
  if (!v) return "app";
  if (v === "admin" || v === "customer" || v === "strapi" || v === "app") return v;
  return "app";
}

function pickDbUrl() {
  const target = getDbTarget();

  // IMPORTANT:
  // - Put APP_DB_* first so a bad Windows/system DATABASE_URL won't break runtime.
  // - Keep DATABASE_URL as fallback for compatibility.
  // - Include ADMIN/CUSTOMER overrides without forcing them.
  // - DO NOT mix Strapi DB into app Prisma unless TDLC_DB_TARGET=strapi (optional).
  const baseCandidates = [
    // explicit Prisma override if you ever use it in some deployments
    ["PRISMA_DATABASE_URL", process.env.PRISMA_DATABASE_URL],

    // app-plane preferred (your env already has APP_DB_USER_POOLER_CB)
    ["APP_DB_USER_POOLER_CB", process.env.APP_DB_USER_POOLER_CB],
    ["APP_DB_USER_POOLER", process.env.APP_DB_USER_POOLER],
    ["APP_DATABASE_URL", process.env.APP_DATABASE_URL],

    // legacy / common
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["NEON_DATABASE_URL", process.env.NEON_DATABASE_URL],
  ];

  const adminCandidates = [
    ["ADMIN_DATABASE_URL", process.env.ADMIN_DATABASE_URL],
    ...baseCandidates,
  ];

  const customerCandidates = [
    ["CUSTOMER_DATABASE_URL", process.env.CUSTOMER_DATABASE_URL],
    ...baseCandidates,
  ];

  const strapiCandidates = [
    ["STRAPI_DATABASE_URL", process.env.STRAPI_DATABASE_URL],
    ["STRAPI_DB_USER_POOLER_CB", process.env.STRAPI_DB_USER_POOLER_CB],
    ["STRAPI_DB_USER_DIRECT", process.env.STRAPI_DB_USER_DIRECT],
    ["STRAPI_DB_OWNER_DIRECT", process.env.STRAPI_DB_OWNER_DIRECT],
    ...baseCandidates,
  ];

  const candidates =
    target === "admin"
      ? adminCandidates
      : target === "customer"
      ? customerCandidates
      : target === "strapi"
      ? strapiCandidates
      : baseCandidates;

  const errors = [];
  const tried = [];

  for (const [name, val] of candidates) {
    if (val == null) continue;

    const cleaned = cleanEnvValue(val);
    if (!cleaned) continue;

    tried.push(name);

    // Skip obvious placeholders/unexpanded patterns quietly and continue
    if (looksLikePlaceholder(cleaned)) {
      errors.push(
        `[prisma] Skipped ${name}: placeholder/unexpanded.\nPreview: ${redactDbUrl(cleaned)}`
      );
      continue;
    }

    try {
      return assertValidDbUrl(name, cleaned);
    } catch (e) {
      errors.push(String(e?.message || e));
      continue;
    }
  }

  // Force a clean missing error if nothing set at all
  if (tried.length === 0) {
    assertValidDbUrl("APP_DB_USER_POOLER_CB", process.env.APP_DB_USER_POOLER_CB);
  }

  // Consolidated failure (redacted)
  throw new Error(
    `[prisma] Could not select a valid database URL (target="${target}").\n` +
      `Tried: ${tried.join(", ") || "(none)"}\n\n` +
      errors.slice(0, 5).join("\n\n")
  );
}

// Logging controls (kept from your current behavior)
const log = ["warn", "error"];
if (process.env.PRISMA_LOG_QUERIES === "true") log.push("query");
if (process.env.PRISMA_LOG_INFO === "true") log.push("info");

const databaseUrl = pickDbUrl();

// Singleton across hot reloads
const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.__TDLC_PRISMA__ ??
  new PrismaClient({
    log,
    datasources: { db: { url: databaseUrl } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__TDLC_PRISMA__ = prisma;
}

export default prisma;
export { prisma };
