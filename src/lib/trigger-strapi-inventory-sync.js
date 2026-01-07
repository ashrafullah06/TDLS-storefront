// FILE: src/lib/trigger-strapi-inventory-sync.js

/**
 * Helper to trigger the internal Prisma → Strapi inventory sync endpoint
 * from server-side code (e.g., after an order is placed).
 *
 * It reuses the existing route:
 *   /api/internal/cron/sync-strapi-inventory
 *
 * Auth: INTERNAL_CRON_TOKEN or CRON_SECRET in .env
 */

const APP_BASE_URL =
  process.env.AUTH_URL ||
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "http://localhost:3000";

const CRON_SECRET =
  process.env.INTERNAL_CRON_TOKEN || process.env.CRON_SECRET || "";

/**
 * Trigger full Prisma → Strapi inventory sync.
 * - Returns { ok: true, summary } on success
 * - Returns { ok: false, ... } on failure/skip
 *
 * IMPORTANT:
 * - Does NOT throw; caller should treat failures as non-fatal.
 */
export async function triggerStrapiInventoryFullSync() {
  if (!CRON_SECRET) {
    console.warn(
      "[triggerStrapiInventoryFullSync] Skipped: INTERNAL_CRON_TOKEN / CRON_SECRET not configured."
    );
    return { ok: false, skipped: "NO_CRON_SECRET" };
  }

  const base = (APP_BASE_URL || "").replace(/\/+$/, "") || "http://localhost:3000";
  const url = `${base}/api/internal/cron/sync-strapi-inventory?secret=${encodeURIComponent(
    CRON_SECRET
  )}`;

  try {
    console.log(
      "[triggerStrapiInventoryFullSync] Calling internal cron endpoint:",
      url
    );

    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok || data?.ok === false) {
      console.error(
        "[triggerStrapiInventoryFullSync] Sync failed:",
        data || { status: res.status, statusText: res.statusText }
      );
      return {
        ok: false,
        error: data?.error || data?.code || "SYNC_FAILED",
        raw: data,
      };
    }

    console.log(
      "[triggerStrapiInventoryFullSync] Sync completed:",
      data?.summary || data
    );

    return { ok: true, summary: data?.summary || null };
  } catch (err) {
    console.error(
      "[triggerStrapiInventoryFullSync] Unexpected error:",
      err?.message || err
    );
    return { ok: false, error: err?.message || String(err) };
  }
}
