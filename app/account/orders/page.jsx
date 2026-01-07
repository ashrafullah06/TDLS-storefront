// FILE: app/account/orders/page.jsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function OrdersPage() {
  // send anyone hitting /account/orders to the dashboard order history
  redirect("/customer/dashboard?section=order-history");
}
