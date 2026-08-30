// FILE: src/components/homepage/homepage-client.jsx
"use client";

import dynamic from "next/dynamic";

/**
 * ✅ Critical fix (REAL):
 * - Prevent SSR from importing/executing Swiper/HLS/DOM-dependent code by moving all heavy logic
 *   into a separate module and dynamically importing it with ssr:false.
 * - This stops SSR crashes like:
 *   "Switched to client rendering because the server rendering errored:
 *    Cannot read properties of null (reading 'useState')"
 */
const HomepageClient = dynamic(() => import("./homepage-client.inner"), {
  ssr: false,
  // Keep a stable white canvas to avoid layout flash while the heavy module loads.
  loading: () => <div style={{ minHeight: "100svh", width: "100%", background: "#fff" }} />,
});

export default HomepageClient;