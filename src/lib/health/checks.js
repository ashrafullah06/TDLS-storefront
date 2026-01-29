/* eslint-disable no-console */

/**
 * TDLS — Health Checks Library
 * Path: "@/lib/health/checks"
 *
 * Purpose:
 * - Provide a single, reusable health summary builder for /api/health/summary and other internal health endpoints.
 * - Runs defensive, real checks (env, DB ping via Prisma if available, Strapi ping, optional queue hook, sitemap/robots audit).
 * - Returns a stable shape:
 *   {
 *     status, timestamp,
 *     version: { commit, region, runtime, node, build, app },
 *     env: { node_env, next_public_site_url, strapi_url, strapi_token_set, strapi_token_preview, database },
 *     checks: { [key]: { ok, status, ms, desc, error?, meta? } },
 *     suggestions: string[]
 *   }
 */

const DEFAULT_TIMEOUT_MS = 8000;

function nowMs() {
  try {
    // eslint-disable-next-line no-undef
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function safeStr(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function trimSlash(s) {
  return safeStr(s).replace(/\/+$/, "");
}

function pickEnv(keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function previewSecret(s, head = 4, tail = 4) {
  const x = safeStr(s).trim();
  if (!x) return "";
  if (x.length <= head + tail + 3) return `${x.slice(0, Math.min(3, x.length))}…`;
  return `${x.slice(0, head)}…${x.slice(-tail)}`;
}

function redactDbUrl(dbUrl) {
  const raw = safeStr(dbUrl).trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.host || "";
    const db = (u.pathname || "").replace(/^\//, "");
    return db ? `${host}/${db}` : host;
  } catch {
    return raw.slice(0, 18) + "…";
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = nowMs();
  try {
    const res = await fetch(url, {
      ...opts,
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
        ...(opts.headers || {}),
      },
    });
    const ms = nowMs() - started;
    clearTimeout(t);
    return { res, ms, error: "" };
  } catch (e) {
    const ms = nowMs() - started;
    clearTimeout(t);
    return { res: null, ms, error: safeStr(e?.message || e) };
  }
}

function classifyStatusFromOk(ok, level = "info") {
  if (ok) return "ok";
  // for non-ok, map to degraded/error by severity
  if (level === "critical") return "error";
  if (level === "warning") return "degraded";
  return "degraded";
}

function mergeOverallStatus(checks) {
  // Priority: error > degraded > ok
  let hasError = false;
  let hasDegraded = false;

  for (const v of Object.values(checks || {})) {
    const s = safeStr(v?.status).toLowerCase();
    if (s === "error" || s === "down" || s === "failed" || s === "fail") hasError = true;
    else if (s === "degraded" || s === "warn" || s === "warning" || s === "partial") hasDegraded = true;
    else if (v?.ok === false) hasDegraded = true;
  }

  if (hasError) return "error";
  if (hasDegraded) return "degraded";
  return "ok";
}

/**
 * Run a single check with timing and standardized shape.
 */
async function runCheck(key, desc, fn, { level = "info" } = {}) {
  const started = nowMs();
  try {
    const out = (await fn()) || {};
    const ms = typeof out.ms === "number" ? out.ms : nowMs() - started;
    const ok = !!out.ok;
    const status = safeStr(out.status) || classifyStatusFromOk(ok, level);
    const error = safeStr(out.error);
    const meta = out.meta && typeof out.meta === "object" ? out.meta : undefined;

    return {
      [key]: {
        desc,
        ok,
        status,
        ms,
        ...(error ? { error } : {}),
        ...(meta ? { meta } : {}),
      },
    };
  } catch (e) {
    const ms = nowMs() - started;
    const error = safeStr(e?.message || e) || "check failed";
    return {
      [key]: {
        desc,
        ok: false,
        status: classifyStatusFromOk(false, level),
        ms,
        error,
      },
    };
  }
}

/**
 * Optional: allow consumers to provide baseUrl (origin) for same-app probes.
 * If omitted, relative fetches still work in Next.js route handlers.
 */
export async function buildHealthSummary({
  include = "all",
  baseUrl = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const ts = new Date().toISOString();
  const checks = {};
  const suggestions = [];

  const runtime = safeStr(process.env.NEXT_RUNTIME || "nodejs");
  const isEdge = runtime === "edge";

  // ---- env & version surface (lightweight, always safe) ----
  const strapiUrl =
    pickEnv(["STRAPI_URL", "NEXT_PUBLIC_STRAPI_URL", "STRAPI_BASE_URL", "NEXT_PUBLIC_STRAPI_BASE_URL"]) || "";
  const strapiToken =
    pickEnv(["STRAPI_TOKEN", "STRAPI_API_TOKEN", "STRAPI_READ_TOKEN", "NEXT_PUBLIC_STRAPI_TOKEN"]) || "";

  const siteUrl =
    pickEnv(["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_BASE_URL", "SITE_URL", "BASE_URL", "NEXTAUTH_URL"]) || "";

  const dbUrl = pickEnv(["DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) || "";

  const version = {
    app: pickEnv(["NEXT_PUBLIC_APP_VERSION", "APP_VERSION"]) || "",
    commit: pickEnv(["VERCEL_GIT_COMMIT_SHA", "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT", "COMMIT_SHA"]) || "",
    sha: pickEnv(["VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT", "COMMIT_SHA"]) || "",
    region: pickEnv(["VERCEL_REGION", "FLY_REGION", "AWS_REGION", "RAILWAY_REGION"]) || "",
    build: pickEnv(["VERCEL_DEPLOYMENT_ID", "BUILD_ID", "RAILWAY_DEPLOYMENT_ID"]) || "",
    runtime: runtime || "nodejs",
    node: process.version || "",
  };

  const env = {
    node_env: safeStr(process.env.NODE_ENV || ""),
    next_public_site_url: siteUrl,
    strapi_url: strapiUrl,
    strapi_token_set: !!strapiToken,
    strapi_token_preview: strapiToken ? previewSecret(strapiToken) : "",
    database: dbUrl ? redactDbUrl(dbUrl) : "",
  };

  // ---- Check: env sanity ----
  Object.assign(
    checks,
    await runCheck(
      "env",
      "Environment variables sanity",
      async () => {
        const missing = [];
        // Keep this strict but realistic: Strapi and DB are core for TDLS.
        if (!strapiUrl) missing.push("STRAPI_URL");
        if (!dbUrl) missing.push("DATABASE_URL");
        const ok = missing.length === 0;
        return {
          ok,
          status: ok ? "ok" : "degraded",
          meta: {
            missing,
            node_env: env.node_env || "—",
          },
          error: ok ? "" : `Missing: ${missing.join(", ")}`,
        };
      },
      { level: "warning" }
    )
  );

  if (checks.env.ok === false) {
    suggestions.push("Set missing core environment variables (STRAPI_URL, DATABASE_URL) in your hosting platform and redeploy.");
  }

  // ---- Check: DB ping (Prisma) ----
  Object.assign(
    checks,
    await runCheck(
      "db",
      "Database connectivity (Prisma ping)",
      async () => {
        if (isEdge) {
          return { ok: true, status: "ok", meta: { skipped: true, reason: "edge runtime" } };
        }

        // Dynamic import to avoid bundling issues when Prisma isn't present in some environments
        let prisma = null;
        try {
          const mod = await import("@/lib/prisma");
          prisma = mod?.default || mod?.prisma || mod;
        } catch (e) {
          return {
            ok: false,
            status: "error",
            error: `Cannot import prisma: ${safeStr(e?.message || e)}`,
          };
        }

        if (!prisma || typeof prisma.$queryRaw !== "function") {
          return { ok: false, status: "error", error: "Prisma client not available (missing $queryRaw)." };
        }

        const started = nowMs();
        try {
          // Postgres-safe ping
          await prisma.$queryRaw`SELECT 1`;
          const ms = nowMs() - started;
          return { ok: true, status: "ok", ms };
        } catch (e) {
          const ms = nowMs() - started;
          return { ok: false, status: "error", ms, error: safeStr(e?.message || e) };
        }
      },
      { level: "critical" }
    )
  );

  if (checks.db.ok === false) {
    suggestions.push("Database check failed. Verify Neon/DB connection string, Prisma binaryTarget, and network access from your host.");
  }

  // ---- Check: Strapi reachability ----
  Object.assign(
    checks,
    await runCheck(
      "strapi",
      "Strapi reachability (direct ping)",
      async () => {
        if (!strapiUrl) return { ok: false, status: "degraded", error: "STRAPI_URL not set" };

        // We prefer a lightweight endpoint.
        // Most Strapi instances answer "/" or "/_health" (varies). We'll try a small sequence safely.
        const base = trimSlash(strapiUrl);
        const candidates = [`${base}/_health`, `${base}/api/_health`, `${base}/api/users-permissions/roles`];

        let lastErr = "";
        let lastHttp = 0;

        for (const url of candidates) {
          // eslint-disable-next-line no-await-in-loop
          const { res, ms, error } = await fetchWithTimeout(
            url,
            {
              method: "GET",
              headers: strapiToken ? { Authorization: `Bearer ${strapiToken}` } : {},
            },
            timeoutMs
          );

          if (!res) {
            lastErr = error || "fetch failed";
            continue;
          }

          lastHttp = res.status;

          // /roles may require auth; treat 200/401/403 as "reachable"
          if (res.status >= 200 && res.status < 300) return { ok: true, status: "ok", ms, meta: { http: res.status, url } };
          if (res.status === 401 || res.status === 403) return { ok: true, status: "ok", ms, meta: { http: res.status, url, note: "auth-gated but reachable" } };

          // retry next candidate
          lastErr = `HTTP ${res.status}`;
        }

        return { ok: false, status: "error", error: lastErr || "Strapi unreachable", meta: { lastHttp } };
      },
      { level: "critical" }
    )
  );

  if (checks.strapi.ok === false) {
    suggestions.push("Strapi check failed. Verify STRAPI_URL is correct/reachable and Strapi is up (Railway), then confirm token scope if needed.");
  }

  // ---- Optional: Queue integration hook (only if your project provides it) ----
  Object.assign(
    checks,
    await runCheck(
      "queue_hook",
      "Queue layer hook (optional import)",
      async () => {
        // This does NOT replace /api/health/queue. It just detects if a queue helper exists.
        try {
          const mod = await import("@/lib/queue");
          const hasAnything = !!mod && Object.keys(mod).length > 0;
          return {
            ok: true,
            status: "ok",
            meta: {
              present: hasAnything,
              exports: hasAnything ? Object.keys(mod).slice(0, 10) : [],
            },
          };
        } catch (e) {
          // Not an error for most apps
          return { ok: true, status: "ok", meta: { present: false, skipped: true, reason: "no /lib/queue module" } };
        }
      },
      { level: "info" }
    )
  );

  // ---- Optional: robots.txt audit (same-app) ----
  if (include === "all" || include === "seo") {
    const origin = trimSlash(baseUrl) || "";
    const robotsUrl = origin ? `${origin}/robots.txt` : "/robots.txt";

    Object.assign(
      checks,
      await runCheck(
        "robots",
        "robots.txt reachable and disallows /admin",
        async () => {
          const { res, ms, error } = await fetchWithTimeout(robotsUrl, { method: "GET" }, timeoutMs);
          if (!res) return { ok: false, status: "degraded", ms, error: error || "robots fetch failed" };

          const txt = await res.text().catch(() => "");
          const disallowAdmin = /Disallow:\s*\/admin\/?/i.test(txt);
          const ok = res.status >= 200 && res.status < 400 && disallowAdmin;

          return {
            ok,
            status: ok ? "ok" : "degraded",
            ms,
            meta: { http: res.status, disallowAdmin },
            error: ok ? "" : "robots.txt missing Disallow: /admin (recommended)",
          };
        },
        { level: "warning" }
      )
    );

    if (checks.robots.ok === false) {
      suggestions.push("Update robots.txt to disallow /admin (and ideally /api) to prevent accidental indexing.");
    }
  }

  // ---- Optional: sitemap audit (same-app) ----
  if (include === "all" || include === "seo") {
    const origin = trimSlash(baseUrl) || "";
    const sitemapUrl = origin ? `${origin}/sitemap.xml` : "/sitemap.xml";

    Object.assign(
      checks,
      await runCheck(
        "sitemap",
        "sitemap.xml reachable and does not leak /admin or /health",
        async () => {
          const { res, ms, error } = await fetchWithTimeout(sitemapUrl, { method: "GET" }, timeoutMs);
          if (!res) return { ok: false, status: "degraded", ms, error: error || "sitemap fetch failed" };

          const xml = await res.text().catch(() => "");
          const locs = (xml.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi) || []).map((b) => {
            const m = b.match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i);
            return m?.[1]?.trim() || "";
          });

          const leakAdmin = locs.some((u) => /\/admin(\/|$)/i.test(u));
          const leakHealth = locs.some((u) => /\/health(\/|$)/i.test(u));
          const ok = res.status >= 200 && res.status < 400 && !leakAdmin && !leakHealth;

          return {
            ok,
            status: ok ? "ok" : "degraded",
            ms,
            meta: { http: res.status, locCount: locs.length, leakAdmin, leakHealth },
            error: ok ? "" : "Sitemap leaks internal routes (admin/health) or is not reachable",
          };
        },
        { level: "warning" }
      )
    );

    if (checks.sitemap.ok === false) {
      suggestions.push("Fix sitemap generation to exclude internal routes (/admin, /health). Admin routes must never be indexed.");
    }
  }

  const status = mergeOverallStatus(checks);

  return {
    status,
    timestamp: ts,
    version,
    env,
    checks,
    suggestions,
  };
}

/**
 * Convenience runner used by simple /api/health route styles.
 * Returns the same shape as buildHealthSummary.
 */
export async function runHealthChecks(opts = {}) {
  return buildHealthSummary(opts);
}
