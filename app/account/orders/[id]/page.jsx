// FILE: app/account/orders/[id]/page.jsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OrderDetailsRedirectPage({ params }) {
  const id = params?.id ? String(params.id) : "";
  // Redirect to the existing customer dashboard order view (keep routing simple)
  redirect(`/customer/dashboard?section=order-history${id ? `&orderId=${encodeURIComponent(id)}` : ""}`);
}
