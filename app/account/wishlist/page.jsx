//app/account/wishlist/page.jsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function safeStr(v) {
  if (v == null) return "";
  return String(v);
}

function money(v) {
  if (v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return safeStr(v);
  try {
    return n.toLocaleString(undefined, { style: "currency", currency: "BDT" });
  } catch {
    return `${n}`;
  }
}

function formatDateTime(v) {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return safeStr(v);
    return d.toLocaleString();
  } catch {
    return safeStr(v);
  }
}

function toCsv(rows) {
  const esc = (x) => {
    const s = safeStr(x);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
  if (typeof window === "undefined") return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function CustomerWishlistPage() {
  const [auth, setAuth] = useState({ authenticated: false, allowed: false });
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("added_desc");
  const [filterSaleOnly, setFilterSaleOnly] = useState(false);
  const [filterInStockOnly, setFilterInStockOnly] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);

  const selectAllRef = useRef(null);

  const [addedToCartKeys, setAddedToCartKeys] = useState(() => new Set());

  function pushNotice(text, type = "info") {
    setNotice({ text, type, ts: Date.now() });
    // auto-clear after a while (keeps UI clean)
    window.clearTimeout(pushNotice._t);
    pushNotice._t = window.setTimeout(() => setNotice(null), 4500);
  }

  function normalizeItem(x) {
    const item = x || {};
    const product = item.product || item.p || {};
    const variant = item.variant || item.v || {};

    const id = safeStr(item.id) || safeStr(item.itemId) || "";
    const wishlistId = safeStr(item.wishlistId) || safeStr(item.wid) || "";

    const productId = safeStr(item.productId || item.pid || product.id) || "";
    const variantId = safeStr(item.variantId || item.vid || variant.id) || "";
    const sizeStockId = safeStr(item.sizeStockId || item.ssid || "") || "";

    const qtyRaw = item.qty ?? item.quantity ?? 1;
    const qty = Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;

    const note = safeStr(item.note) || "";
    const addedAt = item.addedAt || item.createdAt || item.ts || null;

    const title =
      safeStr(item.title) ||
      safeStr(product.title) ||
      safeStr(product.name) ||
      "Untitled product";

    const subtitle =
      safeStr(item.subtitle) ||
      safeStr(product.subtitle) ||
      safeStr(variant.title) ||
      safeStr(variant.name) ||
      "";

    const slug = safeStr(item.slug) || safeStr(product.slug) || "";

    const priceMrp =
      item.priceMrp ??
      item.mrp ??
      product.priceMrp ??
      product.mrp ??
      product.price ??
      null;

    const priceSale =
      item.priceSale ??
      item.sale ??
      product.priceSale ??
      product.salePrice ??
      null;

    const onSale = !!(
      priceSale != null &&
      Number.isFinite(Number(priceSale)) &&
      Number(priceSale) > 0 &&
      priceMrp != null &&
      Number.isFinite(Number(priceMrp)) &&
      Number(priceSale) < Number(priceMrp)
    );

    const stockAvailable =
      item.stockAvailable ??
      item.stock ??
      variant.stockAvailable ??
      product.stockAvailable ??
      null;

    const imageUrl =
      safeStr(product.imageUrl) ||
      safeStr(product.image) ||
      safeStr(item.imageUrl) ||
      safeStr(item.image) ||
      safeStr(product?.media?.[0]?.media?.url) ||
      safeStr(product?.media?.[0]?.url) ||
      "";

    const href = slug ? `/product/${slug}` : productId ? `/product/${productId}` : "/";

    return {
      id,
      wishlistId,
      productId,
      variantId,
      sizeStockId,
      qty: Math.max(1, qty),
      note,
      addedAt,
      product,
      variant,
      title,
      subtitle,
      slug,
      href,
      priceMrp,
      priceSale,
      onSale,
      stockAvailable,
      imageUrl,
    };
  }

  /**
   * IMPORTANT UPGRADE (additive):
   * Some sessions may not include user.id due to older tokens or provider-specific payloads.
   * If we can’t extract an id but we see strong “logged-in evidence”, return a truthy marker
   * so the UI doesn’t incorrectly force a login prompt.
   */
  function extractUserIdFromSessionPayload(data) {
    const u =
      data?.user ||
      data?.session?.user ||
      data?.data?.user ||
      data?.sessionUser ||
      null;

    const id =
      u?.id ??
      u?.userId ??
      data?.userId ??
      data?.uid ??
      data?.id ??
      data?.session?.userId ??
      null;

    if (id) return String(id);

    // Logged-in evidence (additive fallback)
    const hasEvidence =
      !!(
        data?.authenticated === true ||
        u?.email ||
        u?.phone ||
        u?.name ||
        u?.username ||
        u?.identifier ||
        data?.email ||
        data?.phone
      );

    return hasEvidence ? "__SESSION_OK__" : null;
  }

  async function getSessionUserId() {
    try {
      const res = await fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { "cache-control": "no-store" },
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return extractUserIdFromSessionPayload(data);
    } catch {
      return null;
    }
  }

  /**
   * Centralized UI-side auth decision for 401/403:
   * If session exists, do NOT flip UI to logged-out immediately. Ask user to refresh instead.
   * This prevents “extra login” prompts when the customer is actually logged in.
   */
  async function handleAuthFailureUI(messageLoggedIn, messageLoggedOut) {
    const sessionUserId = await getSessionUserId();
    if (sessionUserId) {
      setAuth({ authenticated: true, allowed: true });
      pushNotice(messageLoggedIn || "Session detected. Please refresh.", "error");
      return { treatedAsLoggedIn: true };
    }

    setAuth({ authenticated: false, allowed: false });
    setItems([]);
    setSelected(new Set());
    pushNotice(messageLoggedOut || "Please log in.", "info");
    return { treatedAsLoggedIn: false };
  }

  async function load() {
    setLoading(true);
    setError("");

    const sessionUserId = await getSessionUserId();

    try {
      // IMPORTANT: use canonical wishlist endpoint under /api/auth/*
      const res = await fetch("/api/auth/wishlist?page=1&pageSize=200", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { "cache-control": "no-store" },
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401) {
        if (sessionUserId) {
          setAuth({ authenticated: true, allowed: true });
          setItems([]);
          setSelected(new Set());
          setError("Wishlist could not be loaded. Please refresh.");
          pushNotice("Wishlist could not be loaded. Please refresh.", "error");
          return;
        }

        setAuth({ authenticated: false, allowed: false });
        setItems([]);
        setSelected(new Set());
        return;
      }

      const wishlistOk = !!(res.ok && data?.ok === true);

      if (wishlistOk) {
        setAuth({ authenticated: true, allowed: true });

        const raw = Array.isArray(data?.items) ? data.items : [];
        const normalized = raw.map(normalizeItem).filter((x) => x.id);

        setItems(normalized);
        setSelected(new Set());
        return;
      }

      if (sessionUserId) {
        setAuth({ authenticated: true, allowed: true });
        setItems([]);
        setSelected(new Set());
        const msg = data?.error || "Failed to load wishlist. Please refresh.";
        setError(msg);
        pushNotice(msg, "error");
        return;
      }

      const looksLikeGuest =
        !wishlistOk && (data?.reason === "login_required" || res.status === 403);

      if (looksLikeGuest) {
        setAuth({ authenticated: false, allowed: false });
        setItems([]);
        setSelected(new Set());
        return;
      }

      setItems([]);
      setSelected(new Set());
      setError(data?.error || "Failed to load wishlist.");
      pushNotice(data?.error || "Failed to load wishlist.", "error");
    } catch (e) {
      const sessionUserId2 = await getSessionUserId();
      if (sessionUserId2) setAuth({ authenticated: true, allowed: true });

      const msg = e?.message || "Failed to load wishlist.";
      setError(msg);
      pushNotice(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(it) {
    const item = normalizeItem(it);
    const key = item.id || `${item.productId}:${item.variantId}:${item.sizeStockId}`;
    const busy = `remove:${key}`;

    setBusyKey(busy);
    setError("");

    try {
      // IMPORTANT: use canonical wishlist endpoint under /api/auth/*
      const res = await fetch("/api/auth/wishlist", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
        body: JSON.stringify({
          action: "remove",
          itemId: item.id || null,
          productId: item.productId,
          variantId: item.variantId || null,
          sizeStockId: item.sizeStockId || null,
          pid: item.productId,
          productCode: item.product?.productCode || null,
          slug: item.slug || null,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401 || res.status === 403) {
        await handleAuthFailureUI(
          "Session detected but wishlist request was rejected. Please refresh.",
          "Please log in to manage your wishlist."
        );
        return;
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to remove item.");
      }

      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });

      pushNotice("Removed from wishlist.", "success");
    } catch (e) {
      const msg = e?.message || "Failed to remove item.";
      setError(msg);
      pushNotice(msg, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function addToCart(it) {
    const item = normalizeItem(it);
    const key = item.id || `${item.productId}:${item.variantId}:${item.sizeStockId}`;
    const busy = `cart:${key}`;

    setError("");

    if (addedToCartKeys.has(key)) {
      pushNotice("Already added to cart. Item remains in your wishlist.", "info");
      return;
    }

    setBusyKey(busy);

    try {
      const payloads = [
        {
          action: "add",
          productId: item.productId,
          variantId: item.variantId || null,
          sizeStockId: item.sizeStockId || null,
          qty: 1,
        },
        {
          action: "add",
          items: [
            {
              productId: item.productId,
              variantId: item.variantId || null,
              sizeStockId: item.sizeStockId || null,
              qty: 1,
            },
          ],
        },
        {
          op: "add",
          productId: item.productId,
          variantId: item.variantId || null,
          sizeStockId: item.sizeStockId || null,
          quantity: 1,
        },
      ];

      let ok = false;
      let lastErr = null;

      for (const body of payloads) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch("/api/cart", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body: JSON.stringify(body),
        }).catch((e) => {
          lastErr = e;
          return null;
        });

        if (!res) continue;

        // eslint-disable-next-line no-await-in-loop
        const data = await res.json().catch(() => null);

        if (res.status === 401 || res.status === 403) {
          await handleAuthFailureUI(
            "Session detected but cart request was rejected. Please refresh and try again.",
            "Please log in to add items to cart."
          );
          ok = false;
          lastErr = new Error("Not authenticated.");
          break;
        }

        if (res.ok && data?.ok !== false) {
          ok = true;

          const msg =
            data?.message ||
            data?.status ||
            (data?.alreadyInCart ? "already_in_cart" : null);

          setAddedToCartKeys((prev) => new Set(prev).add(key));

          if (String(msg || "").toLowerCase().includes("already")) {
            pushNotice("Already in cart. Item remains in your wishlist.", "info");
          } else {
            pushNotice("Added to cart. Item remains in your wishlist.", "success");
          }

          break;
        }

        lastErr = new Error(
          data?.error || data?.message || `Cart add failed (${res.status})`
        );
      }

      if (!ok) {
        throw lastErr || new Error("Failed to add to cart.");
      }
    } catch (e) {
      const msg = e?.message || "Failed to add to cart.";
      setError(msg);
      pushNotice(msg, "error");
    } finally {
      setBusyKey(null);
    }
  }

  async function addSelectedToCart() {
    const ids = Array.from(selected || []);
    if (!ids.length) return;

    for (const id of ids) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      // eslint-disable-next-line no-await-in-loop
      await addToCart(it);
    }
  }

  async function removeSelected() {
    const ids = Array.from(selected || []);
    if (!ids.length) return;

    for (const id of ids) {
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      // eslint-disable-next-line no-await-in-loop
      await removeItem(it);
    }
  }

  async function clearAll() {
    if (!items.length) return;

    setBusyKey("clear_all");
    setError("");

    try {
      // IMPORTANT: use canonical wishlist endpoint under /api/auth/*
      const res = await fetch("/api/auth/wishlist", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
        body: JSON.stringify({ action: "clear" }),
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401 || res.status === 403) {
        await handleAuthFailureUI(
          "Session detected but wishlist clear was rejected. Please refresh.",
          "Please log in to manage your wishlist."
        );
        return;
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to clear wishlist.");
      }

      setItems([]);
      setSelected(new Set());
      pushNotice("Wishlist cleared.", "success");
    } catch (e) {
      const msg = e?.message || "Failed to clear wishlist.";
      setError(msg);
      pushNotice(msg, "error");
    } finally {
      setBusyKey(null);
    }
  }

  function setAllSelected(checked) {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    const next = new Set(items.map((x) => x.id).filter(Boolean));
    setSelected(next);
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyListToClipboard() {
    try {
      const lines = (items || []).map((x) => `${x.title} — ${x.href}`);
      const txt = lines.join("\n");
      navigator.clipboard?.writeText(txt);
      pushNotice("Wishlist copied to clipboard.", "success");
    } catch {
      pushNotice("Copy failed.", "error");
    }
  }

  function exportCsv() {
    const rows = (items || []).map((x) => [
      x.title,
      x.product?.productCode || "",
      x.productId,
      x.variantId,
      x.sizeStockId,
      x.qty,
      x.onSale ? "sale" : "",
      x.priceSale ?? "",
      x.priceMrp ?? "",
      x.stockAvailable ?? "",
      x.addedAt ? formatDateTime(x.addedAt) : "",
      x.note || "",
      x.href,
    ]);

    const header = [
      "title",
      "productCode",
      "productId",
      "variantId",
      "sizeStockId",
      "qty",
      "badge",
      "priceSale",
      "priceMrp",
      "stockAvailable",
      "addedAt",
      "note",
      "href",
    ];

    const csv = toCsv([header, ...rows]);
    downloadTextFile(
      `tdlc-wishlist-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    pushNotice("CSV exported.", "success");
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAuthed = !!auth?.authenticated && auth?.allowed !== false;

  const filteredSorted = useMemo(() => {
    const q = safeStr(query).toLowerCase();
    let list = (items || []).slice();

    if (q) {
      list = list.filter((x) => {
        const hay = `${x.title} ${x.subtitle} ${x.product?.productCode || ""} ${
          x.slug || ""
        }`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (filterSaleOnly) list = list.filter((x) => !!x.onSale);

    if (filterInStockOnly) {
      list = list.filter((x) => {
        if (x.stockAvailable == null) return true;
        return Number(x.stockAvailable) > 0;
      });
    }

    const getEffectivePrice = (x) => {
      const sale = x.priceSale != null ? Number(x.priceSale) : null;
      const mrp = x.priceMrp != null ? Number(x.priceMrp) : null;
      if (sale != null && Number.isFinite(sale)) return sale;
      if (mrp != null && Number.isFinite(mrp)) return mrp;
      return Number.POSITIVE_INFINITY;
    };

    const getName = (x) => safeStr(x.title).toLowerCase();
    const getAdded = (x) => {
      const t = x.addedAt ? new Date(x.addedAt).getTime() : 0;
      return Number.isFinite(t) ? t : 0;
    };

    list.sort((a, b) => {
      switch (sortKey) {
        case "added_asc":
          return getAdded(a) - getAdded(b);
        case "price_asc":
          return getEffectivePrice(a) - getEffectivePrice(b);
        case "price_desc":
          return getEffectivePrice(b) - getEffectivePrice(a);
        case "name_asc":
          return getName(a).localeCompare(getName(b));
        case "name_desc":
          return getName(b).localeCompare(getName(a));
        case "added_desc":
        default:
          return getAdded(b) - getAdded(a);
      }
    });

    return list;
  }, [items, query, sortKey, filterSaleOnly, filterInStockOnly]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const selCount = selected.size;
    el.indeterminate = selCount > 0 && selCount < items.length;
  }, [selected, items.length]);

  const selectedCount = selected.size;
  const redirectWishlist = encodeURIComponent("/account/wishlist");

  const totalCount = items.length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-20 pb-28">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            My Wishlist
          </h1>
          <p className="text-sm text-slate-600">
            Wishlist is tied to your account (no guest wishlist).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Continue Shopping
          </Link>

          <button
            onClick={load}
            className="rounded-full bg-[#0F2147] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-60"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {notice ? (
        <div
          className={cls(
            "mt-4 rounded-2xl border px-4 py-3 text-sm shadow-sm",
            notice.type === "success" &&
              "border-emerald-200 bg-emerald-50 text-emerald-800",
            notice.type === "error" && "border-rose-200 bg-rose-50 text-rose-700",
            notice.type === "info" && "border-slate-200 bg-white text-slate-700"
          )}
        >
          {notice.text}
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-600">
            Loading wishlist…
          </div>
        ) : !isAuthed ? (
          <div className="py-10 text-center">
            <div className="mx-auto max-w-md">
              <div className="text-base font-semibold text-slate-900">
                Please log in to view your wishlist
              </div>
              <div className="mt-1 text-sm text-slate-600">
                Wishlist is available only for account holders.
              </div>
              <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Link
                  href={`/login?redirect=${redirectWishlist}`}
                  className="rounded-full bg-[#0F2147] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
                >
                  Login
                </Link>
                <Link
                  href={`/register?redirect=${redirectWishlist}`}
                  className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  Create Account
                </Link>
              </div>
            </div>
          </div>
        ) : totalCount === 0 ? (
          <div className="py-10 text-center">
            <div className="text-base font-semibold text-slate-900">
              Your wishlist is empty
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Browse products and add items to your wishlist.
            </div>
            <div className="mt-5">
              <Link
                href="/"
                className="rounded-full bg-[#0F2147] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
              >
                Explore Products
              </Link>
            </div>
          </div>
        ) : (
          <>
            {error ? (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {/* Controls */}
            <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="w-full">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search wishlist (title, code, slug)…"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-300"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={filterSaleOnly}
                      onChange={(e) => setFilterSaleOnly(e.target.checked)}
                    />
                    Sale only
                  </label>

                  <label className="flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={filterInStockOnly}
                      onChange={(e) => setFilterInStockOnly(e.target.checked)}
                    />
                    In stock only
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-between lg:justify-end">
                <div className="text-sm text-slate-600">
                  {filteredSorted.length} item
                  {filteredSorted.length > 1 ? "s" : ""}
                </div>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <option value="added_desc">Sort: Newest</option>
                  <option value="added_asc">Sort: Oldest</option>
                  <option value="price_asc">Sort: Price (Low–High)</option>
                  <option value="price_desc">Sort: Price (High–Low)</option>
                  <option value="name_asc">Sort: Name (A–Z)</option>
                  <option value="name_desc">Sort: Name (Z–A)</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-between lg:justify-end">
                <button
                  onClick={copyListToClipboard}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  Copy List
                </button>

                <button
                  onClick={exportCsv}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  Export CSV
                </button>
              </div>
            </div>

            {/* Bulk actions */}
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-3 text-sm text-slate-700">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={items.length > 0 && selectedCount === items.length}
                  onChange={(e) => setAllSelected(e.target.checked)}
                />
                Select all
                {selectedCount ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {selectedCount} selected
                  </span>
                ) : null}
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={addSelectedToCart}
                  disabled={!selectedCount}
                  className={cls(
                    "rounded-full px-4 py-2 text-sm font-semibold shadow-sm",
                    selectedCount
                      ? "bg-[#0F2147] text-white hover:opacity-95"
                      : "bg-slate-200 text-slate-500"
                  )}
                >
                  Add Selected to Cart
                </button>

                <button
                  onClick={removeSelected}
                  disabled={!selectedCount}
                  className={cls(
                    "rounded-full px-4 py-2 text-sm font-semibold shadow-sm",
                    selectedCount
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-slate-200 text-slate-500"
                  )}
                >
                  Remove Selected
                </button>

                <button
                  onClick={clearAll}
                  disabled={!items.length}
                  className={cls(
                    "rounded-full px-4 py-2 text-sm font-semibold shadow-sm",
                    items.length
                      ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      : "bg-slate-200 text-slate-500"
                  )}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSorted.map((it) => {
                const priceMrpText =
                  it.priceMrp != null ? money(it.priceMrp) : null;
                const priceSaleText =
                  it.priceSale != null ? money(it.priceSale) : null;

                const showSale = it.onSale && priceSaleText && priceMrpText;

                const stockKnown =
                  it.stockAvailable != null &&
                  Number.isFinite(Number(it.stockAvailable));
                const outOfStock = stockKnown && Number(it.stockAvailable) <= 0;

                const key =
                  it.id || `${it.productId}:${it.variantId}:${it.sizeStockId}`;

                const busyRemove = busyKey === `remove:${key}`;
                const busyCart = busyKey === `cart:${key}`;
                const alreadyAddedToCart = addedToCartKeys.has(key);

                return (
                  <div
                    key={key}
                    className={cls(
                      "rounded-2xl border border-slate-200 bg-white p-3 shadow-sm",
                      outOfStock && "opacity-90"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleSelected(it.id)}
                        />
                        Select
                      </label>

                      <button
                        onClick={() => removeItem(it)}
                        disabled={busyRemove}
                        className={cls(
                          "rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm",
                          busyRemove
                            ? "bg-slate-200 text-slate-600"
                            : "bg-rose-600 text-white hover:bg-rose-700"
                        )}
                      >
                        {busyRemove ? "Removing…" : "Remove"}
                      </button>
                    </div>

                    <Link href={it.href} className="block">
                      <div className="mt-3 aspect-[4/3] w-full overflow-hidden rounded-xl border bg-slate-50">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.imageUrl}
                            alt={it.title}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                            Image unavailable
                          </div>
                        )}
                      </div>

                      <div className="mt-3">
                        <div className="line-clamp-2 text-sm font-semibold text-slate-900">
                          {it.title}
                        </div>

                        {it.subtitle ? (
                          <div className="mt-1 line-clamp-1 text-xs text-slate-600">
                            {it.subtitle}
                          </div>
                        ) : null}

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-600">
                            {it.product?.productCode
                              ? `Code: ${it.product.productCode}`
                              : it.slug
                              ? `Slug: ${it.slug}`
                              : ""}
                          </div>

                          <div className="text-right">
                            {showSale ? (
                              <div className="flex items-baseline gap-2">
                                <div className="text-sm font-semibold text-slate-900">
                                  {priceSaleText}
                                </div>
                                <div className="text-xs text-slate-500 line-through">
                                  {priceMrpText}
                                </div>
                              </div>
                            ) : priceMrpText ? (
                              <div className="text-sm font-semibold text-slate-900">
                                {priceMrpText}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-600">
                            Qty:{" "}
                            <span className="font-semibold text-slate-800">
                              {it.qty}
                            </span>
                          </div>

                          {stockKnown ? (
                            <div className="text-xs text-slate-600">
                              Stock:{" "}
                              <span className="font-semibold text-slate-800">
                                {Number(it.stockAvailable)}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">Stock: —</div>
                          )}
                        </div>

                        {it.note ? (
                          <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                            Note: {it.note}
                          </div>
                        ) : null}
                      </div>
                    </Link>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Link
                        href={it.href}
                        className="col-span-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        View
                      </Link>

                      <button
                        onClick={() => addToCart(it)}
                        disabled={busyCart}
                        className={cls(
                          "col-span-1 rounded-full px-3 py-2 text-sm font-semibold shadow-sm",
                          busyCart
                            ? "bg-slate-200 text-slate-600"
                            : "bg-[#0F2147] text-white hover:opacity-95"
                        )}
                      >
                        {busyCart
                          ? "Adding…"
                          : alreadyAddedToCart
                          ? "Add Again"
                          : "Add to Cart"}
                      </button>

                      <button
                        onClick={() => pushNotice("Wishlist item kept. Use Remove to delete.", "info")}
                        className="col-span-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                      >
                        Note
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
