// FILE: src/components/checkout/receipt-auto-print.jsx
"use client";

import { useEffect } from "react";

/**
 * Auto-print helper for /orders/[id]/receipt
 * Triggered by query params (e.g. ?autoprint=1&close=1).
 */
export default function ReceiptAutoPrint({ closeAfter = false }) {
  useEffect(() => {
    let didPrint = false;

    const doPrint = () => {
      if (didPrint) return;
      didPrint = true;
      setTimeout(() => {
        try {
          window.print();
        } catch {}
      }, 250);
    };

    const onAfterPrint = () => {
      if (closeAfter) {
        try {
          window.close();
        } catch {}
      }
    };

    window.addEventListener("afterprint", onAfterPrint);

    if (document.readyState === "complete") doPrint();
    else window.addEventListener("load", doPrint, { once: true });

    return () => {
      window.removeEventListener("afterprint", onAfterPrint);
      window.removeEventListener("load", doPrint);
    };
  }, [closeAfter]);

  return null;
}
