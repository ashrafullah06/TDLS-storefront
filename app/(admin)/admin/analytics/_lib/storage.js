// FILE: app/(admin)/admin/analytics/_lib/storage.js
// Local-only persistence for admin analytics UI state.

const VIEWS_KEY = "tdlc_admin_analytics_views_v1";
const TARGETS_KEY = "tdlc_admin_analytics_targets_v1";

export function loadViewsSafe() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveViewsSafe(views) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views || []));
  } catch {}
}

export function loadTargetsSafe() {
  if (typeof window === "undefined") return { revenue: "", orders: "" };
  try {
    const raw = window.localStorage.getItem(TARGETS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") {
      return {
        revenue: String(obj.revenue ?? ""),
        orders: String(obj.orders ?? ""),
      };
    }
  } catch {}
  return { revenue: "", orders: "" };
}

export function saveTargetsSafe(targets) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TARGETS_KEY,
      JSON.stringify(targets || { revenue: "", orders: "" })
    );
  } catch {}
}
