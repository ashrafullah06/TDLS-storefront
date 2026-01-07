// FILE: app/(admin)/admin/payments/page.js
// Server Component (no "use client")

export const metadata = {
  title: "Admin • Payments",
  robots: { index: false, follow: false }
};

// Ensure this route is never prerendered as static
export const dynamic = "force-dynamic";

import PaymentsClient from "./paymentsclient";

export default function PaymentsAdminPage() {
  // IMPORTANT: JSX tag must be PascalCase (component), not <paymentsclient />
  return <PaymentsClient />;
}
