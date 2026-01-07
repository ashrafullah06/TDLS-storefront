// FILE: app/(admin)/admin/orders/[id]/page.jsx
"use client";

import React from "react";
import OrderDetailClient from "./client-actions";

export default function AdminOrderDetailPage({ params }) {
  // In Next.js 15, `params` is a Promise in client components.
  // React.use(params) unwraps it safely.
  const { id } = React.use(params);

  if (!id) {
    return (
      <div className="p-6 text-sm text-red-600">
        Order id is missing in the URL.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <OrderDetailClient orderId={id} />
    </div>
  );
}
