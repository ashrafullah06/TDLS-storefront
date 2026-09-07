// FILE: src/components/product/product-view-tracker.jsx
"use client";

import { useEffect } from "react";

import { trackProductView } from "@/lib/trackview";

/**
 * Product analytics must never be part of the server-render critical path.
 *
 * The product page renders first. After hydration, this tiny component records
 * the view in the browser.
 */
export default function ProductViewTracker({
  productId = null,
  slug = "",
}) {
  useEffect(() => {
    void trackProductView({
      id:
        productId,

      slug:
        slug || null,
    });
  }, [
    productId,
    slug,
  ]);

  return null;
}