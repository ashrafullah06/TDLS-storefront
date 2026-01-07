// PATH: src/lib/order-transitions.js
import prisma from "@/lib/prisma";
import { PAIDLIKE } from "@/lib/paidlike";

/**
 * Minimal, safe server-side transitions for Order.status/paymentStatus/fulfillmentStatus.
 * Emits OrderEvent audit entries.
 */
export async function transitionOrder({ orderId, action, actorId }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true, items: true, shipments: true },
  });
  if (!order) throw new Error("Order not found");

  const now = new Date();

  const emit = (kind, message, metadata = {}) =>
    prisma.orderEvent.create({
      data: {
        orderId,
        kind,
        message,
        metadata,
        at: now,
        actorId,
        actorRole: "ADMIN",
      },
    });

  switch (action) {
    case "confirm":
      if (order.status === "CANCELLED" || order.status === "ARCHIVED")
        throw new Error("Cannot confirm a cancelled/archived order");
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "CONFIRMED" },
      });
      await emit("STATUS", "Order confirmed by admin");
      break;

    case "cancel":
      if (order.fulfillmentStatus === "FULFILLED")
        throw new Error("Cannot cancel a fulfilled order");
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED", paymentStatus: order.paymentStatus },
      });
      await emit("STATUS", "Order cancelled by admin");
      break;

    case "complete":
      if (!PAIDLIKE.has(String(order.paymentStatus))) {
        throw new Error("Cannot complete: payment is not in a paid-like state");
      }
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "COMPLETED", fulfillmentStatus: "FULFILLED" },
      });
      await emit("STATUS", "Order completed by admin");
      break;

    default:
      throw new Error("Unsupported action");
  }

  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      items: true,
      payments: true,
      shipments: true,
      shippingAddress: true,
      billingAddress: true,
      events: true,
    },
  });
}
