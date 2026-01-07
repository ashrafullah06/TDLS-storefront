// PATH: app/wishlist/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { redirect } from "next/navigation";

function buildQueryStringFromObject(obj) {
  if (!obj || typeof obj !== "object") return "";
  const usp = new URLSearchParams();

  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;

    if (Array.isArray(v)) {
      for (const vv of v) {
        const s = vv == null ? "" : String(vv).trim();
        if (s) usp.append(k, s);
      }
    } else {
      const s = String(v).trim();
      if (s) usp.set(k, s);
    }
  }

  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Centralized wishlist routing:
 * - /wishlist is only an alias.
 * - Always redirect to /account/wishlist and let that page decide UI based on session + API.
 * - Prevents “false login required” caused by cookie-path visibility differences.
 */
export default async function WishlistAliasPage({ searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const qs = buildQueryStringFromObject(sp);
  redirect(`/account/wishlist${qs}`);
}
