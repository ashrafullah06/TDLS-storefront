// PATH: my-project\src\components\orders\print-button.jsx
"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => typeof window !== "undefined" && window.print()}
      className="px-4 py-2 rounded-full text-white"
      style={{ background: "#0F2147" }}
    >
      Download / Print
    </button>
  );
}
