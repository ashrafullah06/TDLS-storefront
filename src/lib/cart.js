// FILE: src/lib/cart.js
// Tiny cart + orders layer with localStorage persistence

const CART_KEY = "tdlc_cart_v1";
const ORDERS_KEY = "tdlc_orders_v1";

const rawRead = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
};

const readLines = () => {
  const raw = rawRead(CART_KEY);
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.items)) return raw.items;
  return [];
};

const write = (key, val) => {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("cart:changed"));
    }
  } catch {
    // ignore
  }
};

function line_total(item) {
  const q = Number(item?.qty ?? item?.quantity ?? 0);
  const p = Number(item?.price ?? item?.unitPrice ?? 0);
  if (Number.isNaN(q) || Number.isNaN(p)) return 0;
  return Math.max(0, q) * Math.max(0, p);
}

function numOrNull(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function maxAvailableFrom(item) {
  if (!item || typeof item !== "object") return null;
  const fields = [
    "maxAvailable",
    "max_available",
    "stock",
    "stock_total",
    "stockTotal",
    "inventory",
    "inventoryQty",
    "inventory_qty",
    "availableQty",
    "available_qty",
    "stockAvailable",
    "stock_available",
    "stock_quantity",
    "stockQuantity",
    "sizeStock",
    "size_stock",
    "strapiStockQty",
    "strapi_stock_qty",
  ];
  const vals = [];
  for (const f of fields) {
    const v = numOrNull(item[f]);
    if (v != null && v > 0) vals.push(v);
  }
  if (!vals.length) return null;
  return Math.max(...vals);
}

export { line_total };

export const CartApi = {
  items() {
    return readLines();
  },

  clear() {
    write(CART_KEY, []);
  },

  add(item) {
    // item: { id, slug, name, image, price, currency, color, size, qty, maxAvailable/stock/... }
    const current = readLines();
    const items = [...current];

    const i = items.findIndex(
      (x) => x.id === item.id && x.color === item.color && x.size === item.size
    );

    if (i >= 0) {
      const existing = items[i];
      const max = (() => {
        const a = maxAvailableFrom(existing);
        const b = maxAvailableFrom(item);
        if (a == null && b == null) return null;
        if (a == null) return b;
        if (b == null) return a;
        return Math.max(a, b);
      })();

      const prevQty = Number(existing.qty || existing.quantity || 0) || 0;
      const inc = Number(item.qty || item.quantity || 1) || 1;
      let nextQty = prevQty + inc;
      if (max != null) nextQty = Math.min(nextQty, max);

      items[i] = {
        ...existing,
        ...item,
        qty: Math.max(1, nextQty),
        maxAvailable: max ?? existing.maxAvailable ?? item.maxAvailable ?? null,
        stock: max ?? existing.stock ?? item.stock ?? null,
      };
    } else {
      const max = maxAvailableFrom(item);
      let q = Number(item.qty || item.quantity || 1) || 1;
      if (max != null) q = Math.min(q, max);
      items.push({
        ...item,
        qty: Math.max(1, q),
        maxAvailable: max ?? item.maxAvailable ?? null,
        stock: max ?? item.stock ?? null,
      });
    }

    write(CART_KEY, items);
  },

  remove(index) {
    const items = readLines();
    items.splice(index, 1);
    write(CART_KEY, items);
  },

  set_qty(index, qty) {
    const items = readLines();
    if (items[index]) {
      const max = maxAvailableFrom(items[index]);
      let q = Math.max(1, qty | 0);
      if (max != null) q = Math.min(q, max);
      items[index].qty = q;
      write(CART_KEY, items);
    }
  },

  subtotal() {
    return this.items().reduce((s, it) => s + line_total(it), 0);
  },

  // orders (demo front-end only)
  place_order({ customer = {}, shipping = {}, payment = {} } = {}) {
    const items = this.items();
    const total = items.reduce((s, it) => s + line_total(it), 0);
    const order = {
      id: "ord_" + Math.random().toString(36).slice(2, 10),
      createdAt: new Date().toISOString(),
      items,
      total,
      currency: items[0]?.currency || "BDT",
      customer,
      shipping,
      payment,
      status: "processing",
    };
    const raw = rawRead(ORDERS_KEY);
    const orders = Array.isArray(raw) ? raw : [];
    orders.unshift(order);
    write(ORDERS_KEY, orders);
    this.clear();
    return order;
  },

  orders() {
    const raw = rawRead(ORDERS_KEY);
    return Array.isArray(raw) ? raw : [];
  },
};
