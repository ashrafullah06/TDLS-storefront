// src/components/checkout/receipt-print-button.jsx
"use client";

export default function ReceiptPrintButton({
  label = "Print Receipt",
  className = "",
}) {
  const onPrint = () => {
    // Direct browser print dialog
    if (typeof window !== "undefined" && window.print) window.print();
  };

  return (
    <button
      type="button"
      onClick={onPrint}
      className={
        className ||
        // Neutral, premium-safe default button styling (does not affect layout)
        "inline-flex items-center justify-center rounded-xl border border-[#DFE3EC] bg-white px-4 py-2 text-sm font-extrabold text-[#0F2147] shadow-sm hover:bg-[#F6F8FC] active:scale-[0.99] transition"
      }
      aria-label="Print receipt"
      title="Print receipt"
    >
      {label}
    </button>
  );
}
