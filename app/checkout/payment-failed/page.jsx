// my-project/app/checkout/payment-failed/page.jsx
"use client";

import Link from "next/link";

export default function PaymentFailedPage({ searchParams }) {
  const reason = (searchParams?.reason || "").replace(/_/g, " ").toLowerCase();
  return (
    <main className="min-h-[70dvh] flex items-center justify-center px-4 py-16 bg-white">
      <div className="max-w-md w-full text-center">
        <div className="text-3xl font-extrabold text-[#0F2147]">Payment unsuccessful</div>
        <p className="mt-3 text-gray-600">
          Thank you for your attempt. {reason ? <>Reason: <b>{reason}</b>. </> : null}
          Your order was not completed.
        </p>
        <div className="mt-6 space-y-3">
          <Link
            href="/checkout"
            className="inline-flex items-center justify-center h-11 px-6 rounded-xl font-bold bg-[#0F2147] text-white w-full"
          >
            Try another method (COD recommended)
          </Link>
          <Link
            href="/account/orders"
            className="inline-flex items-center justify-center h-11 px-6 rounded-xl font-bold border border-gray-300 text-[#0F2147] w-full bg-white"
          >
            View my orders
          </Link>
        </div>
      </div>
    </main>
  );
}
