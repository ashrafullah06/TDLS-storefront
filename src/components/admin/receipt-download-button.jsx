// PATH: src/components/checkout/receipt-download-button.jsx
"use client";

import React, { useCallback, useState } from "react";

/**
 * Download the visible receipt as a PNG image.
 * - Captures only #tdlc-receipt-print
 * - Removes footer (.foot) so buttons don't appear
 * - Makes the image a bit wider
 * - Names file: tdlc_{orderNumber}_{ddmmyyyy}_{hhmmss}.png
 */
export default function ReceiptDownloadButton({ orderNumber, createdAt }) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(async () => {
    if (busy) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const src = document.getElementById("tdlc-receipt-print");
    if (!src) return;

    setBusy(true);
    try {
      // lazy-load html2canvas only in the browser
      const { default: html2canvas } = await import("html2canvas");

      // clone the receipt so we can tweak it for screenshot
      const clone = src.cloneNode(true);
      clone.id = "tdlc-receipt-print-clone";

      // widen a bit
      clone.style.width = "780px";
      clone.style.maxWidth = "780px";
      clone.style.boxShadow = "none";
      clone.style.borderRadius = "0";
      clone.style.margin = "0";

      // remove footer (buttons)
      const foot = clone.querySelector(".foot");
      if (foot) {
        foot.remove();
      }

      // offscreen wrapper to avoid layout shift
      const wrapper = document.createElement("div");
      wrapper.style.position = "fixed";
      wrapper.style.left = "-10000px";
      wrapper.style.top = "0";
      wrapper.style.pointerEvents = "none";
      wrapper.style.background = "#ffffff";
      wrapper.appendChild(clone);
      document.body.appendChild(wrapper);

      try {
        const canvas = await html2canvas(clone, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
          windowWidth: clone.scrollWidth + 40,
          windowHeight: clone.scrollHeight + 40,
        });

        const dataUrl = canvas.toDataURL("image/png");
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");

        // build filename
        const ts = createdAt ? new Date(createdAt) : new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const fname = `tdlc_${orderNumber || "order"}_${pad(
          ts.getDate()
        )}${pad(ts.getMonth() + 1)}${ts.getFullYear()}_${pad(
          ts.getHours()
        )}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.png`;

        a.href = url;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        document.body.removeChild(wrapper);
      }
    } catch (err) {
      console.error("receipt png download failed:", err);
    } finally {
      setBusy(false);
    }
  }, [busy, orderNumber, createdAt]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="btn"
      disabled={busy}
      style={{ opacity: busy ? 0.7 : 1 }}
    >
      {busy ? "Preparing…" : "Download invoice (image)"}
    </button>
  );
}
