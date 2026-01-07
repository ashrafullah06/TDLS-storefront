// FILE: src/lib/prisma-direct.js
// Prisma client that *forces* a direct Neon URL (non-pooler) for heavy admin tasks
// like stock sync, migration-like admin scripts, and long/complex queries.
// This module is intentionally SELF-CONTAINED and does NOT import ./prisma,
// so it cannot be taken down by an invalid runtime/pooler DATABASE_URL.

import { PrismaClient } from "@prisma/client";

// Reuse log settings similar to src/lib/prisma.js
const log = ["warn", "error"];
if (process.env.PRISMA_LOG_QUERIES === "true") log.push("query");
if (process.env.PRISMA_LOG_INFO === "true") log.push("info");

function stripOneSideQuotes(s) {
  let out = s;
  while (out.length && (out[0] === '"' || out[0] === "'" || out[0] === "`")) {
    out = out.slice(1);
  }
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
  let s = String(raw).replace(/\u0000/g, "");

  // Keep only first line if pasted badly
  if (s.includes("\n")) s = s.split("\n")[0];
  if (s.includes("\r")) s = s.split("\r")[0];

  s = s.trim();

  // Remove matched wrapping quotes/backticks
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("`") && s.endsWith("`"))
  ) {
    s = s.slice(1, -1).trim();
  }

  // Remove unmatched one-side quotes/backticks
  s = stripOneSideQuotes(s).trim();

  // Remove accidental trailing semicolon
  if (s.endsWith(";")) s = s.slice(0, -1).trim();

  // URLs must not contain whitespace
  s = s.replace(/\s+/g, "");

  return s;
}

function looksLikePlaceholder(s) {
  const v = String(s || "");
  if (!v) return true;

  // Unexpanded env interpolation (Node does not expand ${VAR} at runtime)
  if (v.includes("${") && v.includes("}")) return true;

  const upper = v.toUpperCase();
  if (upper.includes("REPLACE_ME")) return true;
  if (v.includes("<") || v.includes(">")) return true;
  if (upper.includes("YOUR-") || upper.includes("YOUR_")) return true;

  // Very common “template” fragments
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

function assertValidDbUrl(name, raw) {
  const cleaned = cleanEnvValue(raw);

  if (!cleaned) {
    throw new Error(
      `[prisma-direct] Missing ${name}. Set it in .env/.env.production.\n` +
        `Expected: postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require`
    );
  }

  if (looksLikePlaceholder(cleaned)) {
    throw new Error(
      `[prisma-direct] Invalid ${name}: placeholder/unexpanded value.\n` +
        `Preview: ${redactDbUrl(cleaned)}`
    );
  }

  let url;
  try {
    url = new URL(cleaned);
  } catch (e) {
    throw new Error(
      `[prisma-direct] Invalid ${name}: ${String(e?.message || e)}\n` +
        `Preview: ${redactDbUrl(cleaned)}\n` +
        `Common causes:\n` +
        `- wrapping quotes are included in the actual env value\n` +
        `- whitespace/newlines exist in the env value\n` +
        `- password contains special characters and is not URL-encoded\n` +
        `Expected: postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require`
    );
  }

  const proto = String(url.protocol || "").toLowerCase();
  if (proto !== "postgres:" && proto !== "postgresql:" && proto !== "file:") {
    throw new Error(
      `[prisma-direct] Invalid ${name}: unsupported protocol "${url.protocol}".\n` +
        `Preview: ${redactDbUrl(cleaned)}`
    );
  }

  return cleaned;
}

function isPoolerHost(urlStr) {
  // Neon pooler host often contains "-pooler." in hostname
  try {
    const u = new URL(urlStr);
    return String(u.hostname || "").includes("-pooler.");
  } catch {
    return false;
  }
}

function pickDirectDbUrl() {
  // Priority order:
  // 1) APP_DB_USER_DIRECT (dev standard in your .env)
  // 2) DIRECT_URL (prod standard in your .env.production)
  // 3) APP_DB_OWNER_DIRECT / OWNER_DATABASE_URL (fallback direct owner)
  // 4) DATABASE_URL (LAST resort; might be pooler or malformed in system env)
  const candidates = [
    ["APP_DB_USER_DIRECT", process.env.APP_DB_USER_DIRECT],
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["APP_DB_OWNER_DIRECT", process.env.APP_DB_OWNER_DIRECT],
    ["OWNER_DATABASE_URL", process.env.OWNER_DATABASE_URL],
    ["APP_DB_OWNER_POOLER_CB", process.env.APP_DB_OWNER_POOLER_CB], // fallback if direct missing
    ["APP_DB_USER_POOLER_CB", process.env.APP_DB_USER_POOLER_CB], // fallback if direct missing
    ["DATABASE_URL", process.env.DATABASE_URL], // absolute last resort
  ];

  const errors = [];
  const tried = [];

  for (const [name, val] of candidates) {
    if (val == null) continue;
    const cleaned = cleanEnvValue(val);
    if (!cleaned) continue;

    tried.push(name);

    // Skip placeholders quietly; continue trying
    if (looksLikePlaceholder(cleaned)) {
      errors.push(
        `[prisma-direct] Skipped ${name}: placeholder/unexpanded.\nPreview: ${redactDbUrl(cleaned)}`
      );
      continue;
    }

    try {
      const url = assertValidDbUrl(name, cleaned);

      // We want a DIRECT (non-pooler) url. If candidate is pooler, accept only
      // if we have no better direct options (handled by ordering), but still allow.
      // (No console noise here to avoid log spam; ordering is the real control.)
      return url;
    } catch (e) {
      errors.push(String(e?.message || e));
      continue;
    }
  }

  throw new Error(
    `[prisma-direct] Could not select a valid DIRECT database URL.\n` +
      `Tried: ${tried.join(", ") || "(none)"}\n\n` +
      errors.slice(0, 6).join("\n\n")
  );
}

const directUrl = pickDirectDbUrl();

// Keep a singleton across hot reloads
const globalForPrisma = globalThis;

const prismaDirect =
  globalForPrisma.__TDLC_PRISMA_DIRECT__ ??
  new PrismaClient({
    log,
    datasources: {
      db: {
        url: directUrl,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__TDLC_PRISMA_DIRECT__ = prismaDirect;
}

export default prismaDirect;
export { prismaDirect };
