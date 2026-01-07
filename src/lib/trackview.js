// /lib/trackview.js
export async function trackProductView(product) {
  try {
    const url = process.env.NEXT_PUBLIC_ANALYTICS_API;

    // If analytics endpoint is not configured, do nothing.
    if (!url) return;

    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        type: "product_view",
        id: product?.id ?? null,
        slug: product?.slug ?? null,
        timestamp: Date.now(),
      }),
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // In production, stay silent; log only in non-prod to avoid noisy server logs.
    if (process.env.NODE_ENV !== "production") {
      console.warn("trackProductView failed:", e);
    }
  }
}
