// PATH: src/lib/couriers/dummy.js
/**
 * Replace this with your real courier SDK adapter.
 * For now, we "book" and return a fake label/tracking.
 */
export async function bookCourierLabel({ order, serviceCode }) {
  const tracking = `TDLS-${order.orderNumber}-${Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0")}`;
  const labelUrl = `/api/admin/orders/${order.id}/shipments/label.pdf?tracking=${encodeURIComponent(
    tracking
  )}`;
  return { trackingNumber: tracking, labelUrl };
}
