// FILE: lib/trackview.js

const ANALYTICS_TIMEOUT_MS = 1500;

export async function trackProductView(product) {
  const url =
    process.env.NEXT_PUBLIC_ANALYTICS_API;

  if (!url) {
    return;
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, ANALYTICS_TIMEOUT_MS);

  try {
    await fetch(url, {
      method: "POST",

      body: JSON.stringify({
        type:
          "product_view",

        id:
          product?.id ??
          null,

        slug:
          product?.slug ??
          null,

        timestamp:
          Date.now(),
      }),

      headers: {
        "Content-Type":
          "application/json",
      },

      cache:
        "no-store",

      signal:
        controller.signal,

      /*
       * Allows browser-originated tracking to finish during navigation
       * where supported. It has no effect on the product rendering path.
       */
      keepalive:
        typeof window !==
        "undefined",
    });
  } catch (e) {
    /*
     * Analytics must NEVER affect product availability.
     * Timeout, CORS, network failure, or analytics downtime are all ignored.
     */
    if (
      process.env.NODE_ENV !==
        "production" &&
      e?.name !==
        "AbortError"
    ) {
      console.warn(
        "trackProductView failed:",
        e
      );
    }
  } finally {
    clearTimeout(timer);
  }
}