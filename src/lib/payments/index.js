import { stripeCreatePaymentIntent } from "./stripe";
import { sslcommerzInitPayment } from "./sslcommerz";
import { bkashCreatePayment } from "./bkash";
import { nagadCreatePayment } from "./nagad";

/**
 * createPaymentSession(provider, order) -> { mode, ...fields }
 * mode:
 *  - stripe_client_secret
 *  - redirect
 */
export async function createPaymentSession(provider, { order, customer }) {
  switch (provider) {
    case "STRIPE": {
      const pi = await stripeCreatePaymentIntent({
        amount: order.grandTotal,
        currency: order.currency,
        metadata: { orderId: order.id, orderNumber: order.orderNumber },
      });
      return { mode: "stripe_client_secret", client_secret: pi.client_secret, id: pi.id };
    }
    case "SSL_COMMERZ": {
      const s = await sslcommerzInitPayment({
        amount: order.grandTotal,
        currency: order.currency,
        tran_id: `order_${order.orderNumber}`,
        cus_name: customer?.name || "Customer",
        cus_email: customer?.email || "customer@example.com",
        cus_phone: customer?.phone || "01XXXXXXXXX",
        cus_add1: customer?.address || "Dhaka",
        desc: `Order #${order.orderNumber}`,
      });
      return { mode: "redirect", url: s.gateway_url, session: s.sessionkey };
    }
    case "BKASH": {
      const b = await bkashCreatePayment({
        amount: order.grandTotal,
        currency: order.currency,
        invoiceNumber: `order_${order.orderNumber}`,
      });
      return { mode: "redirect", url: b.redirect_url, pid: b.payment_id };
    }
    case "NAGAD": {
      const n = await nagadCreatePayment({
        amount: order.grandTotal,
        orderId: `order_${order.orderNumber}`,
      });
      return { mode: "redirect", url: n.redirect_url, ref: n.payment_ref_id };
    }
    case "CASH_ON_DELIVERY":
    case "MANUAL":
      return { mode: "cod" };
    default:
      throw new Error("unsupported_provider");
  }
}
