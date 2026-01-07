// FILE: app/cart/page.jsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCart as use_cart } from "@/components/common/cart_context";
import BottomFloatingBar from "@/components/common/bottomfloatingbar";
import Navbar from "@/components/common/navbar";

const RECENT_KEY_V1 = "recently_viewed_v1";
const RECENT_KEY_LEGACY = "recently_viewed";

/* ---------------- stock helper (per-line cap, tolerant) ---------------- */

function getMaxFromItem(it = {}) {
  const nums = [];
  const push = (v) => {
    const x = Number(v);
    if (Number.isFinite(x) && x > 0) nums.push(x);
  };

  // direct caps from server / quickview / provider / /api/cart
  push(it.maxAvailable);
  push(it.max_available);
  push(it.stockAvailable);
  push(it.stock_available);
  push(it.stock_total);
  push(it.stock_quantity);
  push(it.stockQuantity);
  push(it.stockQty);
  push(it.inventoryQty);
  push(it.inventory_qty);

  // CartProvider / Strapi hints
  push(it.stock);
  push(it.strapiStockQty);
  push(it.strapi_stock_qty);

  // Strapi size row
  if (it.sizeStock && typeof it.sizeStock === "object") {
    push(it.sizeStock.stock_quantity);
    push(it.sizeStock.stock);
  }
  if (it.size_stock && typeof it.size_stock === "object") {
    push(it.size_stock.stock_quantity);
    push(it.size_stock.stock);
  }

  // metadata hints (if any)
  if (it.metadata && typeof it.metadata === "object") {
    push(it.metadata.stock_quantity);
    push(it.metadata.stock);
    push(it.metadata.availableQty);
    push(it.metadata.available_qty);
  }

  if (!nums.length) return null;
  return Math.max(...nums);
}

/* ---------------- Recently viewed (session-based) ---------------- */

function readRecent() {
  try {
    if (typeof window === "undefined") return [];

    const ss = window.sessionStorage;
    const ls = window.localStorage;

    const parseList = (raw) => {
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(-12).reverse();
      }
      if (parsed && Array.isArray(parsed.items)) {
        return parsed.items.slice(-12).reverse();
      }
      return [];
    };

    // 1) Prefer sessionStorage – per-tab / per-session
    let list = parseList(ss.getItem(RECENT_KEY_V1));
    if (!list.length) {
      list = parseList(ss.getItem(RECENT_KEY_LEGACY));
    }

    // 2) One-time migrate any legacy localStorage into this session
    if (!list.length && ls) {
      const rawV1 = ls.getItem(RECENT_KEY_V1);
      const rawLegacy = !rawV1 ? ls.getItem(RECENT_KEY_LEGACY) : null;
      const fromLs = parseList(rawV1 || rawLegacy);
      if (fromLs.length) {
        ss.setItem(RECENT_KEY_V1, JSON.stringify(fromLs));
        ls.removeItem(RECENT_KEY_V1);
        ls.removeItem(RECENT_KEY_LEGACY);
        list = fromLs;
      }
    }

    return list;
  } catch {
    return [];
  }
}

/* ---------------- tiny helper: robust image from item ---------------- */

function imageFromItem(it) {
  if (!it || typeof it !== "object") return "";

  const md = it.metadata && typeof it.metadata === "object" ? it.metadata : {};

  const src =
    it.image ||
    it.thumbnail ||
    it.thumbnailUrl ||
    md.image ||
    md.imageUrl ||
    md.thumbnail ||
    md.thumbnailUrl ||
    "";

  return typeof src === "string" ? src : "";
}

/* ---------------- page ---------------- */

export default function CartPage() {
  const router = useRouter();
  const ctx = use_cart(); // CartProvider (DB + LS backed)

  const [syncing, setSyncing] = useState(false);
  const [recent, setRecent] = useState([]);
  const [canGoBack, setCanGoBack] = useState(false);

  // Detect if there is any history to go back to
  useEffect(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      setCanGoBack(true);
    }
  }, []);

  // Single canonical source of cart lines: CartProvider
  const items = useMemo(() => {
    if (!ctx) return [];
    if (Array.isArray(ctx.items)) return ctx.items;
    if (Array.isArray(ctx.cart?.items)) return ctx.cart.items;
    return [];
  }, [ctx]);

  // Total quantity (not just number of lines)
  const totalItems = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + Number(it?.quantity ?? it?.qty ?? 1),
        0
      ),
    [items]
  );

  // Unique product count (by productId / metadata.productId / slug / id)
  const uniqueProductsCount = useMemo(() => {
    if (!items.length) return 0;
    const keys = new Set();
    for (const it of items) {
      const md = it && typeof it.metadata === "object" ? it.metadata : {};
      const key =
        it.productId ||
        md.productId ||
        it.slug ||
        it.id ||
        null;
      if (!key) continue;
      keys.add(String(key));
    }
    // Fallback: if we couldn't derive any keys, treat each line as a product
    return keys.size || items.length;
  }, [items]);

  // Prefer provider's subtotal, but fall back to local calc if needed
  const subtotal = useMemo(() => {
    if (typeof ctx?.subtotal === "number") return ctx.subtotal;
    return items.reduce((sum, it) => {
      const price = Number(it?.price || it?.unitPrice || 0);
      const qty = Number(it?.quantity ?? it?.qty ?? 1);
      return sum + price * qty;
    }, 0);
  }, [ctx, items]);

  const currencyCode = (items[0]?.currency || "BDT").toUpperCase();
  const money = (n) => {
    const sym =
      { BDT: "৳", USD: "$", EUR: "€", GBP: "£" }[currencyCode] || "";
    return `${sym}${Number(n || 0).toFixed(2)}`;
  };

  /* ---------- quantity / remove / clear ---------- */

  const setQty = useCallback(
    (line, qty) => {
      if (!line) return;

      let q = Math.max(1, Math.floor(Number(qty)) || 1);

      // Client-side cap based on known stock hints
      const max = getMaxFromItem(line);
      if (max != null && q > max) {
        q = max;
      }

      if (typeof ctx?.updateQuantity === "function") {
        ctx.updateQuantity(line, q);
      } else if (ctx?.dispatch) {
        ctx.dispatch({ type: "UPDATE_QTY", matcher: line, quantity: q });
      }
    },
    [ctx]
  );

  const removeLine = useCallback(
    (line) => {
      if (!line) return;

      if (typeof ctx?.removeItem === "function") {
        ctx.removeItem(line);
      } else if (ctx?.dispatch) {
        ctx.dispatch({ type: "REMOVE", matcher: line });
      }
    },
    [ctx]
  );

  const clearAll = useCallback(() => {
    // Clear client-side provider
    if (typeof ctx?.clear === "function") {
      ctx.clear();
    } else if (ctx?.dispatch) {
      ctx.dispatch({ type: "CLEAR" });
    }

    // Best-effort clear on server so checkout/summary see empty cart
    try {
      fetch("/api/cart", {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    } catch {
      // ignore
    }
  }, [ctx]);

  /* ---------- preflight sync before checkout (DB authority) ---------- */

  const syncAndGo = async () => {
    if (!items.length) {
      router.push("/cart");
      return;
    }

    setSyncing(true);
    try {
      // build safe, clamped payload using provider items
      const safeLines = [];
      for (const x of items) {
        let q = Number(x.quantity ?? x.qty ?? 1);
        if (!Number.isFinite(q) || q <= 0) continue;

        const max = getMaxFromItem(x);
        if (max != null && q > max) q = max;
        if (q <= 0) continue;

        safeLines.push({
          productId: x.productId || x.id || null,
          slug: x.slug || null,
          variantId: x.variantId || null,
          selectedColor: x.selectedColor || x.color || null,
          selectedSize: x.selectedSize || x.size || null,
          quantity: q,
          price: Number(x.price || x.unitPrice || 0),
          currency: (x.currency || currencyCode).toUpperCase(),
          name: x.name || x.title || null,
        });
      }

      if (!safeLines.length) {
        router.push("/cart");
        setSyncing(false);
        return;
      }

      const payload = {
        currency: currencyCode,
        items: safeLines,
      };

      // Best-effort sync to DB; never block checkout hard
      try {
        await fetch("/api/cart/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        }).catch(() => {});
      } catch {
        // ignore – soft fail
      }

      router.push("/checkout");
    } catch {
      try {
        router.push("/checkout");
      } catch {}
    } finally {
      setSyncing(false);
    }
  };

  /* ---------- Recently viewed hook ---------- */

  useEffect(() => {
    setRecent(readRecent());
    const onAny = () => setRecent(readRecent());
    window.addEventListener("storage", onAny);
    return () => window.removeEventListener("storage", onAny);
  }, []);

  /* ---------- styles (premium look, no hiding) ---------- */

  const S = {
    page: {
      padding: "120px 16px 96px", // extra top & bottom so nothing hides under navbar/bottom bar
      maxWidth: 1120,
      margin: "0 auto",
      position: "relative",
      background:
        "radial-gradient(circle at top left,#f9fafb,#eef2ff 55%,#e0e7ff 100%)",
      borderRadius: 24,
      boxShadow: "0 18px 60px rgba(15,23,42,0.12)",
    },
    topbar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 18,
    },
    leftTop: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      minWidth: 0,
    },
    back: {
      height: 40,
      width: 40,
      borderRadius: 999,
      border: "1px solid #d7dcef",
      background:
        "radial-gradient(circle at 20% 0%,#ffffff,#eef2ff 80%)",
      fontSize: 18,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 10px 22px rgba(15,23,42,0.18)",
    },
    titleWrap: {
      display: "flex",
      flexDirection: "column",
      gap: 2,
    },
    title: {
      fontFamily: "'Playfair Display', serif",
      fontWeight: 900,
      fontSize: 28,
      letterSpacing: ".04em",
      color: "#0f2147",
      textTransform: "uppercase",
    },
    subtitle: {
      fontSize: 13,
      color: "#6b7280",
    },
    pillCount: {
      padding: "4px 10px",
      borderRadius: 999,
      background: "rgba(15,33,71,0.06)",
      border: "1px solid rgba(148,163,184,0.4)",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: ".14em",
      textTransform: "uppercase",
      color: "#0f2147",
      whiteSpace: "nowrap",
    },
    layout: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1.6fr) minmax(320px,0.9fr)",
      gap: 20,
    },
    card: {
      background: "#ffffff",
      border: "1px solid #e6eaf6",
      borderRadius: 18,
      boxShadow: "0 14px 36px rgba(8,21,64,.08)",
      overflow: "hidden",
    },
    listHead: {
      display: "grid",
      gridTemplateColumns: "90px 1fr 110px 110px 40px",
      padding: "12px 14px",
      borderBottom: "1px solid #eef2ff",
      fontSize: 11,
      color: "#6b7280",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: ".08em",
      background:
        "linear-gradient(90deg,#f9fafb,#eef2ff,#f9fafb)",
    },
    row: {
      display: "grid",
      gridTemplateColumns: "90px 1fr 110px 110px 40px",
      gap: 10,
      padding: "12px 14px",
      alignItems: "center",
      borderBottom: "1px dashed #eef2ff",
    },
    imgWrap: {
      width: 80,
      height: 88,
      borderRadius: 14,
      overflow: "hidden",
      background: "#f5f7fe",
      border: "1px solid #eef2ff",
    },
    name: {
      fontWeight: 800,
      color: "#0f2147",
      marginBottom: 4,
      fontSize: 14,
    },
    meta: { fontSize: 12, color: "#6b7280" },
    qtyBox: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      border: "1px solid #cfd6e9",
      borderRadius: 999,
      padding: "4px 10px",
      background: "rgba(249,250,251,0.8)",
      boxShadow: "0 4px 10px rgba(15,23,42,0.08)",
    },
    qtyBtn: {
      height: 26,
      width: 26,
      borderRadius: 999,
      background: "#fff",
      border: "1px solid #d7dcef",
      cursor: "pointer",
      fontWeight: 900,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    qtyValue: {
      minWidth: 26,
      textAlign: "center",
      fontWeight: 900,
      fontSize: 13,
      color: "#0f2147",
    },
    price: { fontWeight: 900, color: "#0f2147", fontSize: 14 },
    remove: {
      height: 34,
      width: 34,
      borderRadius: "50%",
      border: "1px solid #e5e7eb",
      background: "#fff",
      cursor: "pointer",
      fontSize: 18,
      lineHeight: "32px",
      textAlign: "center",
      color: "#6b7280",
      boxShadow: "0 6px 14px rgba(15,23,42,0.08)",
    },
    summary: {
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 14,
      background:
        "radial-gradient(circle at top,#0f172a,#020617 55%,#020617 100%)",
      color: "#e5e7eb",
    },
    summaryCardInner: {
      padding: 16,
      borderRadius: 14,
      background:
        "linear-gradient(135deg,rgba(15,23,42,.95),rgba(15,23,42,.9))",
      border: "1px solid rgba(55,65,81,0.9)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    },
    rowFlex: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 13,
    },
    dimLabel: {
      color: "#9ca3af",
      textTransform: "uppercase",
      letterSpacing: ".16em",
      fontSize: 11,
      fontWeight: 700,
    },
    totalLabel: {
      color: "#f9fafb",
      textTransform: "uppercase",
      letterSpacing: ".16em",
      fontSize: 11,
      fontWeight: 800,
    },
    total: { fontWeight: 900, fontSize: 18, color: "#f9fafb" },
    primary: {
      width: "100%",
      padding: "12px 16px",
      borderRadius: 999,
      fontWeight: 900,
      background:
        "linear-gradient(135deg,#facc15,#a16207 90%)",
      color: "#111827",
      border: "none",
      cursor: "pointer",
      boxShadow: "0 18px 40px rgba(250,204,21,0.45)",
      fontSize: 13,
      letterSpacing: ".14em",
      textTransform: "uppercase",
    },
    ghost: {
      width: "100%",
      padding: "11px 16px",
      borderRadius: 999,
      fontWeight: 800,
      background: "transparent",
      color: "#e5e7eb",
      border: "1px solid rgba(156,163,175,0.7)",
      cursor: "pointer",
      fontSize: 12,
      letterSpacing: ".12em",
      textTransform: "uppercase",
    },
    dashed: {
      borderStyle: "dashed",
    },
    smallHint: {
      fontSize: 11,
      color: "#9ca3af",
    },
    emptyWrap: {
      textAlign: "center",
      padding: "70px 24px",
      background: "#ffffff",
      border: "1px solid #e6eaf6",
      borderRadius: 18,
      boxShadow: "0 18px 50px rgba(8,21,64,.10)",
    },
    emptyTitle: {
      fontWeight: 900,
      fontSize: 24,
      color: "#0f2147",
      marginBottom: 8,
    },
    emptyText: { color: "#6b7280", marginBottom: 18, fontSize: 13 },
    recentWrap: { marginTop: 28 },
    recentGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: 14,
    },
    recentCard: {
      border: "1px solid #eef2ff",
      borderRadius: 14,
      overflow: "hidden",
      background: "#fff",
      boxShadow: "0 8px 22px rgba(15,23,42,0.06)",
    },
    recentImg: {
      width: "100%",
      aspectRatio: "1 / 1",
      objectFit: "cover",
    },
    recentBody: {
      padding: 10,
      display: "grid",
      gap: 6,
    },
    bottomBarSpacer: { height: 80 },
  };

  const goShop = () => router.push("/product");
  const goBack = () => router.back();

  return (
    <>
      {/* Fixed premium navbar (already handles its own layout) */}
      <Navbar />

      <div style={S.page}>
        {/* top bar with conditional Back, title, and counts pill */}
        <div style={S.topbar}>
          <div style={S.leftTop}>
            {canGoBack && (
              <button
                type="button"
                aria-label="Back"
                onClick={goBack}
                style={S.back}
              >
                ←
              </button>
            )}
            <div style={S.titleWrap}>
              <h1 style={S.title}>Your Shopping Bag</h1>
              <div style={S.subtitle}>
                {totalItems > 0 ? (
                  <>
                    {uniqueProductsCount} product
                    {uniqueProductsCount === 1 ? "" : "s"} · {totalItems} item
                    {totalItems === 1 ? "" : "s"} in your bag
                  </>
                ) : (
                  "You haven’t added anything yet."
                )}
              </div>
            </div>
          </div>

          <div style={S.pillCount}>
            {uniqueProductsCount} PRODUCT
            {uniqueProductsCount === 1 ? "" : "S"} · {totalItems} ITEM
            {totalItems === 1 ? "" : "S"}
          </div>
        </div>

        {items.length === 0 ? (
          <div style={S.emptyWrap}>
            <div style={S.emptyTitle}>Your cart is empty.</div>
            <div style={S.emptyText}>
              Discover your next favourite piece from THE DNA LAB CLOTHING.
            </div>
            <button style={S.primary} onClick={goShop}>
              Start shopping
            </button>
          </div>
        ) : (
          <div style={S.layout}>
            {/* Left: list */}
            <div style={S.card}>
              <div style={S.listHead}>
                <div>Item</div>
                <div>Product</div>
                <div>Quantity</div>
                <div>Total</div>
                <div />
              </div>

              {items.map((it, i) => {
                const colorLabel = it.selectedColor || it.color || null;
                const sizeLabel = it.selectedSize || it.size || null;
                const imgSrc = imageFromItem(it);
                const qty = Number(it.quantity ?? it.qty ?? 1);

                return (
                  <div
                    key={`${it.productId || it.id || "p"}-${
                      it.variantId || it.vid || "v"
                    }-${colorLabel || "x"}-${sizeLabel || "x"}-${i}`}
                    style={S.row}
                  >
                    <div style={S.imgWrap}>
                      {imgSrc ? (
                        <img
                          src={imgSrc}
                          alt={it.name || it.title || "Product"}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            color: "#9ca3af",
                          }}
                        >
                          TDLC
                        </div>
                      )}
                    </div>

                    <div>
                      <div style={S.name}>
                        {it.name || it.title || "Product"}
                      </div>
                      <div style={S.meta}>
                        {colorLabel ? (
                          <>
                            Color: <strong>{colorLabel}</strong> •{" "}
                          </>
                        ) : null}
                        {sizeLabel ? (
                          <>
                            Size: <strong>{sizeLabel}</strong>
                          </>
                        ) : null}
                        {!colorLabel && !sizeLabel ? <>&nbsp;</> : null}
                      </div>
                    </div>

                    <div>
                      <div style={S.qtyBox}>
                        <button
                          type="button"
                          style={S.qtyBtn}
                          onClick={() =>
                            setQty(it, Math.max(1, qty - 1))
                          }
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <div style={S.qtyValue}>{qty}</div>
                        <button
                          type="button"
                          style={S.qtyBtn}
                          onClick={() => setQty(it, qty + 1)}
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div style={S.price}>
                      {money(
                        Number(it.price || it.unitPrice || 0) * qty
                      )}
                    </div>

                    <div>
                      <button
                        type="button"
                        style={S.remove}
                        aria-label="Remove item"
                        onClick={() => removeLine(it)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right: summary */}
            <aside style={S.card}>
              <div style={S.summary}>
                <div style={S.summaryCardInner}>
                  <div style={S.rowFlex}>
                    <span style={S.dimLabel}>Products</span>
                    <span>{uniqueProductsCount}</span>
                  </div>
                  <div style={S.rowFlex}>
                    <span style={S.dimLabel}>Items</span>
                    <span>{totalItems}</span>
                  </div>
                  <div style={S.rowFlex}>
                    <span style={S.totalLabel}>Subtotal</span>
                    <span style={S.total}>{money(subtotal)}</span>
                  </div>
                  <div style={S.smallHint}>
                    Shipping &amp; taxes are calculated at checkout.
                  </div>
                </div>

                <button
                  style={{
                    ...S.primary,
                    opacity: syncing ? 0.7 : 1,
                    pointerEvents: syncing ? "none" : "auto",
                  }}
                  onClick={syncAndGo}
                  disabled={syncing}
                  aria-busy={syncing ? "true" : "false"}
                >
                  {syncing ? "Preparing checkout…" : "Proceed to Checkout"}
                </button>

                <button style={S.ghost} onClick={goShop}>
                  Continue Shopping
                </button>
                <button
                  style={{ ...S.ghost, ...S.dashed }}
                  onClick={clearAll}
                  title="Clear cart"
                >
                  Clear Cart
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Recently viewed */}
        {recent.length > 0 && (
          <section style={S.recentWrap}>
            <h2
              style={{
                ...S.title,
                fontSize: 22,
                marginTop: 6,
                marginBottom: 12,
              }}
            >
              Recently Viewed &amp; Related
            </h2>
            <div style={S.recentGrid}>
              {recent.map((r, i) => (
                <article
                  key={(r.slug || r.id || i) + "-rv"}
                  style={S.recentCard}
                >
                  {r.image ? (
                    <img
                      src={r.image}
                      alt={r.name || "Product"}
                      style={S.recentImg}
                    />
                  ) : (
                    <div
                      style={{
                        ...S.recentImg,
                        background:
                          "radial-gradient(circle,#eef2ff,#e5e7eb)",
                      }}
                    />
                  )}
                  <div style={S.recentBody}>
                    <div
                      style={{
                        fontWeight: 800,
                        color: "#0f2147",
                        fontSize: 13,
                      }}
                    >
                      {r.name || r.title || "Product"}
                    </div>
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: 13,
                      }}
                    >
                      {r.price != null
                        ? money(Number(r.price || r.base_price || 0))
                        : "—"}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          r.slug ? `/product/${r.slug}` : "/product"
                        )
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 999,
                        fontWeight: 800,
                        background: "#0f2147",
                        color: "#fff",
                        border: "1px solid #0f2147",
                        cursor: "pointer",
                        fontSize: 12,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                      }}
                    >
                      View Details
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <div style={S.bottomBarSpacer} />
        <BottomFloatingBar />
      </div>
    </>
  );
}
