//my-project\app\customer\returnexchangerefundpanel.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const MAX_IMAGES = 3;

// Fallback-only (used only if your DB meta endpoint doesn't exist)
const RETURN_REASONS_FALLBACK = [
  "wrong size / fit",
  "change of mind",
  "received wrong product",
  "defective (not torn)",
  "product torn/damaged",
  "quality not as expected",
  "other",
];
const MFS_LIST_FALLBACK = ["bkash", "nagad", "rocket", "upay", "other"];

/* ───────────── small utils (no UI changes) ───────────── */
function safeTrim(v) {
  return String(v ?? "").trim();
}
function isFilled(v) {
  return safeTrim(v) !== "";
}
function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function pickFirst(obj, keys, fallback = "") {
  if (!obj) return fallback;
  for (const k of keys) {
    const v = obj?.[k];
    if (isFilled(v)) return safeTrim(v);
  }
  return fallback;
}
function getFirstArray(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj?.[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

function mergeParentIntoLine(parent, line) {
  const p = parent || {};
  const l = line || {};

  const parentBits = {
    order_no: pickFirst(
      p,
      ["order_no", "orderNo", "order_number", "orderNumber", "order_id", "orderId"],
      ""
    ),
    order_id: pickFirst(p, ["order_id", "orderId", "id"], ""),
    invoice_no: pickFirst(p, ["invoice_no", "invoiceNo", "invoice_number", "invoiceNumber"], ""),
    delivery_date: pickFirst(p, ["delivery_date", "deliveryDate", "delivered_at", "deliveredAt"], ""),
  };

  const merged = { ...l };
  for (const [k, v] of Object.entries(parentBits)) {
    if (!isFilled(merged?.[k]) && isFilled(v)) merged[k] = v;
  }
  return merged;
}

function normalizeLookupPayload(payload) {
  const root = payload?.data ?? payload?.result ?? payload;

  // 1) Direct array
  if (Array.isArray(root)) {
    const out = [];
    for (const entry of root) {
      const nested = getFirstArray(entry, [
        "items",
        "order_items",
        "orderItems",
        "line_items",
        "lineItems",
        "products",
      ]);
      if (Array.isArray(nested) && nested.length) {
        for (const li of nested) out.push(mergeParentIntoLine(entry, li));
      } else {
        out.push(entry);
      }
    }
    return out;
  }

  // 2) Direct line array on object
  const directLines = getFirstArray(root, [
    "items",
    "order_items",
    "orderItems",
    "line_items",
    "lineItems",
    "products",
  ]);
  if (Array.isArray(directLines)) {
    const isOrderLike =
      isFilled(root?.order_no) ||
      isFilled(root?.orderNo) ||
      isFilled(root?.order_number) ||
      isFilled(root?.orderNumber) ||
      isFilled(root?.invoice_no) ||
      isFilled(root?.invoiceNo);

    if (!isOrderLike) return directLines;
    return directLines.map((li) => mergeParentIntoLine(root, li));
  }

  // 3) orders/results array
  const ordersArr = getFirstArray(root, ["orders", "results"]);
  if (Array.isArray(ordersArr)) {
    const out = [];
    for (const ord of ordersArr) {
      const nested = getFirstArray(ord, [
        "items",
        "order_items",
        "orderItems",
        "line_items",
        "lineItems",
        "products",
      ]);
      if (Array.isArray(nested) && nested.length) {
        for (const li of nested) out.push(mergeParentIntoLine(ord, li));
      } else {
        out.push(ord);
      }
    }
    return out;
  }

  // 4) single order object at root.order
  if (root?.order && typeof root.order === "object") {
    const ord = root.order;
    const nested = getFirstArray(ord, [
      "items",
      "order_items",
      "orderItems",
      "line_items",
      "lineItems",
      "products",
    ]);
    if (Array.isArray(nested)) return nested.map((li) => mergeParentIntoLine(ord, li));
    return [ord];
  }

  return [];
}

function item_key(it) {
  if (!it) return "";
  const oid = pickFirst(it, ["order_item_id", "orderItemId", "item_id", "itemId", "id"], "");
  const o = pickFirst(it, ["order_no", "orderNo", "order_number", "orderNumber", "order_id", "orderId"], "");
  const sku = pickFirst(it, ["sku", "SKU", "variant_sku", "variantSku"], "");
  const pid = pickFirst(it, ["product_no", "productNo", "product_id", "productId"], "");
  const size = pickFirst(it, ["size", "size_label", "sizeLabel"], "");
  const color = pickFirst(it, ["color", "color_name", "colorName"], "");
  return [o, oid || pid || sku, sku, size, color].filter(Boolean).join("|");
}

function getItemDisplay(it) {
  const product = it?.product || it?.product_info || it?.productInfo || it?.productData || {};
  const variant = it?.variant || it?.variant_info || it?.variantInfo || it?.variantData || {};

  const name = pickFirst(
    it,
    ["product_name", "productName", "title", "product_title", "productTitle", "name"],
    ""
  );
  const pName = pickFirst(product, ["title", "name"], "");
  const vName = pickFirst(variant, ["title", "name"], "");

  const sku =
    pickFirst(it, ["sku", "SKU", "variant_sku", "variantSku"], "") ||
    pickFirst(variant, ["sku", "SKU"], "") ||
    pickFirst(product, ["sku", "SKU"], "");

  const size =
    pickFirst(it, ["size", "size_label", "sizeLabel", "size_name", "sizeName"], "") ||
    pickFirst(variant, ["size", "sizeLabel", "size_name", "sizeName"], "");

  const color =
    pickFirst(it, ["color", "color_name", "colorName"], "") ||
    pickFirst(variant, ["color", "color_name", "colorName"], "");

  const barcode = pickFirst(it, ["barcode", "ean", "ean13", "EAN", "EAN13"], "");

  const qtyRaw = it?.quantity ?? it?.qty ?? it?.count ?? it?.item_qty ?? it?.itemQty ?? it?.units;
  const qty = Math.max(1, n(qtyRaw, 1));

  const orderNo = pickFirst(it, ["order_no", "orderNo", "order_number", "orderNumber"], "");
  const orderId = pickFirst(it, ["order_id", "orderId"], "");
  const invoice = pickFirst(it, ["invoice_no", "invoiceNo", "invoice_number", "invoiceNumber"], "");
  const lineId = pickFirst(it, ["order_item_id", "orderItemId", "item_id", "itemId", "id"], "");

  return {
    name: name || pName || vName || sku || "—",
    sku,
    size,
    color,
    barcode,
    qty,
    order: orderNo || orderId || "—",
    invoice: invoice || "—",
    lineId,
  };
}

export default function ReturnExchangeRefundPanel({ user }) {
  // manual lookup inputs
  const [lookup, set_lookup] = useState({
    order_no: "",
    invoice_no: "",
    product_no: "",
    sku: "",
    barcode: "",
  });

  // results
  const [items, set_items] = useState([]);
  const [selected, set_selected] = useState(null);

  // action + details
  const [action_type, set_action_type] = useState(""); // "return" | "exchange" | "refund"
  const [reason, set_reason] = useState("");
  const [description, set_description] = useState("");
  const [images, set_images] = useState([]);

  // refund-only fields
  const [refund_method, set_refund_method] = useState(""); // "wallet" | "mfs" | "bank"
  const [mfs_service, set_mfs_service] = useState("");
  const [account_info, set_account_info] = useState("");

  // status / timeline
  const [submitting, set_submitting] = useState(false);
  const [message, set_message] = useState("");
  const [timing_msg, set_timing_msg] = useState("");
  const [timeline, set_timeline] = useState([]);
  const [application_id, set_application_id] = useState(null);

  // Optional DB meta (keeps UI unchanged)
  const [reason_list, set_reason_list] = useState(RETURN_REASONS_FALLBACK);
  const [mfs_service_list, set_mfs_service_list] = useState(MFS_LIST_FALLBACK);

  // Prevent auto-blank/overwrite while typing
  const active_lookup_field_ref = useRef(null);
  const lookup_req_id_ref = useRef(0);

  // meta fetch (optional)
  useEffect(() => {
    let alive = true;
    (async () => {
      const urls = ["/api/customers/returns/meta", "/api/customer/returns/meta", "/api/returns/meta"];
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: "no-store", credentials: "include" });
          if (!res.ok) continue;
          const data = await res.json();
          if (!alive) return;

          const reasons =
            getFirstArray(data, ["reasons", "return_reasons", "returnReasons"]) ||
            getFirstArray(data?.data, ["reasons", "return_reasons", "returnReasons"]) ||
            null;

          const mfs =
            getFirstArray(data, ["mfs", "mfs_list", "mfsList", "mfs_services", "mfsServices"]) ||
            getFirstArray(data?.data, ["mfs", "mfs_list", "mfsList", "mfs_services", "mfsServices"]) ||
            null;

          if (Array.isArray(reasons) && reasons.length) set_reason_list(reasons.map((x) => String(x)));
          if (Array.isArray(mfs) && mfs.length) set_mfs_service_list(mfs.map((x) => String(x)));
          return;
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // ───────────── auto-lookup (debounced, DB routes only) ─────────────
  useEffect(() => {
    const qParts = Object.entries(lookup)
      .filter(([, v]) => isFilled(v))
      .map(([k, v]) => [k, safeTrim(v)]);

    if (user?.id) qParts.push(["user_id", String(user.id)]);

    if (!qParts.length) {
      set_items([]);
      set_selected(null);
      return;
    }

    const reqId = ++lookup_req_id_ref.current;
    const ac = new AbortController();

    const timeout = setTimeout(() => {
      (async () => {
        const endpoints = [
          "/api/customers/returns/lookup",
          "/api/customer/returns/lookup",
          "/api/returns/lookup",
          "/api/customers/rer/lookup",
          "/api/customer/rer/lookup",
        ];

        const buildSearchParams = () => {
          const sp = new URLSearchParams();

          for (const [k, v] of qParts) sp.append(k, v);

          const orderNo = safeTrim(lookup.order_no);
          const invoiceNo = safeTrim(lookup.invoice_no);
          const productNo = safeTrim(lookup.product_no);
          const sku = safeTrim(lookup.sku);
          const barcode = safeTrim(lookup.barcode);

          if (isFilled(orderNo)) {
            sp.append("orderNo", orderNo);
            sp.append("order_number", orderNo);
            sp.append("orderNumber", orderNo);
            sp.append("q", orderNo);
          }
          if (isFilled(invoiceNo)) {
            sp.append("invoiceNo", invoiceNo);
            sp.append("invoice_number", invoiceNo);
            sp.append("invoiceNumber", invoiceNo);
            sp.append("q", invoiceNo);
          }
          if (isFilled(productNo)) {
            sp.append("productNo", productNo);
            sp.append("product_id", productNo);
            sp.append("productId", productNo);
            sp.append("q", productNo);
          }
          if (isFilled(sku)) {
            sp.append("SKU", sku);
            sp.append("variantSku", sku);
            sp.append("q", sku);
          }
          if (isFilled(barcode)) {
            sp.append("ean", barcode);
            sp.append("ean13", barcode);
            sp.append("EAN13", barcode);
            sp.append("q", barcode);
          }

          if (user?.id) {
            sp.append("userId", String(user.id));
            sp.append("customer_id", String(user.id));
            sp.append("customerId", String(user.id));
          }

          return sp.toString();
        };

        async function fetchLookupGET(url) {
          try {
            const qs = buildSearchParams();
            const fullUrl = qs ? `${url}?${qs}` : url;
            const res = await fetch(fullUrl, {
              method: "GET",
              cache: "no-store",
              credentials: "include",
              signal: ac.signal,
            });
            if (!res.ok) return { ok: false, items: [] };
            const data = await res.json();
            return { ok: true, items: normalizeLookupPayload(data) };
          } catch {
            return { ok: false, items: [] };
          }
        }

        async function fetchLookupPOST(url) {
          try {
            const res = await fetch(url, {
              method: "POST",
              cache: "no-store",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...lookup,
                user_id: user?.id || null,
                userId: user?.id || null,
              }),
              signal: ac.signal,
            });
            if (!res.ok) return { ok: false, items: [] };
            const data = await res.json();
            return { ok: true, items: normalizeLookupPayload(data) };
          } catch {
            return { ok: false, items: [] };
          }
        }

        let found = [];
        let hadOk = false;

        for (const url of endpoints) {
          if (ac.signal.aborted) return;
          const r = await fetchLookupGET(url);
          if (ac.signal.aborted) return;

          if (r.ok) {
            hadOk = true;
            if (Array.isArray(r.items) && r.items.length) {
              found = r.items;
              break;
            }

            const rp = await fetchLookupPOST(url);
            if (ac.signal.aborted) return;
            if (rp.ok && Array.isArray(rp.items) && rp.items.length) {
              found = rp.items;
              break;
            }
          }
        }

        // dedupe
        const deduped = [];
        const seen = new Set();
        for (const it of Array.isArray(found) ? found : []) {
          const k = item_key(it) || JSON.stringify([it?.order_no, it?.order_id, it?.sku, it?.product_no, it?.id]);
          if (seen.has(k)) continue;
          seen.add(k);
          deduped.push(it);
        }

        if (ac.signal.aborted) return;
        if (lookup_req_id_ref.current !== reqId) return;

        set_items(deduped);
        set_selected((prev) => {
          if (!deduped.length) return null;
          if (deduped.length === 1) return deduped[0];
          const prevKey = item_key(prev);
          if (prevKey) {
            const keep = deduped.find((x) => item_key(x) === prevKey);
            if (keep) return keep;
          }
          return null;
        });

        if (!deduped.length && !hadOk) {
          set_message("could not load orders for the provided info.");
        }
      })();
    }, 400);

    return () => {
      clearTimeout(timeout);
      ac.abort();
    };
  }, [lookup.order_no, lookup.invoice_no, lookup.product_no, lookup.sku, lookup.barcode, user?.id]);

  // Backfill only empty fields; never overwrite active input field
  useEffect(() => {
    if (!selected) return;

    set_lookup((cur) => {
      let changed = false;
      const next = { ...cur };

      const fillIfEmpty = (key, v) => {
        if (active_lookup_field_ref.current === key) return;
        if (isFilled(next[key])) return;
        const s = safeTrim(v);
        if (!s) return;
        next[key] = s;
        changed = true;
      };

      fillIfEmpty(
        "order_no",
        pickFirst(selected, ["order_no", "orderNo", "order_number", "orderNumber", "order_id", "orderId"], "")
      );
      fillIfEmpty("invoice_no", pickFirst(selected, ["invoice_no", "invoiceNo", "invoice_number", "invoiceNumber"], ""));
      fillIfEmpty("product_no", pickFirst(selected, ["product_no", "productNo", "product_id", "productId"], ""));
      fillIfEmpty("sku", pickFirst(selected, ["sku", "SKU", "variant_sku", "variantSku"], ""));
      fillIfEmpty("barcode", pickFirst(selected, ["barcode", "ean", "ean13", "EAN", "EAN13"], ""));

      return changed ? next : cur;
    });
  }, [selected]);

  // policy timing message (real logic)
  useEffect(() => {
    if (!selected || !action_type) {
      set_timing_msg("");
      return;
    }
    const deliveredAtRaw = pickFirst(selected, ["delivery_date", "deliveryDate", "delivered_at", "deliveredAt"], "");
    const delivered_at = deliveredAtRaw ? new Date(deliveredAtRaw) : null;
    if (!delivered_at || isNaN(+delivered_at)) {
      set_timing_msg("");
      return;
    }
    const now = new Date();
    const diff_days = (now - delivered_at) / (1000 * 60 * 60 * 24);
    if (action_type === "refund" && diff_days > 3) set_timing_msg("refunds only allowed within 3 days of delivery.");
    else if ((action_type === "return" || action_type === "exchange") && diff_days > 7)
      set_timing_msg("return/exchange allowed only within 7 days of delivery.");
    else set_timing_msg("");
  }, [selected, action_type]);

  // img upload validations
  const on_pick_images = (e) => {
    const files = Array.from(e.target.files || []);
    const valid = [];
    let err = "";
    for (const f of files) {
      if (!f.type?.startsWith?.("image/")) {
        err = "only image files allowed.";
        break;
      }
      if (f.size > 5 * 1024 * 1024) {
        err = "each image must be under 5mb.";
        break;
      }
      if (images.length + valid.length >= MAX_IMAGES) {
        err = `max ${MAX_IMAGES} images allowed.`;
        break;
      }
      valid.push(f);
    }
    if (err) {
      set_message(err);
      return;
    }
    set_images((prev) => [...prev, ...valid]);
    set_message("");
  };
  const remove_image = (idx) => set_images((arr) => arr.filter((_, i) => i !== idx));

  const can_submit = useMemo(() => {
    if (!selected || !action_type || timing_msg) return false;
    if (!description.trim()) return false;
    if (!reason) return false;
    if (action_type === "refund") {
      if (images.length < 1) return false;
      if (!refund_method) return false;
      if (refund_method === "mfs" && !mfs_service) return false;
      if (refund_method === "bank" && !account_info.trim()) return false;
    }
    return true;
  }, [selected, action_type, description, reason, timing_msg, images.length, refund_method, mfs_service, account_info]);

  const on_submit = async (e) => {
    e?.preventDefault?.();
    if (!can_submit) return;

    set_submitting(true);
    set_message("");
    try {
      const fd = new FormData();
      fd.append("user_id", user?.id || "");

      fd.append("order_no", pickFirst(selected, ["order_no", "orderNo", "order_number", "orderNumber"], ""));
      fd.append("invoice_no", pickFirst(selected, ["invoice_no", "invoiceNo", "invoice_number", "invoiceNumber"], ""));
      fd.append("product_no", pickFirst(selected, ["product_no", "productNo", "product_id", "productId"], ""));
      fd.append("sku", pickFirst(selected, ["sku", "SKU", "variant_sku", "variantSku"], ""));
      fd.append("barcode", pickFirst(selected, ["barcode", "ean", "ean13", "EAN", "EAN13"], ""));

      const orderItemId = pickFirst(selected, ["order_item_id", "orderItemId", "item_id", "itemId", "id"], "");
      if (orderItemId) fd.append("order_item_id", orderItemId);

      fd.append("action_type", action_type);
      fd.append("reason", reason);
      fd.append("description", description);

      if (action_type === "refund") {
        fd.append("refund_method", refund_method);
        if (refund_method === "mfs") fd.append("mfs_service", mfs_service);
        if (refund_method !== "wallet") fd.append("account_info", account_info);
      }

      images.forEach((file) => fd.append("images", file));

      const res = await fetch("/api/customers/returns", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "submission failed");
      }
      const data = await res.json();
      set_application_id(data?.application_id || data?.id || null);
      set_timeline(Array.isArray(data?.timeline) ? data.timeline : []);
      set_message("application submitted successfully.");
      set_images([]);
    } catch (err) {
      set_message(err?.message || "submission failed.");
    } finally {
      set_submitting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        justifyContent: "center",
        width: "100%",
        flexWrap: "wrap",
      }}
    >
      {/* main panel */}
      <div
        style={{
          flex: 2,
          minWidth: 320,
          maxWidth: 560,
          background: "#fcfdff",
          border: "1px solid #e4e7ef",
          borderRadius: 16,
          boxShadow: "0 2px 12px #eaeaea22",
          padding: "28px 24px",
          marginBottom: 18,
          width: "100%",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 16,
            textTransform: "capitalize",
          }}
        >
          return / exchange / refund
        </h2>

        {/* lookup block */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <input
            placeholder="order no"
            value={lookup.order_no}
            onChange={(e) => set_lookup((s) => ({ ...s, order_no: e.target.value }))}
            onFocus={() => (active_lookup_field_ref.current = "order_no")}
            onBlur={() => (active_lookup_field_ref.current = null)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          />
          <input
            placeholder="invoice no"
            value={lookup.invoice_no}
            onChange={(e) => set_lookup((s) => ({ ...s, invoice_no: e.target.value }))}
            onFocus={() => (active_lookup_field_ref.current = "invoice_no")}
            onBlur={() => (active_lookup_field_ref.current = null)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          />
          <input
            placeholder="product no"
            value={lookup.product_no}
            onChange={(e) => set_lookup((s) => ({ ...s, product_no: e.target.value }))}
            onFocus={() => (active_lookup_field_ref.current = "product_no")}
            onBlur={() => (active_lookup_field_ref.current = null)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          />
          <input
            placeholder="sku"
            value={lookup.sku}
            onChange={(e) => set_lookup((s) => ({ ...s, sku: e.target.value }))}
            onFocus={() => (active_lookup_field_ref.current = "sku")}
            onBlur={() => (active_lookup_field_ref.current = null)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          />
          <input
            placeholder="barcode"
            value={lookup.barcode}
            onChange={(e) => set_lookup((s) => ({ ...s, barcode: e.target.value }))}
            onFocus={() => (active_lookup_field_ref.current = "barcode")}
            onBlur={() => (active_lookup_field_ref.current = null)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          />
        </div>

        {/* items result (show even for single match) */}
        {items.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 13,
                color: "#6a7280",
                marginBottom: 8,
                textTransform: "capitalize",
              }}
            >
              select product:
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {items.map((it, idx) => {
                const d = getItemDisplay(it);
                const k = item_key(it) || `${idx}`;
                const isSel = selected ? item_key(selected) === item_key(it) : false;

                return (
                  <button
                    key={k}
                    onClick={() => set_selected(it)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: isSel ? "2px solid #3647ff" : "1px solid #e6eaf1",
                      background: isSel ? "#f4f6ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {d.name}
                      {(d.color || d.size) && (
                        <span style={{ fontWeight: 600 }}>
                          {` (${[d.color, d.size].filter(Boolean).join(" / ")})`}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#677187" }}>
                      order #{d.order} • invoice {d.invoice} • qty {d.qty}
                      {d.sku ? ` • sku ${d.sku}` : ""}
                      {d.barcode ? ` • ean ${d.barcode}` : ""}
                      {d.lineId ? ` • item ${d.lineId}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* action + reason */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <select
            value={action_type}
            onChange={(e) => set_action_type(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          >
            <option value="">select action</option>
            <option value="return">return</option>
            <option value="exchange">exchange</option>
            <option value="refund">refund</option>
          </select>

          <select
            value={reason}
            onChange={(e) => set_reason(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #dde2ea",
            }}
          >
            <option value="">select reason</option>
            {reason_list.map((r) => (
              <option value={r} key={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        {timing_msg ? <div style={{ marginBottom: 12, color: "#b00020", fontSize: 13 }}>{timing_msg}</div> : null}

        {/* description */}
        <div style={{ marginBottom: 12 }}>
          <textarea
            rows={5}
            placeholder="describe the issue (required)"
            value={description}
            onChange={(e) => set_description(e.target.value)}
            style={{
              width: "100%",
              padding: 12,
              borderRadius: 12,
              border: "1px solid #dde2ea",
            }}
          />
        </div>

        {/* refund options */}
        {action_type === "refund" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <select
              value={refund_method}
              onChange={(e) => set_refund_method(e.target.value)}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #dde2ea",
              }}
            >
              <option value="">select refund method</option>
              <option value="wallet">wallet (store credit)</option>
              <option value="mfs">mobile financial service</option>
              <option value="bank">bank transfer</option>
            </select>

            {refund_method === "mfs" ? (
              <select
                value={mfs_service}
                onChange={(e) => set_mfs_service(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #dde2ea",
                }}
              >
                <option value="">select mfs</option>
                {mfs_service_list.map((m) => (
                  <option value={m} key={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                placeholder={refund_method === "bank" ? "bank account info" : "—"}
                disabled={refund_method !== "bank"}
                value={account_info}
                onChange={(e) => set_account_info(e.target.value)}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #dde2ea",
                }}
              />
            )}
          </div>
        )}

        {/* images */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "#6a7280", marginBottom: 6 }}>
            upload up to {MAX_IMAGES} images (refund requires at least 1)
          </div>
          <input type="file" accept="image/*" multiple onChange={on_pick_images} />
          {images.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {images.map((f, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #e6eaf1",
                    borderRadius: 10,
                    padding: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12 }}>{f.name}</span>
                  <button
                    type="button"
                    onClick={() => remove_image(idx)}
                    style={{
                      border: "1px solid #e6eaf1",
                      borderRadius: 8,
                      padding: "2px 6px",
                      background: "white",
                      cursor: "pointer",
                    }}
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* submit */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={on_submit}
            disabled={!can_submit || submitting}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #4a5cff",
              background: can_submit && !submitting ? "#3647ff" : "#9aa3ff",
              color: "white",
              cursor: can_submit && !submitting ? "pointer" : "not-allowed",
              fontWeight: 600,
            }}
          >
            {submitting ? "submitting..." : "submit"}
          </button>

          {message && <div style={{ fontSize: 13, color: "#334155" }}>{message}</div>}
        </div>
      </div>

      {/* right bar */}
      <div
        style={{
          flex: 1,
          minWidth: 260,
          maxWidth: 340,
          alignSelf: "flex-start",
          position: "sticky",
          top: 38,
          width: "100%",
        }}
      >
        <div
          style={{
            border: "1px solid #e4e7ef",
            borderRadius: 16,
            background: "white",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 10 }}>status timeline</div>
          {timeline?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {timeline.map((t, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #eef1f7",
                    borderRadius: 12,
                    padding: 10,
                    background: "#fafbff",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.step}</div>
                  <div style={{ fontSize: 12, color: "#6a7280" }}>
                    {t.date ? new Date(t.date).toLocaleString() : "pending"}
                  </div>
                  {t.info && <div style={{ fontSize: 12, color: "#334155", marginTop: 4 }}>{t.info}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#6a7280" }}>no timeline yet.</div>
          )}

          {application_id && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <a
                href={`/api/customers/returns/${encodeURIComponent(application_id)}`}
                target="_blank"
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #e6eaf1",
                  background: "white",
                  textDecoration: "none",
                  fontSize: 13,
                }}
              >
                view request json
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
