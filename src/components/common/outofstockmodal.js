"use client";
import React, { useEffect, useRef } from "react";

export default function OutOfStockModal({ open, product, onClose }) {
  const modalRef = useRef();

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (open && modalRef.current) {
      modalRef.current.focus();
    }
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40"
      aria-modal="true"
      tabIndex={-1}
      onClick={onClose}
      style={{ animation: "fadeIn .2s" }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-8 w-[95vw] max-w-md text-center relative"
        onClick={e => e.stopPropagation()}
        tabIndex={0}
        ref={modalRef}
      >
        <svg width="50" height="50" fill="none" className="mx-auto mb-2">
          <circle cx="25" cy="25" r="24" stroke="#FFD700" strokeWidth="2" />
          <path d="M25 16v12M25 34h.01" stroke="#181A1B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <h2 className="text-2xl font-bold mb-3 text-gray-900">Out of Stock</h2>
        <div className="mb-3 text-gray-700">
          Sorry, <span className="font-semibold">{product?.name || "this product"}</span> is currently out of stock.
        </div>
        <div className="mb-5 text-sm text-gray-500">
          Get notified when it’s back or explore similar styles!
        </div>
        <button
          className="px-7 py-2 mt-3 bg-black text-[#FFD700] font-semibold rounded-full hover:bg-[#222] transition"
          onClick={onClose}
          autoFocus
        >
          Close
        </button>
      </div>
    </div>
  );
}
