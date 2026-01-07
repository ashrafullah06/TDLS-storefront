// PATH: app/(admin)/admin/orders/rer-panel.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const NAVY = "#0F2147";
const GOLD = "#D4AF37";
const BORDER = "#E6E9F2";
const MUTED = "#64748b";

/* ---------------- tiny helpers ---------------- */
function cx(...xs) {
  return xs.filter(Boolean).join(" ");
}
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function isoDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
function safeText(v, fallback = "—") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}
function moneyBDT(v) {
  const x = n(v, 0);
  return x.toLocaleString("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 2,
  });
}
function mkMutationId() {
  // deterministic-enough for double-click safety at UI layer
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function jfetch(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  // Some of your routes may return empty body on 404/500 (so keep safe)
  const data = await res.json().catch(() => null);

  if (!res.ok || data?.ok === false) {
    const endpointHint =
      res.status === 404
        ? "HTTP_404 (ENDPOINT_NOT_FOUND)"
        : `HTTP_${res.status}`;

    const errMsg = data?.error || data?.message || endpointHint;
    const code = data?.code ? `\n${data.code}` : "";

    const err = new Error(`${errMsg}${code}`.trim());
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/* ---------------- order snapshot (manual entry helper) ---------------- */
/**
 * Goal:
 * Staff types Order # (like 46) OR Order UUID.
 * We try multiple likely admin order endpoints, normalize response, and return:
 * - canonical order.id (UUID) so POST create does not fail with ORDER_NOT_FOUND
 * - item lines (best if delivered / fulfilled data exists)
 */
async function fetchOrderSnapshotBestEffort(orderIdLike) {
  const raw = String(orderIdLike ?? "").trim();
  if (!raw) throw new Error("Order ID is empty.");

  // Accept input like "#46", "46", or a UUID/DB id
  const cleaned = raw.replace(/^#/, "").trim();
  const isNumeric = /^\d+$/.test(cleaned);

  const tries = [];

  // Common admin patterns (your project already uses /api/admin/orders in multiple places)
  tries.push({ url: `/api/admin/orders/${encodeURIComponent(cleaned)}`, kind: "by-id" });
  tries.push({ url: `/api/admin/orders/lookup?orderId=${encodeURIComponent(cleaned)}`, kind: "lookup" });
  tries.push({ url: `/api/admin/orders/by-id?id=${encodeURIComponent(cleaned)}`, kind: "by-id-qp" });

  // List/search patterns
  tries.push({ url: `/api/admin/orders?orderId=${encodeURIComponent(cleaned)}&take=1&page=1`, kind: "list-orderId" });
  tries.push({ url: `/api/admin/orders?q=${encodeURIComponent(cleaned)}&take=1&page=1`, kind: "list-q" });
  tries.push({ url: `/api/admin/orders?query=${encodeURIComponent(cleaned)}&take=1&page=1`, kind: "list-query" });
  tries.push({ url: `/api/admin/orders/search?q=${encodeURIComponent(cleaned)}`, kind: "search" });

  if (isNumeric) {
    // If staff inputs the human-facing order number, many APIs use orderNumber or number
    tries.push({ url: `/api/admin/orders?orderNumber=${encodeURIComponent(cleaned)}&take=1&page=1`, kind: "list-orderNumber" });
    tries.push({ url: `/api/admin/orders?number=${encodeURIComponent(cleaned)}&take=1&page=1`, kind: "list-number" });
    tries.push({ url: `/api/admin/orders/lookup?orderNumber=${encodeURIComponent(cleaned)}`, kind: "lookup-orderNumber" });
    tries.push({ url: `/api/admin/orders/lookup?number=${encodeURIComponent(cleaned)}`, kind: "lookup-number" });
  }

  let lastErr = null;

  for (const t of tries) {
    try {
      const data = await jfetch(t.url, { method: "GET" });

      // Normalize common shapes:
      // - { ok:true, order:{...} }
      // - { order:{...} }
      // - { item:{...} }
      // - { items:[...], total:n } (list)
      // - { orders:[...] }
      // - { data:{...} }
      const candidate =
        data?.order ||
        data?.item ||
        data?.data?.order ||
        data?.data ||
        (Array.isArray(data?.items) && data.items.length ? data.items[0] : null) ||
        (Array.isArray(data?.orders) && data.orders.length ? data.orders[0] : null) ||
        (Array.isArray(data?.data?.items) && data.data.items.length ? data.data.items[0] : null) ||
        null;

      if (!candidate) {
        lastErr = new Error("Order not found in response.");
        continue;
      }

      const normalized = normalizeOrderSnapshot(candidate);

      // Must have at least an id or orderNumber to be considered valid
      if (!String(normalized?.id || "").trim() && !String(normalized?.orderNumber || "").trim()) {
        lastErr = new Error("Order normalization failed.");
        continue;
      }

      return normalized;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  const msg = lastErr?.message || "Order lookup failed.";
  throw new Error(msg);
}

function normalizeOrderSnapshot(o) {
  // Flexible mapping to avoid breaking if your DB schema differs slightly.
  const order = o?.order ? o.order : o;

  const id = String(order?.id || order?.orderId || order?.uid || "");
  const orderNumber =
    order?.orderNumber ??
    order?.number ??
    order?.no ??
    order?.seq ??
    order?.displayNumber ??
    null;

  const status = String(
    order?.status ??
      order?.orderStatus ??
      order?.state ??
      order?.fulfillmentStatus ??
      ""
  );
  const paymentStatus = String(order?.paymentStatus ?? order?.payment_state ?? "");
  const fulfillmentStatus = String(
    order?.fulfillmentStatus ?? order?.shippingStatus ?? order?.deliveryStatus ?? ""
  );

  const createdAt = order?.createdAt ?? order?.created_at ?? order?.date ?? null;
  const deliveredAt =
    order?.deliveredAt ??
    order?.delivered_at ??
    order?.fulfilledAt ??
    order?.fulfilled_at ??
    null;

  const customer =
    order?.customer ||
    order?.user ||
    order?.account ||
    (order?.customerName || order?.customerEmail || order?.customerPhone
      ? {
          name: order?.customerName,
          email: order?.customerEmail,
          phone: order?.customerPhone,
        }
      : null);

  // Items: support multiple common names and nested shapes
  const rawItems =
    order?.items?.items ||
    order?.items?.data ||
    order?.items ||
    order?.orderItems ||
    order?.lineItems ||
    order?.lines ||
    order?.products ||
    order?.order_items ||
    [];

  const items = Array.isArray(rawItems)
    ? rawItems.map((it, idx) => normalizeOrderItem(it, idx))
    : [];

  // Totals
  const subtotal =
    order?.subtotal ??
    order?.subTotal ??
    order?.itemsSubtotal ??
    order?.items_total ??
    null;
  const shipping =
    order?.shipping ??
    order?.shippingFee ??
    order?.deliveryCharge ??
    order?.shipping_fee ??
    null;
  const discount =
    order?.discount ??
    order?.discountTotal ??
    order?.couponDiscount ??
    order?.discount_total ??
    null;
  const total =
    order?.total ?? order?.grandTotal ?? order?.amount ?? order?.total_amount ?? null;

  return {
    id: id || String(order?.id || ""),
    orderNumber: orderNumber != null ? String(orderNumber) : null,
    status,
    paymentStatus,
    fulfillmentStatus,
    createdAt,
    deliveredAt,
    customer: customer
      ? {
          name: customer?.name ?? customer?.fullName ?? customer?.username ?? null,
          email: customer?.email ?? null,
          phone: customer?.phone ?? customer?.mobile ?? null,
        }
      : null,
    totals: {
      subtotal,
      shipping,
      discount,
      total,
    },
    items,
    raw: order,
  };
}

function normalizeOrderItem(it, idx) {
  const id = String(it?.id || it?.orderItemId || it?.lineId || it?.uid || `item-${idx}`);
  const name =
    it?.name ||
    it?.title ||
    it?.productName ||
    it?.product_title ||
    it?.product?.name ||
    it?.product?.title ||
    "—";
  const sku =
    it?.sku ||
    it?.productSku ||
    it?.variantSku ||
    it?.variant?.sku ||
    it?.product?.sku ||
    null;

  const color =
    it?.color ||
    it?.variantColor ||
    it?.variant?.color ||
    it?.variant?.colorName ||
    it?.attributes?.color ||
    null;
  const size =
    it?.size ||
    it?.variantSize ||
    it?.variant?.size ||
    it?.variant?.sizeName ||
    it?.attributes?.size ||
    null;

  const qty = n(it?.qty ?? it?.quantity ?? it?.count ?? 1, 1);

  const unitPrice =
    it?.unitPrice ??
    it?.price ??
    it?.unit_price ??
    it?.variantPrice ??
    it?.variant?.price ??
    null;

  const lineTotal =
    it?.lineTotal ??
    it?.total ??
    it?.line_total ??
    (unitPrice != null ? n(unitPrice, 0) * qty : null);

  // Optional delivered signals
  const deliveredQty =
    it?.deliveredQty ??
    it?.delivered_quantity ??
    it?.fulfilledQty ??
    it?.fulfilled_quantity ??
    null;
  const itemStatus = it?.status ?? it?.state ?? it?.fulfillmentStatus ?? null;

  return {
    id,
    name: String(name || "—"),
    sku: sku != null ? String(sku) : null,
    color: color != null ? String(color) : null,
    size: size != null ? String(size) : null,
    qty,
    unitPrice,
    lineTotal,
    deliveredQty: deliveredQty != null ? n(deliveredQty, 0) : null,
    itemStatus: itemStatus != null ? String(itemStatus) : null,
    raw: it,
  };
}

/* ---------------- business rules (action gating) ---------------- */
function allowedActions(lane, statusRaw) {
  const status = String(statusRaw || "").toUpperCase();

  if (lane === "returns") {
    return {
      approve: status === "REQUESTED",
      deny: status === "REQUESTED",
      received: status === "APPROVED",
      refunded: status === "RECEIVED",
    };
  }

  if (lane === "exchanges") {
    return {
      approve: status === "REQUESTED",
      deny: status === "REQUESTED",
      fulfilled: status === "APPROVED",
    };
  }

  if (lane === "refunds") {
    return {
      process: status === "INITIATED",
      fail: status === "INITIATED",
    };
  }

  return {};
}

function badgeTone(st) {
  const s = String(st || "").toUpperCase();
  if (["APPROVED", "RECEIVED", "REFUNDED", "FULFILLED", "PROCESSED"].includes(s))
    return "ok";
  if (["REQUESTED", "INITIATED"].includes(s)) return "warn";
  if (["DENIED", "FAILED"].includes(s)) return "bad";
  return "";
}

function laneStatusOptions(lane) {
  if (lane === "returns") return ["REQUESTED", "APPROVED", "RECEIVED", "REFUNDED", "DENIED"];
  if (lane === "exchanges") return ["REQUESTED", "APPROVED", "FULFILLED", "DENIED"];
  if (lane === "refunds") return ["INITIATED", "PROCESSED", "FAILED"];
  return [];
}

/* ---------------- UI atoms ---------------- */
function TabPill({ active, onClick, children }) {
  return (
    <button type="button" className={cx("tab", active && "active")} onClick={onClick}>
      {children}
    </button>
  );
}

function MetricCard({ title, value, sub }) {
  return (
    <div className="card">
      <div className="t">{title}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

function PondAction({ label, tone = "secondary", onClick, disabled }) {
  const cls =
    tone === "primary"
      ? "pond pond-primary"
      : tone === "danger"
        ? "pond pond-danger"
        : "pond pond-secondary";

  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function ToastBar({ tone = "success", title, message, onClose }) {
  const t = tone === "error" ? "toast toast-error" : "toast toast-ok";
  return (
    <div className={t} role="status" aria-live="polite">
      <div className="toast-main">
        <div className="toast-title">{title}</div>
        <div className="toast-msg">{message}</div>
      </div>
      <button type="button" className="toast-x" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

function Drawer({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Manual Entry View (advanced, same layout) ---------------- */
function ManualEntryView({ loading, onCreate, onAfterCreate, setToast }) {
  const [mode, setMode] = useState("return"); // return | exchange | refund
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  // Order lookup (auto)
  const [ol, setOl] = useState({
    loading: false,
    ok: false,
    error: "",
    order: null,
  });

  // Item selection (customer-form compatible concept)
  const [sel, setSel] = useState({}); // { [itemId]: { on: bool, qty: number } }

  // debounce for order lookup
  const debounceRef = useRef(null);

  const resetSelection = useCallback(() => setSel({}), []);
  const setItemOn = useCallback((itemId, on) => {
    setSel((s) => {
      const next = { ...(s || {}) };
      const cur = next[itemId] || { on: false, qty: 1 };
      next[itemId] = { ...cur, on: !!on, qty: Math.max(1, n(cur.qty, 1)) };
      return next;
    });
  }, []);
  const setItemQty = useCallback((itemId, qty, maxQty) => {
    const q = Math.max(1, Math.min(Math.floor(n(qty, 1)), Math.max(1, n(maxQty, 1))));
    setSel((s) => {
      const next = { ...(s || {}) };
      const cur = next[itemId] || { on: false, qty: 1 };
      next[itemId] = { ...cur, qty: q };
      return next;
    });
  }, []);

  const selectedItems = useMemo(() => {
    const items = ol?.order?.items || [];
    const out = [];
    for (const it of items) {
      const st = sel?.[it.id];
      if (st?.on) out.push({ ...it, pickQty: Math.max(1, n(st.qty, 1)) });
    }
    return out;
  }, [ol, sel]);

  useEffect(() => {
    const v = String(orderId || "").trim();

    setOl((s) => ({
      loading: s.loading,
      ok: false,
      error: "",
      order: v ? s.order : null,
    }));
    resetSelection();

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v) return;

    debounceRef.current = setTimeout(async () => {
      setOl({ loading: true, ok: false, error: "", order: null });
      try {
        const order = await fetchOrderSnapshotBestEffort(v);
        setOl({ loading: false, ok: true, error: "", order });
      } catch (e) {
        setOl({
          loading: false,
          ok: false,
          error: e?.message || "Order lookup failed.",
          order: null,
        });
      }
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [orderId, resetSelection]);

  const mustSelectItems = useMemo(() => {
    if (mode === "refund") return false;
    if (!ol?.ok || !ol?.order) return false;
    const hasItems = Array.isArray(ol.order.items) && ol.order.items.length > 0;
    return hasItems;
  }, [mode, ol]);

  const numericInputNeedsResolution = useMemo(() => {
    const raw = String(orderId || "").trim().replace(/^#/, "").trim();
    const isNumeric = /^\d+$/.test(raw);
    // If staff typed "46" and we did NOT resolve an order snapshot, creation will fail on server (ORDER_NOT_FOUND).
    return isNumeric && !ol?.ok;
  }, [orderId, ol?.ok]);

  const canSubmit = useMemo(() => {
    if (!orderId.trim()) return false;

    // Prevent guaranteed server failure for numeric order numbers that could not be resolved
    if (numericInputNeedsResolution) return false;

    if (mode === "refund") return n(amount, 0) > 0;

    // If we have items, require explicit selection (prevents wrong manual records)
    if (mustSelectItems) return selectedItems.length > 0;
    return true;
  }, [mode, orderId, amount, mustSelectItems, selectedItems.length, numericInputNeedsResolution]);

  const submit = useCallback(async () => {
    const rawInput = String(orderId || "").trim();
    const cleaned = rawInput.replace(/^#/, "").trim();

    // If staff typed Order # (46), server create route expects real Order.id (UUID).
    // If we matched the order, use canonical order.id for payload.orderId.
    const canonicalOrderId = String(ol?.ok && ol?.order?.id ? ol.order.id : cleaned).trim();

    try {
      const base =
        mode === "refund"
          ? {
              orderId: canonicalOrderId,
              amount: n(amount, 0),
              reason: reason.trim() || null,
              note: note.trim() || null,
            }
          : {
              orderId: canonicalOrderId,
              reason: reason.trim() || null,
              note: note.trim() || null,
            };

      // Item specificity:
      // Send items if selected; if server rejects strict schema, retry once without items.
      const withItems =
        selectedItems.length > 0
          ? {
              ...base,
              items: selectedItems.map((it) => ({
                orderItemId: it.id,
                qty: it.pickQty,
                sku: it.sku || null,
                size: it.size || null,
                color: it.color || null,
                name: it.name || null,
              })),
            }
          : base;

      const tryCreate = async (payload) => onCreate(mode, payload);

      try {
        await tryCreate(withItems);
      } catch (e) {
        const msg = String(e?.message || "");
        const looksStrict =
          msg.toLowerCase().includes("unknown") ||
          msg.toLowerCase().includes("unexpected") ||
          msg.toLowerCase().includes("validation") ||
          msg.toLowerCase().includes("invalid");

        if (selectedItems.length > 0 && looksStrict) {
          await tryCreate(base);
        } else {
          throw e;
        }
      }

      setOrderId("");
      setAmount("");
      setReason("");
      setNote("");
      setOl({ loading: false, ok: false, error: "", order: null });
      setSel({});

      setToast?.({
        tone: "success",
        title: "SUCCESS",
        message:
          mode === "refund"
            ? "REFUND CASE CREATED."
            : mode === "exchange"
              ? "EXCHANGE CASE CREATED."
              : "RETURN CASE CREATED.",
      });

      onAfterCreate?.();
    } catch (e) {
      setToast?.({
        tone: "error",
        title: "CREATE FAILED",
        message: e?.message || "FAILED",
      });
    }
  }, [mode, orderId, amount, reason, note, selectedItems, onCreate, onAfterCreate, setToast, ol]);

  const orderHeader = useMemo(() => {
    const o = ol?.order;
    if (!o) return null;

    const id = safeText(o.id);
    const no = o.orderNumber ? `#${o.orderNumber}` : null;
    const st = safeText(o.status);
    const pay = o.paymentStatus ? safeText(o.paymentStatus) : null;
    const ful = o.fulfillmentStatus ? safeText(o.fulfillmentStatus) : null;

    return { id, no, st, pay, ful };
  }, [ol]);

  return (
    <div className="manual">
      <div className="manual-top">
        <div className="manual-title">Manual input</div>
        <div className="manual-sub">
          Type an <b>Order ID / Order #</b> to auto-load <b>item-specific</b> order info. Then create
          a Return/Exchange/Refund <b>case</b> so it appears in the R/E/R lanes for processing.
        </div>
      </div>

      <div className="manual-grid">
        <div className="field">
          <div className="lbl">Mode</div>
          <select
            className="inp"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={loading}
          >
            <option value="return">Return</option>
            <option value="exchange">Exchange</option>
            <option value="refund">Refund</option>
          </select>
        </div>

        <div className="field">
          <div className="lbl">Order ID</div>
          <input
            className="inp"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="Paste Order UUID or Order # (e.g., 46)"
            disabled={loading}
          />
        </div>

        {mode === "refund" ? (
          <div className="field">
            <div className="lbl">Amount (BDT)</div>
            <input
              className="inp"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g., 1500"
              disabled={loading}
            />
          </div>
        ) : (
          <div className="field">
            <div className="lbl">Reason</div>
            <input
              className="inp"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              disabled={loading}
            />
          </div>
        )}

        <div className="field">
          <div className="lbl">Note</div>
          <input
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal note (optional)"
            disabled={loading}
          />
        </div>
      </div>

      {/* Auto order snapshot */}
      <div className="manual-order">
        <div className="manual-order-head">
          <div className="manual-order-title">Matched order (auto)</div>
          <div className="manual-order-sub">
            {ol.loading ? (
              <span className="manual-status warn">LOOKING UP ORDER…</span>
            ) : ol.ok && ol.order ? (
              <span className="manual-status ok">ORDER FOUND</span>
            ) : orderId.trim() ? (
              <span className="manual-status bad">
                {ol.error ? `NOT FOUND • ${ol.error}` : "NOT FOUND"}
              </span>
            ) : (
              <span className="manual-status neutral">ENTER ORDER ID TO LOAD ITEMS</span>
            )}
          </div>
        </div>

        {numericInputNeedsResolution ? (
          <div className="err" style={{ marginTop: 10 }}>
            <b>Action blocked:</b> You typed an Order #, but the system could not resolve it to the real Order ID (UUID).
            Please paste the Order UUID or fix the order lookup endpoint so items can load.
          </div>
        ) : null}

        {ol.ok && ol.order ? (
          <>
            <div className="manual-order-meta">
              <div className="meta-row">
                <div className="meta-k">Order</div>
                <div className="meta-v mono">
                  {orderHeader?.no ? `${orderHeader.no} • ` : ""}
                  {orderHeader?.id}
                </div>
              </div>

              <div className="meta-row">
                <div className="meta-k">Status</div>
                <div className="meta-v">
                  <span className={cx("badge", badgeTone(orderHeader?.st))}>
                    {safeText(orderHeader?.st)}
                  </span>
                  {orderHeader?.pay ? <span className="meta-pill">PAY: {orderHeader.pay}</span> : null}
                  {orderHeader?.ful ? <span className="meta-pill">FULFILL: {orderHeader.ful}</span> : null}
                </div>
              </div>

              <div className="meta-row">
                <div className="meta-k">Dates</div>
                <div className="meta-v mono">
                  Created: {ol.order.createdAt ? isoDate(ol.order.createdAt) : "—"}
                  {" • "}
                  Delivered: {ol.order.deliveredAt ? isoDate(ol.order.deliveredAt) : "—"}
                </div>
              </div>

              <div className="meta-row">
                <div className="meta-k">Customer</div>
                <div className="meta-v">
                  {ol.order.customer?.name ? <span className="meta-pill">{ol.order.customer.name}</span> : null}
                  {ol.order.customer?.phone ? <span className="meta-pill">{ol.order.customer.phone}</span> : null}
                  {ol.order.customer?.email ? <span className="meta-pill">{ol.order.customer.email}</span> : null}
                  {!ol.order.customer ? <span className="dim">—</span> : null}
                </div>
              </div>

              <div className="meta-row">
                <div className="meta-k">Totals</div>
                <div className="meta-v mono">
                  {ol.order.totals?.subtotal != null ? `Subtotal ${moneyBDT(ol.order.totals.subtotal)} • ` : ""}
                  {ol.order.totals?.shipping != null ? `Shipping ${moneyBDT(ol.order.totals.shipping)} • ` : ""}
                  {ol.order.totals?.discount != null ? `Discount ${moneyBDT(ol.order.totals.discount)} • ` : ""}
                  {ol.order.totals?.total != null ? `Total ${moneyBDT(ol.order.totals.total)}` : "Total —"}
                </div>
              </div>
            </div>

            <div className="manual-items">
              <div className="manual-items-head">
                <div className="manual-items-title">
                  Items (select what to{" "}
                  {mode === "exchange" ? "exchange" : mode === "refund" ? "refund" : "return"})
                </div>
                {mustSelectItems ? (
                  <div className="manual-items-note">
                    <span className="manual-status warn">SELECT AT LEAST ONE ITEM</span>
                  </div>
                ) : (
                  <div className="manual-items-note dim">
                    {mode === "refund"
                      ? "Optional: select items for clarity even for refunds."
                      : "If your order endpoint does not provide items, you can still create a case without selection."}
                  </div>
                )}
              </div>

              {Array.isArray(ol.order.items) && ol.order.items.length ? (
                <div className="manual-items-list">
                  {ol.order.items.map((it) => {
                    const picked = !!sel?.[it.id]?.on;
                    const pickQty = n(sel?.[it.id]?.qty ?? 1, 1);
                    const maxQty = Math.max(1, n(it.qty, 1));

                    return (
                      <div key={it.id} className={cx("mi-row", picked && "mi-picked")}>
                        <label className="mi-left">
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={(e) => setItemOn(it.id, e.target.checked)}
                          />
                          <span className="mi-name">{safeText(it.name)}</span>
                        </label>

                        <div className="mi-mid">
                          {it.sku ? <span className="mi-pill">SKU: {it.sku}</span> : null}
                          {it.color ? <span className="mi-pill">Color: {it.color}</span> : null}
                          {it.size ? <span className="mi-pill">Size: {it.size}</span> : null}
                          {it.itemStatus ? <span className="mi-pill">Item: {it.itemStatus}</span> : null}
                          {it.deliveredQty != null ? (
                            <span className="mi-pill">Delivered: {it.deliveredQty}</span>
                          ) : null}
                        </div>

                        <div className="mi-right mono">
                          <div className="mi-qtyline">
                            <span className="mi-qtylbl">Qty</span>
                            <input
                              className="mi-qty"
                              value={String(pickQty)}
                              onChange={(e) => setItemQty(it.id, e.target.value, maxQty)}
                              disabled={!picked}
                              inputMode="numeric"
                            />
                            <span className="mi-max">/ {maxQty}</span>
                          </div>
                          <div className="mi-price">
                            {it.unitPrice != null ? `Unit ${moneyBDT(it.unitPrice)}` : "Unit —"}
                            {" • "}
                            {it.lineTotal != null ? `Line ${moneyBDT(it.lineTotal)}` : "Line —"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty" style={{ padding: "12px 0" }}>
                  No item lines found in the matched order payload.
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>

      <div className="manual-actions">
        <button className="pond pond-primary" onClick={submit} disabled={loading || !canSubmit}>
          Create R/E/R case
        </button>

        <div className="dim">
          This creates a database case record so staff can track and process Return / Exchange / Refund.
          {mustSelectItems && selectedItems.length === 0 ? (
            <>
              {" "}
              <span className="manual-inline-warn">SELECT ITEMS TO PROCEED.</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------- main panel ---------------- */
export default function RerPanel({ className, defaultTab = "overview", onOpenOrderId }) {
  const [tab, setTab] = useState(defaultTab);

  // Data
  const [overview, setOverview] = useState(null);
  const [returns, setReturns] = useState([]);
  const [exchanges, setExchanges] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [total, setTotal] = useState(null);

  // UX states
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Toast (success/error message after EVERY action)
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const pushToast = useCallback((t) => {
    setToast(t);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Filters (draft -> apply)
  const [draft, setDraft] = useState({ q: "", status: "", from: "", to: "" });
  const [filters, setFilters] = useState({ q: "", status: "", from: "", to: "" });

  const [page, setPage] = useState(1);
  const take = 20;

  // Details drawer
  const [selected, setSelected] = useState(null); // { lane, record }
  const closeDrawer = useCallback(() => setSelected(null), []);

  // Busy map for action buttons
  const busyRef = useRef(new Set()); // `${lane}:${id}:${action}`
  const [, forceBusyTick] = useState(0);
  const isBusy = useCallback((key) => busyRef.current.has(key), []);
  const setBusy = useCallback((key, on) => {
    const s = busyRef.current;
    if (on) s.add(key);
    else s.delete(key);
    forceBusyTick((x) => x + 1);
  }, []);

  const lane = useMemo(() => {
    if (tab === "returns") return "returns";
    if (tab === "exchanges") return "exchanges";
    if (tab === "refunds") return "refunds";
    return "overview";
  }, [tab]);

  const statusOptions = useMemo(() => laneStatusOptions(lane), [lane]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.q.trim()) p.set("q", filters.q.trim());
    if (filters.status) p.set("status", filters.status);
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    p.set("take", String(take));
    p.set("page", String(page));
    return p.toString();
  }, [filters, page]);

  const items = useMemo(() => {
    if (tab === "returns") return returns;
    if (tab === "exchanges") return exchanges;
    if (tab === "refunds") return refunds;
    return [];
  }, [tab, returns, exchanges, refunds]);

  const applyFilters = useCallback(() => {
    setFilters({
      q: draft.q,
      status: draft.status,
      from: draft.from,
      to: draft.to,
    });
    setPage(1);
  }, [draft]);

  const clearFilters = useCallback(() => {
    const cleared = { q: "", status: "", from: "", to: "" };
    setDraft(cleared);
    setFilters(cleared);
    setPage(1);
  }, []);

  const load = useCallback(async () => {
    setErr("");
    setLoading(true);

    try {
      if (tab === "overview") {
        const data = await jfetch(`/api/admin/rer/export?summary=1`, { method: "GET" });
        setOverview(data?.summary || null);
        setTotal(null);
      } else if (tab === "returns") {
        const data = await jfetch(`/api/admin/rer/returns?${qs}`, { method: "GET" });
        setReturns(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : null);
      } else if (tab === "exchanges") {
        const data = await jfetch(`/api/admin/rer/exchanges?${qs}`, { method: "GET" });
        setExchanges(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : null);
      } else if (tab === "refunds") {
        const data = await jfetch(`/api/admin/rer/refunds?${qs}`, { method: "GET" });
        setRefunds(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : null);
      } else {
        setTotal(null);
      }
    } catch (e) {
      setErr(e?.message || "FAILED");
    } finally {
      setLoading(false);
    }
  }, [tab, qs]);

  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const doAction = useCallback(
    async (laneName, id, action, payload) => {
      const key = `${laneName}:${id}:${action}`;
      if (isBusy(key)) return;

      setBusy(key, true);
      setErr("");

      const mutationId = mkMutationId();
      const url =
        laneName === "returns"
          ? `/api/admin/rer/returns/${encodeURIComponent(id)}`
          : laneName === "exchanges"
            ? `/api/admin/rer/exchanges/${encodeURIComponent(id)}`
            : `/api/admin/rer/refunds/${encodeURIComponent(id)}`;

      try {
        await jfetch(url, {
          method: "PATCH",
          headers: { "x-idempotency-key": mutationId },
          body: JSON.stringify({ action, ...(payload || {}) }),
        });

        pushToast({
          tone: "success",
          title: "SUCCESS",
          message: `${laneName.toUpperCase()} • ${action.toUpperCase()} EXECUTED.`,
        });

        await load();
      } catch (e) {
        const msg = e?.message || "FAILED";
        setErr(msg);
        pushToast({
          tone: "error",
          title: "FAILED",
          message: msg,
        });
      } finally {
        setBusy(key, false);
      }
    },
    [isBusy, setBusy, load, pushToast]
  );

  const createManual = useCallback(async (mode, payload) => {
    const mutationId = mkMutationId();

    if (mode === "refund") {
      return jfetch(`/api/admin/rer/refunds`, {
        method: "POST",
        headers: { "x-idempotency-key": mutationId },
        body: JSON.stringify(payload),
      });
    }
    if (mode === "exchange") {
      return jfetch(`/api/admin/rer/exchanges`, {
        method: "POST",
        headers: { "x-idempotency-key": mutationId },
        body: JSON.stringify(payload),
      });
    }
    return jfetch(`/api/admin/rer/returns`, {
      method: "POST",
      headers: { "x-idempotency-key": mutationId },
      body: JSON.stringify(payload),
    });
  }, []);

  const canPrev = page > 1;
  const canNext = useMemo(() => {
    if (loading) return false;
    if (total == null) return items.length >= take;
    return page * take < total;
  }, [loading, total, page, items.length]);

  return (
    <section className={cx("w-full", className)}>
      <div className="rer-shell">
        <div className="rer-head">
          <div>
            <div className="rer-title">Returns / Exchanges / Refunds</div>
            <div className="rer-sub">
              Queue health, approvals, fulfillment, refunds — in one premium workstation.
            </div>
          </div>

          <div className="rer-cta-row">
            <button className="pond pond-secondary" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className="pond pond-primary" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>

        <div className="tabs">
          <TabPill active={tab === "overview"} onClick={() => setTab("overview")}>
            Overview
          </TabPill>
          <TabPill active={tab === "returns"} onClick={() => setTab("returns")}>
            Returns
          </TabPill>
          <TabPill active={tab === "exchanges"} onClick={() => setTab("exchanges")}>
            Exchanges
          </TabPill>
          <TabPill active={tab === "refunds"} onClick={() => setTab("refunds")}>
            Refunds
          </TabPill>
          <TabPill active={tab === "manual"} onClick={() => setTab("manual")}>
            Manual Input
          </TabPill>
        </div>

        {toast ? (
          <div className="toast-wrap">
            <ToastBar
              tone={toast.tone}
              title={toast.title}
              message={toast.message}
              onClose={() => setToast(null)}
            />
          </div>
        ) : null}

        {err ? (
          <div className="err">
            <b>Last error:</b> {err}
          </div>
        ) : null}

        {tab !== "overview" && tab !== "manual" ? (
          <div className="filters">
            <div className="frow">
              <div className="field">
                <div className="lbl">Search</div>
                <input
                  className="inp"
                  value={draft.q}
                  onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                  placeholder="Search by request ID, order ID…"
                  disabled={loading}
                />
              </div>

              <div className="field">
                <div className="lbl">Status</div>
                <select
                  className="inp"
                  value={draft.status}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                  disabled={loading}
                >
                  <option value="">All</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="lbl">From</div>
                <input
                  className="inp"
                  type="date"
                  value={draft.from}
                  onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                  disabled={loading}
                />
              </div>

              <div className="field">
                <div className="lbl">To</div>
                <input
                  className="inp"
                  type="date"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="frow2">
              <div className="mini">
                Page <b>{page}</b> • Showing <b>{items.length}</b>
                {typeof total === "number" ? (
                  <>
                    {" "}
                    • Total <b>{total}</b>
                  </>
                ) : null}
              </div>

              <div className="pager">
                <button className="pond pond-secondary" onClick={applyFilters} disabled={loading}>
                  Apply
                </button>
                <button
                  className="pond pond-secondary"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || !canPrev}
                >
                  Prev
                </button>
                <button
                  className="pond pond-secondary"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={loading || !canNext}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "overview" ? (
          <div className="grid">
            <MetricCard title="Returns pending" value={n(overview?.returns?.requested, 0)} sub="REQUESTED" />
            <MetricCard title="Exchanges pending" value={n(overview?.exchanges?.requested, 0)} sub="REQUESTED" />
            <MetricCard title="Refunds pending" value={n(overview?.refunds?.initiated, 0)} sub="INITIATED" />
            <MetricCard title="Refunds processed" value={n(overview?.refunds?.processed, 0)} sub="PROCESSED" />
          </div>
        ) : null}

        {tab === "returns" || tab === "exchanges" || tab === "refunds" ? (
          <div className="list">
            <div className="list-head">
              <div>Request</div>
              <div>Order</div>
              <div>Status</div>
              <div>Created</div>
              <div className="right">Actions</div>
            </div>

            {items.map((r, idx) => {
              const id = String(r?.id || "");
              const orderId = String(r?.orderId || "");
              const st = String(r?.status || "");
              const createdAt = r?.createdAt ? isoDate(r.createdAt) : "—";

              const allowed = allowedActions(tab, st);

              const openDetails = () => {
                setSelected({ lane: tab, record: r, idx });
              };

              return (
                <div
                  key={id || `row-${idx}`}
                  className="row row-click"
                  onClick={openDetails}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") openDetails();
                  }}
                >
                  <div className="mono">
                    <div className="strong">#{id ? id.slice(-6) : "—"}</div>
                    <div className="dim">ID: {safeText(id)}</div>
                  </div>

                  <div className="mono">
                    <button
                      className="link"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenOrderId && orderId) onOpenOrderId(orderId);
                      }}
                      title={orderId}
                      type="button"
                    >
                      {orderId ? orderId.slice(0, 10) + "…" : "—"}
                    </button>
                  </div>

                  <div>
                    <span className={cx("badge", badgeTone(st))}>{st || "—"}</span>
                  </div>

                  <div className="dim">{createdAt}</div>

                  <div className="right acts" onClick={(e) => e.stopPropagation()}>
                    {tab === "returns" ? (
                      <>
                        <PondAction
                          label="Approve"
                          tone="primary"
                          disabled={!allowed.approve || isBusy(`returns:${id}:approve`) || loading}
                          onClick={() => doAction("returns", id, "approve")}
                        />
                        <PondAction
                          label="Deny"
                          tone="danger"
                          disabled={!allowed.deny || isBusy(`returns:${id}:deny`) || loading}
                          onClick={() => doAction("returns", id, "deny")}
                        />
                        <PondAction
                          label="Received"
                          tone="secondary"
                          disabled={!allowed.received || isBusy(`returns:${id}:received`) || loading}
                          onClick={() => doAction("returns", id, "received")}
                        />
                        <PondAction
                          label="Refunded"
                          tone="secondary"
                          disabled={!allowed.refunded || isBusy(`returns:${id}:refunded`) || loading}
                          onClick={() => doAction("returns", id, "refunded")}
                        />
                      </>
                    ) : tab === "exchanges" ? (
                      <>
                        <PondAction
                          label="Approve"
                          tone="primary"
                          disabled={!allowed.approve || isBusy(`exchanges:${id}:approve`) || loading}
                          onClick={() => doAction("exchanges", id, "approve")}
                        />
                        <PondAction
                          label="Deny"
                          tone="danger"
                          disabled={!allowed.deny || isBusy(`exchanges:${id}:deny`) || loading}
                          onClick={() => doAction("exchanges", id, "deny")}
                        />
                        <PondAction
                          label="Fulfilled"
                          tone="secondary"
                          disabled={!allowed.fulfilled || isBusy(`exchanges:${id}:fulfilled`) || loading}
                          onClick={() => doAction("exchanges", id, "fulfilled")}
                        />
                      </>
                    ) : (
                      <>
                        <PondAction
                          label="Process"
                          tone="primary"
                          disabled={!allowed.process || isBusy(`refunds:${id}:process`) || loading}
                          onClick={() => doAction("refunds", id, "process")}
                        />
                        <PondAction
                          label="Fail"
                          tone="danger"
                          disabled={!allowed.fail || isBusy(`refunds:${id}:fail`) || loading}
                          onClick={() => doAction("refunds", id, "fail")}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {items.length === 0 ? <div className="empty">No records found for this lane/window.</div> : null}
          </div>
        ) : null}

        {tab === "manual" ? (
          <ManualEntryView
            loading={loading}
            onCreate={createManual}
            onAfterCreate={() => {
              setTab("overview");
            }}
            setToast={pushToast}
          />
        ) : null}
      </div>

      <Drawer
        open={!!selected}
        title={selected ? `${String(selected.lane || "").toUpperCase()} • Details` : "Details"}
        onClose={closeDrawer}
      >
        {selected ? (
          <DetailsView
            lane={selected.lane}
            record={selected.record}
            loading={loading}
            isBusy={isBusy}
            doAction={doAction}
            onOpenOrderId={onOpenOrderId}
            pushToast={pushToast}
          />
        ) : null}
      </Drawer>

      <style>{`
        /* (UNCHANGED STYLES — preserved exactly from your current file) */
        .rer-shell{
          background:#fff;
          border:1px solid ${BORDER};
          border-radius:20px;
          box-shadow:0 18px 54px rgba(15,33,71,.12);
          padding:18px 18px;
        }
        .rer-head{
          display:flex; gap:14px;
          align-items:flex-start; justify-content:space-between;
          flex-wrap:wrap;
        }
        .rer-title{
          font-size:18px; font-weight:1000; color:${NAVY};
          letter-spacing:.01em;
        }
        .rer-sub{
          margin-top:4px;
          font-size:12px;
          color:${MUTED};
          font-weight:700;
        }
        .rer-cta-row{
          display:flex; gap:10px; flex-wrap:wrap;
          align-items:center;
        }

        .tabs{
          display:flex; gap:10px; flex-wrap:wrap;
          margin-top:14px;
          padding:10px;
          border:1px solid ${BORDER};
          border-radius:999px;
          background:linear-gradient(180deg,#fff 0%, #F7FAFC 100%);
        }
        .tab{
          border-radius:999px;
          padding:12px 16px;
          font-weight:1000;
          font-size:13px;
          border:1px solid rgba(15,33,71,.18);
          background:linear-gradient(180deg,#ffffff 0%, #f7fafc 100%);
          color:${NAVY};
          box-shadow:0 10px 24px rgba(15,33,71,.10), inset 0 1px 0 rgba(255,255,255,.7);
          transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease, filter .16s ease;
          user-select:none;
          cursor:pointer;
        }
        .tab:hover{
          transform: translateY(-2px);
          box-shadow:0 18px 42px rgba(15,33,71,.16), inset 0 1px 0 rgba(255,255,255,.75);
          border-color: rgba(15,33,71,.30);
          filter:saturate(1.05);
        }
        .tab:active{ transform: translateY(0px) scale(.99); }
        .tab.active{
          border-color: rgba(212,175,55,.55);
          background: linear-gradient(180deg, rgba(212,175,55,.20) 0%, rgba(212,175,55,.10) 100%);
        }

        .pond{
          border-radius:999px;
          padding:12px 16px;
          font-weight:1000;
          font-size:13px;
          border:1px solid rgba(15,33,71,.18);
          background:linear-gradient(180deg,#ffffff 0%, #f7fafc 100%);
          color:${NAVY};
          box-shadow:0 10px 24px rgba(15,33,71,.12), inset 0 1px 0 rgba(255,255,255,.7);
          transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease, filter .16s ease;
          cursor:pointer;
          user-select:none;
        }
        .pond:hover{
          transform: translateY(-2px);
          box-shadow:0 18px 42px rgba(15,33,71,.16), inset 0 1px 0 rgba(255,255,255,.75);
          border-color: rgba(15,33,71,.30);
          filter:saturate(1.05);
        }
        .pond:active{ transform: translateY(0px) scale(.99); }
        .pond:disabled{ opacity:.55; cursor:not-allowed; transform:none; }
        .pond-primary{
          background: linear-gradient(180deg, ${NAVY} 0%, #0b1a39 100%);
          color:#fff;
          border-color: rgba(15,33,71,.55);
        }
        .pond-secondary{
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
          color:${NAVY};
        }
        .pond-danger{
          border-color: rgba(239,68,68,.28);
          background: rgba(239,68,68,.06);
          color: #7f1d1d;
        }

        .toast-wrap{ margin-top:12px; }
        .toast{
          border-radius:16px;
          padding:12px 14px;
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:12px;
          border:1px solid ${BORDER};
          box-shadow:0 16px 44px rgba(15,33,71,.10);
          background:#fff;
        }
        .toast-ok{
          border-color: rgba(34,197,94,.28);
          background: linear-gradient(180deg, rgba(34,197,94,.14) 0%, #ffffff 100%);
        }
        .toast-error{
          border-color: rgba(239,68,68,.28);
          background: linear-gradient(180deg, rgba(239,68,68,.14) 0%, #ffffff 100%);
        }
        .toast-title{
          font-weight:1000;
          color:#0f172a;
          font-size:14px;
          letter-spacing:.02em;
        }
        .toast-msg{
          margin-top:4px;
          font-weight:1000; /* VERY BOLD */
          font-size:13px;
          letter-spacing:.01em;
          color:#0f172a;
        }
        .toast-ok .toast-msg{ color:#065f46; }
        .toast-error .toast-msg{ color:#7f1d1d; }
        .toast-x{
          border:0;
          background:transparent;
          cursor:pointer;
          font-weight:1000;
          color:${MUTED};
          font-size:18px;
          line-height:1;
        }

        .err{
          margin-top:12px;
          border:1px solid rgba(239,68,68,.25);
          background: rgba(239,68,68,.06);
          color:#7f1d1d;
          border-radius:14px;
          padding:12px 14px;
          font-weight:900;
          font-size:13px;
          white-space:pre-line;
        }

        .filters{
          margin-top:12px;
          border:1px solid ${BORDER};
          border-radius:18px;
          padding:12px 12px;
          background:#fff;
        }
        .frow{
          display:grid;
          grid-template-columns: 1.4fr .8fr .7fr .7fr;
          gap:10px;
        }
        .frow2{
          margin-top:10px;
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
          flex-wrap:wrap;
        }
        .field .lbl{
          font-size:11px;
          font-weight:1000;
          letter-spacing:.06em;
          text-transform:uppercase;
          color:${MUTED};
          margin-bottom:6px;
        }
        .inp{
          width:100%;
          border-radius:14px;
          border:1px solid ${BORDER};
          background:#fff;
          padding:12px 12px;
          font-size:13px;
          font-weight:900;
          color:#0f172a;
          outline:none;
          transition: box-shadow .16s ease, border-color .16s ease;
        }
        .inp:focus{
          border-color: rgba(212,175,55,.55);
          box-shadow: 0 0 0 4px rgba(212,175,55,.18);
        }

        .grid{
          margin-top:14px;
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap:12px;
        }
        .card{
          border:1px solid ${BORDER};
          border-radius:18px;
          background:linear-gradient(180deg,#fff 0%, #F7FAFC 100%);
          box-shadow:0 14px 34px rgba(15,33,71,.10);
          padding:14px 14px;
        }
        .card .t{ font-size:12px; font-weight:1000; color:${MUTED}; text-transform:uppercase; letter-spacing:.08em; }
        .card .v{ margin-top:8px; font-size:22px; font-weight:1000; color:${NAVY}; }
        .card .s{ margin-top:2px; font-size:12px; font-weight:800; color:${MUTED}; }

        .list{
          margin-top:14px;
          border:1px solid ${BORDER};
          border-radius:18px;
          overflow:hidden;
          background:#fff;
        }
        .list-head{
          display:grid;
          grid-template-columns: 1.2fr .8fr .6fr .7fr 1.4fr;
          gap:10px;
          padding:12px 14px;
          background:linear-gradient(180deg,#0f21470d 0%, #ffffff 100%);
          font-size:12px;
          font-weight:1000;
          color:${NAVY};
          letter-spacing:.06em;
          text-transform:uppercase;
        }
        .row{
          display:grid;
          grid-template-columns: 1.2fr .8fr .6fr .7fr 1.4fr;
          gap:10px;
          padding:12px 14px;
          border-top:1px solid ${BORDER};
          align-items:center;
        }
        .row-click{
          cursor:pointer;
          transition: background .14s ease;
        }
        .row-click:hover{
          background: #f8fafc;
        }
        .mono{ font-variant-numeric: tabular-nums; font-feature-settings:"tnum"; }
        .strong{ font-weight:1000; color:#0f172a; }
        .dim{ font-size:12px; font-weight:800; color:${MUTED}; }
        .right{ text-align:right; }
        .acts{ display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }
        .badge{
          display:inline-flex; align-items:center;
          border-radius:999px;
          padding:8px 10px;
          font-size:12px;
          font-weight:1000;
          border:1px solid ${BORDER};
          background:#fff;
          color:${NAVY};
        }
        .badge.ok{ border-color: rgba(34,197,94,.25); background: rgba(34,197,94,.08); color:#065f46; }
        .badge.warn{ border-color: rgba(245,158,11,.25); background: rgba(245,158,11,.10); color:#7c2d12; }
        .badge.bad{ border-color: rgba(239,68,68,.25); background: rgba(239,68,68,.08); color:#7f1d1d; }

        .link{
          background:transparent;
          border:0;
          padding:0;
          cursor:pointer;
          font-weight:1000;
          color:${NAVY};
          text-decoration:underline;
          text-underline-offset: 4px;
        }

        .empty{
          padding:18px 14px;
          color:${MUTED};
          font-weight:900;
        }

        .manual{
          margin-top:14px;
          border:1px solid ${BORDER};
          border-radius:18px;
          padding:14px 14px;
          background:#fff;
        }
        .manual-top{ margin-bottom:10px; }
        .manual-title{ font-weight:1000; color:${NAVY}; font-size:14px; }
        .manual-sub{ margin-top:3px; font-size:12px; font-weight:800; color:${MUTED}; }
        .manual-grid{
          display:grid;
          grid-template-columns: .7fr 1.1fr .8fr 1.2fr;
          gap:10px;
        }
        .manual-actions{
          margin-top:12px;
          display:flex;
          gap:12px;
          align-items:center;
          flex-wrap:wrap;
        }
        .manual-inline-warn{
          margin-left:6px;
          font-weight:1000;
          color:#7c2d12;
        }

        .manual-order{
          margin-top:12px;
          border-top:1px solid ${BORDER};
          padding-top:12px;
        }
        .manual-order-head{
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:10px;
          flex-wrap:wrap;
        }
        .manual-order-title{
          font-weight:1000;
          color:${NAVY};
          font-size:13px;
        }
        .manual-order-sub{ font-size:12px; font-weight:900; }
        .manual-status{
          display:inline-flex;
          align-items:center;
          border-radius:999px;
          padding:8px 10px;
          font-weight:1000;
          letter-spacing:.04em;
          border:1px solid ${BORDER};
          background:#fff;
        }
        .manual-status.ok{ border-color: rgba(34,197,94,.26); background: rgba(34,197,94,.10); color:#065f46; }
        .manual-status.bad{ border-color: rgba(239,68,68,.26); background: rgba(239,68,68,.10); color:#7f1d1d; }
        .manual-status.warn{ border-color: rgba(245,158,11,.26); background: rgba(245,158,11,.12); color:#7c2d12; }
        .manual-status.neutral{ color:${MUTED}; background:#f8fafc; }

        .manual-order-meta{
          margin-top:10px;
          border:1px solid ${BORDER};
          border-radius:16px;
          padding:12px 12px;
          background:linear-gradient(180deg,#fff 0%, #F7FAFC 100%);
          box-shadow:0 12px 30px rgba(15,33,71,.08);
        }
        .meta-row{
          display:flex;
          gap:10px;
          align-items:flex-start;
          padding:6px 0;
          border-top:1px dashed rgba(100,116,139,.18);
        }
        .meta-row:first-child{ border-top:0; padding-top:0; }
        .meta-k{
          width:110px;
          font-size:11px;
          font-weight:1000;
          color:${MUTED};
          letter-spacing:.06em;
          text-transform:uppercase;
        }
        .meta-v{
          flex:1;
          font-weight:1000;
          color:#0f172a;
          font-size:13px;
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          align-items:center;
        }
        .meta-pill{
          border:1px solid rgba(15,33,71,.16);
          background:#fff;
          border-radius:999px;
          padding:6px 10px;
          font-weight:1000;
          font-size:12px;
          color:${NAVY};
        }

        .manual-items{
          margin-top:10px;
        }
        .manual-items-head{
          display:flex;
          justify-content:space-between;
          align-items:flex-start;
          gap:10px;
          flex-wrap:wrap;
        }
        .manual-items-title{
          font-weight:1000;
          color:${NAVY};
          font-size:13px;
        }
        .manual-items-note{ font-size:12px; font-weight:900; }

        .manual-items-list{
          margin-top:10px;
          border:1px solid ${BORDER};
          border-radius:16px;
          overflow:hidden;
          background:#fff;
        }
        .mi-row{
          display:grid;
          grid-template-columns: 1.2fr 1.2fr 1fr;
          gap:10px;
          padding:12px 12px;
          border-top:1px solid ${BORDER};
          align-items:center;
        }
        .mi-row:first-child{ border-top:0; }
        .mi-picked{
          background: linear-gradient(180deg, rgba(212,175,55,.12) 0%, rgba(255,255,255,1) 100%);
        }
        .mi-left{
          display:flex;
          gap:10px;
          align-items:center;
          font-weight:1000;
          color:#0f172a;
        }
        .mi-name{ font-weight:1000; }
        .mi-mid{
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          align-items:center;
        }
        .mi-pill{
          border:1px solid rgba(15,33,71,.14);
          background:#fff;
          border-radius:999px;
          padding:6px 10px;
          font-weight:1000;
          font-size:12px;
          color:${NAVY};
        }
        .mi-right{
          display:flex;
          flex-direction:column;
          gap:6px;
          align-items:flex-end;
        }
        .mi-qtyline{
          display:flex;
          align-items:center;
          gap:6px;
        }
        .mi-qtylbl{
          font-weight:1000;
          color:${MUTED};
          font-size:12px;
        }
        .mi-qty{
          width:64px;
          border-radius:12px;
          border:1px solid ${BORDER};
          padding:8px 10px;
          font-weight:1000;
          outline:none;
        }
        .mi-qty:focus{
          border-color: rgba(212,175,55,.55);
          box-shadow: 0 0 0 4px rgba(212,175,55,.18);
        }
        .mi-max{
          font-weight:1000;
          color:${MUTED};
          font-size:12px;
        }
        .mi-price{
          font-weight:1000;
          font-size:12px;
          color:${MUTED};
        }

        .drawer-backdrop{
          position:fixed; inset:0;
          background: rgba(15,23,42,.45);
          display:flex;
          justify-content:flex-end;
          z-index: 9999;
        }
        .drawer{
          width:min(520px, 92vw);
          height:100%;
          background:#fff;
          border-left:1px solid ${BORDER};
          box-shadow:-22px 0 64px rgba(15,33,71,.22);
          display:flex;
          flex-direction:column;
        }
        .drawer-head{
          padding:14px 14px;
          border-bottom:1px solid ${BORDER};
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
        }
        .drawer-title{
          font-weight:1000;
          color:${NAVY};
          font-size:14px;
        }
        .drawer-x{
          border:0;
          background:transparent;
          cursor:pointer;
          font-weight:1000;
          color:${MUTED};
          font-size:20px;
          line-height:1;
        }
        .drawer-body{
          padding:14px 14px;
          overflow:auto;
        }

        @media (max-width: 1100px){
          .grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .frow{ grid-template-columns: 1fr 1fr; }
          .manual-grid{ grid-template-columns: 1fr 1fr; }
          .list-head, .row{ grid-template-columns: 1fr 1fr; }
          .right{ text-align:left; }
          .acts{ justify-content:flex-start; }
          .mi-row{ grid-template-columns: 1fr; }
          .mi-right{ align-items:flex-start; }
        }
      `}</style>
    </section>
  );
}

/* ---------------- drawer details ---------------- */
function DetailsView({ lane, record, loading, isBusy, doAction, onOpenOrderId, pushToast }) {
  const id = String(record?.id || "");
  const orderId = String(record?.orderId || "");
  const st = String(record?.status || "");
  const createdAt = record?.createdAt ? isoDate(record.createdAt) : "—";
  const reason = safeText(record?.reason);
  const note = safeText(record?.note ?? record?.notes); // supports both
  const amount = record?.amount != null ? moneyBDT(record.amount) : "—";

  const allowed = allowedActions(lane, st);

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      pushToast?.({ tone: "success", title: "COPIED", message: `${label} COPIED.` });
    } catch {
      pushToast?.({ tone: "error", title: "COPY FAILED", message: "Clipboard permission blocked." });
    }
  };

  return (
    <div className="dv">
      <div className="dv-grid">
        <div className="dv-card">
          <div className="dv-k">Request ID</div>
          <div className="dv-v mono">{safeText(id)}</div>
          <div className="dv-actions">
            <button className="pond pond-secondary" onClick={() => copy(id, "Request ID")}>
              Copy
            </button>
          </div>
        </div>

        <div className="dv-card">
          <div className="dv-k">Order</div>
          <div className="dv-v mono">{safeText(orderId)}</div>
          <div className="dv-actions">
            <button
              className="pond pond-secondary"
              onClick={() => {
                if (onOpenOrderId && orderId) onOpenOrderId(orderId);
              }}
              disabled={!orderId}
            >
              Open order
            </button>
            <button
              className="pond pond-secondary"
              onClick={() => copy(orderId, "Order ID")}
              disabled={!orderId}
            >
              Copy
            </button>
          </div>
        </div>

        <div className="dv-card">
          <div className="dv-k">Status</div>
          <div className="dv-v">
            <span className={cx("badge", badgeTone(st))}>{st || "—"}</span>
          </div>
        </div>

        <div className="dv-card">
          <div className="dv-k">Created</div>
          <div className="dv-v mono">{createdAt}</div>
        </div>

        <div className="dv-card dv-wide">
          <div className="dv-k">Reason</div>
          <div className="dv-v">{reason}</div>
        </div>

        <div className="dv-card dv-wide">
          <div className="dv-k">Note</div>
          <div className="dv-v">{note}</div>
        </div>

        {lane === "refunds" ? (
          <div className="dv-card dv-wide">
            <div className="dv-k">Amount</div>
            <div className="dv-v mono">{amount}</div>
          </div>
        ) : null}
      </div>

      <div className="dv-acts">
        {lane === "returns" ? (
          <>
            <PondAction
              label="Approve"
              tone="primary"
              disabled={!allowed.approve || isBusy(`returns:${id}:approve`) || loading}
              onClick={() => doAction("returns", id, "approve")}
            />
            <PondAction
              label="Deny"
              tone="danger"
              disabled={!allowed.deny || isBusy(`returns:${id}:deny`) || loading}
              onClick={() => doAction("returns", id, "deny")}
            />
            <PondAction
              label="Received"
              tone="secondary"
              disabled={!allowed.received || isBusy(`returns:${id}:received`) || loading}
              onClick={() => doAction("returns", id, "received")}
            />
            <PondAction
              label="Refunded"
              tone="secondary"
              disabled={!allowed.refunded || isBusy(`returns:${id}:refunded`) || loading}
              onClick={() => doAction("returns", id, "refunded")}
            />
          </>
        ) : lane === "exchanges" ? (
          <>
            <PondAction
              label="Approve"
              tone="primary"
              disabled={!allowed.approve || isBusy(`exchanges:${id}:approve`) || loading}
              onClick={() => doAction("exchanges", id, "approve")}
            />
            <PondAction
              label="Deny"
              tone="danger"
              disabled={!allowed.deny || isBusy(`exchanges:${id}:deny`) || loading}
              onClick={() => doAction("exchanges", id, "deny")}
            />
            <PondAction
              label="Fulfilled"
              tone="secondary"
              disabled={!allowed.fulfilled || isBusy(`exchanges:${id}:fulfilled`) || loading}
              onClick={() => doAction("exchanges", id, "fulfilled")}
            />
          </>
        ) : (
          <>
            <PondAction
              label="Process"
              tone="primary"
              disabled={!allowed.process || isBusy(`refunds:${id}:process`) || loading}
              onClick={() => doAction("refunds", id, "process")}
            />
            <PondAction
              label="Fail"
              tone="danger"
              disabled={!allowed.fail || isBusy(`refunds:${id}:fail`) || loading}
              onClick={() => doAction("refunds", id, "fail")}
            />
          </>
        )}
      </div>

      <style>{`
        .dv{ display:flex; flex-direction:column; gap:14px; }
        .dv-grid{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap:10px;
        }
        .dv-card{
          border:1px solid ${BORDER};
          border-radius:16px;
          padding:12px 12px;
          background:linear-gradient(180deg,#fff 0%, #F7FAFC 100%);
          box-shadow:0 12px 30px rgba(15,33,71,.10);
        }
        .dv-wide{ grid-column: 1 / -1; }
        .dv-k{
          font-size:11px;
          font-weight:1000;
          letter-spacing:.06em;
          text-transform:uppercase;
          color:${MUTED};
        }
        .dv-v{
          margin-top:6px;
          font-weight:1000;
          color:#0f172a;
          font-size:13px;
          word-break: break-word;
        }
        .dv-actions{
          margin-top:10px;
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .dv-acts{
          display:flex;
          gap:10px;
          flex-wrap:wrap;
          padding-top:4px;
          border-top:1px solid ${BORDER};
        }
        @media (max-width: 520px){
          .dv-grid{ grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
