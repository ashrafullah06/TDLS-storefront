// app/thank-you/page.jsx

import { Suspense } from "react";
import ThankYouClient from "./thank-you-client";

export default function ThankYouPage({ searchParams }) {
  const orderId = searchParams?.order ? String(searchParams.order) : "";
  const paid = searchParams?.paid ? String(searchParams.paid) : "";

  return (
    <Suspense fallback={null}>
      <ThankYouClient orderId={orderId} paid={paid} />
    </Suspense>
  );
}
