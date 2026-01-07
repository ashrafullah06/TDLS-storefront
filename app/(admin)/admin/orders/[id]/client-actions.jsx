//FILE: app/(admin)/admin/orders/[id]/client-actions.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_TRANSITIONS = {
  DRAFT: ["PLACED", "CANCELLED"],
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  ARCHIVED: [],
};

function StatusPill({ status }) {
  if (!status) return null;
  const s = String(status).toUpperCase();
  let bg = "#f3f4f6";
  let color = "#111827";
  if (s === "COMPLETED") {
    bg = "#ecfdf3";
    color = "#166534";
  } else if (s === "CONFIRMED" || s === "PLACED") {
    bg = "#eff6ff";
    color = "#1d4ed8";
  } else if (s === "CANCELLED") {
    bg = "#fef2f2";
    color = "#b91c1c";
  } else if (s === "DRAFT") {
    bg = "#fefce8";
    color = "#854d0e";
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color }}
    >
      {s}
    </span>
  );
}

function PaymentPill({ status }) {
  if (!status) return null;
  const s = String(status).toUpperCase();
  let bg = "#f3f4f6";
  let color = "#111827";
  if (s === "PAID" || s === "SETTLED") {
    bg = "#ecfdf3";
    color = "#15803d";
  } else if (s === "PENDING" || s === "AUTHORIZED" || s === "INITIATED") {
    bg = "#eff6ff";
    color = "#1d4ed8";
  } else if (s === "FAILED" || s === "CANCELED") {
    bg = "#fef2f2";
    color = "#b91c1c";
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color }}
    >
      {s}
    </span>
  );
}

function FulfillmentPill({ status }) {
  if (!status) return null;
  const s = String(status).toUpperCase();
  let bg = "#f3f4f6";
  let color = "#111827";
  if (s === "FULFILLED") {
    bg = "#ecfdf3";
    color = "#15803d";
  } else if (s === "PARTIAL") {
    bg = "#fefce8";
    color = "#854d0e";
  } else if (s === "UNFULFILLED") {
    bg = "#eff6ff";
    color = "#1d4ed8";
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color }}
    >
      {s}
    </span>
  );
}

export default function OrderDetailClient({ orderId }) {
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [courierCode, setCourierCode] = useState("PATHAO");
  const [serviceCode, setServiceCode] = useState("STANDARD");
  const [feedback, setFeedback] = useState("");

  async function load() {
    setErr("");
    setFeedback("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load order");
      }
      setOrder(json.order || null);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (orderId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const transitions = useMemo(() => {
    if (!order?.status) return [];
    const from = String(order.status).toUpperCase();
    return STATUS_TRANSITIONS[from] || [];
  }, [order?.status]);

  async function changeStatus(to) {
    if (!order) return;
    setSaving(true);
    setErr("");
    setFeedback("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Status update failed");
      }
      setOrder(json.order || null);
      setFeedback(`Status changed to ${to}.`);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function capturePayment() {
    if (!order) return;
    setSaving(true);
    setErr("");
    setFeedback("");
    try {
      const res = await fetch(
        `/api/admin/orders/${orderId}/payments/capture`,
        {
          method: "POST",
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Capture failed");
      }
      await load();
      setFeedback("Payment capture completed.");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function bookShipment() {
    if (!order) return;
    const cc = courierCode.trim();
    const sc = serviceCode.trim();
    if (!cc || !sc) {
      setErr("courierCode and serviceCode are required.");
      return;
    }
    setSaving(true);
    setErr("");
    setFeedback("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierCode: cc, serviceCode: sc }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Shipment booking failed");
      }
      await load();
      setFeedback("Shipment booked successfully.");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!order) return;
    const msg = note.trim();
    if (!msg) return;
    setSaving(true);
    setErr("");
    setFeedback("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "NOTE", message: msg }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Failed to add note");
      }
      setNote("");
      await load();
      setFeedback("Note added.");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    router.push("/admin/orders");
  }

  if (loading && !order) {
    return (
      <div className="text-sm text-neutral-600">
        Loading order details…
      </div>
    );
  }

  if (!order && !loading) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-red-600">
          Order not found or failed to load.
        </div>
        <button
          onClick={goBack}
          className="rounded border px-3 py-1 text-xs hover:bg-neutral-50"
        >
          Back to orders
        </button>
      </div>
    );
  }

  const grandTotal = Number(order?.grandTotal ?? 0);
  const subtotal = Number(order?.subtotal ?? 0);
  const discountTotal = Number(order?.discountTotal ?? 0);
  const taxTotal = Number(order?.taxTotal ?? 0);
  const shippingTotal = Number(order?.shippingTotal ?? 0);

  const money = (n) =>
    Number(n ?? 0).toLocaleString("en-BD", {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 2,
    });

  const sortedEvents = (order?.events || [])
    .slice()
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    });

  return (
    <div className="space-y-6">
      {/* Top summary row */}
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Left: core info */}
        <div className="flex-1 rounded border bg-white p-4 text-sm space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500">Order</div>
              <div className="mt-1 text-lg font-semibold">
                {order.orderNumber != null
                  ? `#${order.orderNumber}`
                  : order.id}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {order.createdAt
                  ? new Date(order.createdAt).toLocaleString()
                  : "—"}
              </div>
            </div>
            <div className="text-right space-y-1">
              <StatusPill status={order.status} />
              <div className="flex justify-end gap-1">
                <PaymentPill status={order.paymentStatus} />
                <FulfillmentPill status={order.fulfillmentStatus} />
              </div>
              <div className="mt-1 text-xs font-semibold">
                {money(grandTotal)}
              </div>
            </div>
          </div>

          {/* Customer + address */}
          <div className="border-t pt-3 grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-neutral-600">
                Customer
              </div>
              <div className="mt-1 text-sm">
                {order.user?.name || "Guest"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {order.user?.email || "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                {order.user?.phone || "—"}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-neutral-600">
                Shipping address
              </div>
              <div className="mt-1 text-[11px] text-neutral-700 whitespace-pre-line">
                {order.shippingAddress
                  ? [
                      order.shippingAddress.name,
                      order.shippingAddress.phone,
                      order.shippingAddress.line1,
                      order.shippingAddress.line2,
                      order.shippingAddress.city,
                      order.shippingAddress.state,
                      order.shippingAddress.postcode,
                      order.shippingAddress.country,
                    ]
                      .filter(Boolean)
                      .join("\n")
                  : "—"}
              </div>
            </div>
          </div>
        </div>

        {/* Right: staff actions */}
        <div className="w-full lg:w-80 rounded border bg-white p-4 text-sm space-y-3">
          <div className="text-xs font-semibold text-neutral-600">
            Staff actions
          </div>

          {/* Status actions */}
          <div className="space-y-2">
            <div className="text-[11px] text-neutral-500">
              Status transitions
            </div>
            <div className="flex flex-wrap gap-2">
              {["PLACED", "CONFIRMED", "COMPLETED", "CANCELLED"].map(
                (target) => {
                  const enabled = transitions.includes(target);
                  return (
                    <button
                      key={target}
                      type="button"
                      onClick={() => enabled && changeStatus(target)}
                      disabled={!enabled || saving}
                      className="rounded-full border px-3 py-1 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-default hover:bg-neutral-50"
                    >
                      {target}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* Payment */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-neutral-500">
                Payment control
              </div>
            </div>
            <button
              type="button"
              onClick={capturePayment}
              disabled={saving}
              className="w-full rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-default"
            >
              Capture / mark as paid
            </button>
          </div>

          {/* Shipment */}
          <div className="space-y-2 border-t pt-3">
            <div className="text-[11px] text-neutral-500">
              Book shipment (label only)
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 rounded border px-2 py-1 text-xs"
                placeholder="Courier code"
                value={courierCode}
                onChange={(e) => setCourierCode(e.target.value)}
              />
              <input
                type="text"
                className="flex-1 rounded border px-2 py-1 text-xs"
                placeholder="Service code"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={bookShipment}
              disabled={saving}
              className="w-full rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-default"
            >
              Book shipment
            </button>
          </div>

          {/* Note */}
          <div className="space-y-2 border-t pt-3">
            <div className="text-[11px] text-neutral-500">
              Add internal note
            </div>
            <textarea
              rows={3}
              className="w-full rounded border px-2 py-1 text-xs"
              placeholder="e.g. Called customer, confirmed address."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              onClick={addNote}
              disabled={saving || !note.trim()}
              className="w-full rounded-full border px-3 py-1.5 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-default"
            >
              Save note
            </button>
          </div>

          {/* Feedback */}
          {(err || feedback) && (
            <div className="border-t pt-3 text-xs">
              {err && <div className="mb-1 text-red-600">{err}</div>}
              {feedback && (
                <div className="text-green-600">{feedback}</div>
              )}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              onClick={goBack}
              className="rounded-full border px-3 py-1 text-xs hover:bg-neutral-50"
            >
              Back to orders
            </button>
          </div>
        </div>
      </div>

      {/* Items + events */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Items */}
        <div className="lg:col-span-2 rounded border bg-white p-4 text-sm">
          <div className="mb-2 text-xs font-semibold text-neutral-600">
            Items
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-2 py-1 text-left">Item</th>
                  <th className="px-2 py-1 text-left">SKU</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Price</th>
                  <th className="px-2 py-1 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(order.items || []).map((item) => {
                  const price = Number(item.unitPrice ?? item.price ?? 0);
                  const qty = Number(item.quantity ?? item.qty ?? 0);
                  const subtotalLine =
                    Number(item.totalPrice ?? item.subtotal ?? 0) ||
                    price * qty;
                  return (
                    <tr key={item.id} className="border-t">
                      <td className="px-2 py-1">
                        <div className="text-xs">
                          {item.productName || item.title || "Item"}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {item.variantName || item.options || ""}
                        </div>
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px]">
                        {item.sku || "—"}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {qty || 0}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {money(price)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {money(subtotalLine)}
                      </td>
                    </tr>
                  );
                })}
                {(order.items || []).length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-2 py-3 text-neutral-600"
                    >
                      No items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals summary */}
          <div className="mt-3 border-t pt-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-neutral-600">Subtotal</span>
              <span className="font-medium">{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">Discount</span>
              <span className="font-medium">
                -{money(discountTotal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">Tax</span>
              <span className="font-medium">{money(taxTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-600">Shipping</span>
              <span className="font-medium">
                {money(shippingTotal)}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t pt-2 text-xs font-semibold text-neutral-900">
              <span>Total</span>
              <span>{money(grandTotal)}</span>
            </div>
          </div>
        </div>

        {/* Events / notes timeline */}
        <div className="rounded border bg-white p-4 text-sm">
          <div className="mb-2 text-xs font-semibold text-neutral-600">
            Timeline
          </div>
          <div className="max-h-[420px] space-y-3 overflow-y-auto">
            {sortedEvents.length === 0 && (
              <div className="text-xs text-neutral-600">
                No events recorded yet.
              </div>
            )}
            {sortedEvents.map((ev) => (
              <div key={ev.id} className="flex gap-2">
                <div className="mt-1">
                  <div className="h-2 w-2 rounded-full bg-neutral-400" />
                </div>
                <div className="flex-1">
                  <div className="text-[11px] font-semibold">
                    {ev.kind || "EVENT"}
                  </div>
                  {ev.message && (
                    <div className="text-xs text-neutral-800">
                      {ev.message}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-neutral-500">
                    {ev.createdAt
                      ? new Date(ev.createdAt).toLocaleString()
                      : "—"}
                    {ev.actorRole && " • "}
                    {ev.actorRole && (
                      <span className="uppercase">
                        {ev.actorRole}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
