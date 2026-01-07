// FILE: app/(admin)/admin/page.js
import Link from "next/link";
import { cookies, headers } from "next/headers";
import ControlPanelClient from "./control-panel-client";
import { Permissions } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- SSR fetch: preserves cookies & host ---------------- */
async function fetchJson(path, init = {}) {
  const c = await cookies();
  const h = await headers();

  const cookieHeader = c
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  const host =
    h.get("x-forwarded-host") ||
    h.get("host") ||
    process.env.NEXT_PUBLIC_VERCEL_URL ||
    "localhost:3000";

  const proto = h.get("x-forwarded-proto") || "http";

  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `${proto}://${String(host).replace(/^https?:\/\//, "")}`;

  const url = /^https?:\/\//i.test(path)
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;

  // redirect:"manual" prevents following middleware redirects to HTML pages
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    headers: {
      accept: "application/json",
      ...(init.headers || {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      "x-forwarded-host": host,
    },
    ...init,
  });

  // If middleware redirects, avoid JSON parse + let caller decide fallback.
  if (res.status >= 300 && res.status < 400) return null;

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json")) return null;

  try {
    const j = await res.json();
    if (!res.ok) return null;
    return j;
  } catch {
    return null;
  }
}

function fmtMoneyBDT(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "৳0";
  return `৳${Math.round(n).toLocaleString("en-BD")}`;
}

function toStr(v) {
  return v === undefined || v === null ? "" : String(v);
}

/* ---------------- Tile (no UI/UX change; disables prefetch) ---------------- */
function Tile({ title, href, kpi, sub, allowed }) {
  const disabled = allowed === false;

  const hasKpi = kpi !== undefined && kpi !== null && String(kpi).trim() !== "";
  const hasSub = sub !== undefined && sub !== null && String(sub).trim() !== "";

  const tileClass = ["admin-tile", disabled ? "admin-tile--disabled" : ""].join(
    " "
  );

  const content = (
    <div className={tileClass} aria-disabled={disabled || undefined}>
      <div className="admin-tile-title flex items-center justify-between gap-2">
        <span className="admin-tile-titleText">{title}</span>
        <span className="admin-tile-chevron" aria-hidden>
          ›
        </span>
      </div>

      <div className="admin-tile-kpi">{hasKpi ? kpi : "—"}</div>

      <div className="admin-tile-sub">{hasSub ? sub : " "}</div>
    </div>
  );

  if (disabled) {
    return (
      <div className="no-underline" tabIndex={-1}>
        {content}
      </div>
    );
  }

  // IMPORTANT: prefetch disabled to avoid triggering middleware/guards on hover/viewport
  return (
    <Link href={href} className="no-underline" prefetch={false}>
      {content}
    </Link>
  );
}

/* ---------------- MAIN PAGE ---------------- */
export default async function AdminHomePage(props) {
  const searchParams = (await props?.searchParams) || props?.searchParams || {};

  // IMPORTANT:
  // This page must NEVER redirect to login (prevents "auto signout" / gate flip UX).
  // Admin auth should be enforced at route/middleware level, NOT by this dashboard page.
  const jar = await cookies();
  const hasAdminCookie = Boolean(
    jar.get("otp_session_admin")?.value || jar.get("admin_session")?.value
  );

  // Try to load admin session; if it fails (redirect/HTML/DB hiccup), keep dashboard alive.
  const session = (await fetchJson("/api/admin/session")) || null;

  // Permissions: fail-open for dashboard stability (routes enforce auth)
  const rawPerms = Array.isArray(session?.permissions)
    ? session.permissions
    : Array.isArray(session?.user?.permissions)
    ? session.user.permissions
    : null;

  const permSet = rawPerms
    ? new Set(rawPerms.map((p) => String(p || "").toLowerCase()))
    : null;

  const can = (perm) => {
    // FIX: if permissions array is empty, do not disable tiles
    if (!permSet || permSet.size === 0) return true;
    if (!perm) return false;
    return permSet.has(String(perm).toLowerCase());
  };

  const allow = {
    analytics: can(Permissions.VIEW_ANALYTICS) || can(Permissions.VIEW_REPORTS),
    orders: can(Permissions.VIEW_ORDERS) || can(Permissions.MANAGE_ORDERS),
    returns:
      can(Permissions.MANAGE_RETURNS) || can(Permissions.MANAGE_EXCHANGES),
    customers:
      can(Permissions.VIEW_CUSTOMERS) || can(Permissions.MANAGE_CUSTOMERS),

    catalog:
      can(Permissions.MANAGE_CATALOG) ||
      can(Permissions.MANAGE_COLLECTIONS) ||
      can(Permissions.MANAGE_PRODUCTS),

    inventory:
      can(Permissions.VIEW_INVENTORY) || can(Permissions.MANAGE_INVENTORY),

    logistics:
      can(Permissions.VIEW_FULFILLMENT) ||
      can(Permissions.MANAGE_FULFILLMENT),

    tax: can(Permissions.VIEW_FINANCIALS) || can(Permissions.MANAGE_TAX_RATES),

    cart: can(Permissions.VIEW_ANALYTICS),
    checkout: can(Permissions.VIEW_ANALYTICS),

    payments: can(Permissions.MANAGE_PAYMENT_PROVIDERS),

    wallet:
      can(Permissions.MANAGE_WALLET) ||
      can(Permissions.MANAGE_WALLET_LOYALTY),
    loyalty:
      can(Permissions.MANAGE_LOYALTY) ||
      can(Permissions.MANAGE_WALLET_LOYALTY),

    notifications: can(Permissions.MANAGE_AUTOMATIONS),

    promotions:
      can(Permissions.MANAGE_DISCOUNTS) || can(Permissions.MANAGE_SETTINGS),

    cms:
      can(Permissions.MANAGE_CONTENT_PAGES) ||
      can(Permissions.MANAGE_MEDIA_LIBRARY) ||
      can(Permissions.MANAGE_SETTINGS),

    audit: can(Permissions.VIEW_AUDIT_LOGS),
    health: can(Permissions.VIEW_HEALTH) || can(Permissions.VIEW_DEV_TOOLS),

    settings:
      can(Permissions.MANAGE_SETTINGS) ||
      can(Permissions.MANAGE_RBAC) ||
      can(Permissions.MANAGE_APP_SETTINGS),

    reports: can(Permissions.VIEW_REPORTS) || can(Permissions.VIEW_ANALYTICS),
  };

  // Dashboard snapshot (existing wiring)
  const dash = (await fetchJson("/api/admin/dashboard?tz=dhaka")) || null;
  const snap = dash?.snapshot || {};

  const orders = snap.orders || null;
  const returns = snap.returns || null;
  const customers = snap.customers || null;
  const inventory = snap.inventory || null;
  const logistics = snap.logistics || null;
  const tax = snap.tax || null;
  const cart = snap.cart || null;
  const checkout = snap.checkout || null;
  const wallet = snap.wallet || null;
  const loyalty = snap.loyalty || null;
  const notifs = snap.notifications || null;
  const audit = snap.audit || null;
  const health = snap.health || null;

  const paymentsCount =
    snap?.payments?.providersCount != null
      ? snap.payments.providersCount
      : undefined;

  const healthKpi =
    health?.queueDepth != null
      ? `Q: ${health.queueDepth}`
      : health?.status
      ? String(health.status)
      : undefined;

  const revenueTodayText =
    orders?.revenueToday != null ? fmtMoneyBDT(orders.revenueToday) : undefined;

  const q = toStr(searchParams?.q).trim().toLowerCase();
  const match = (title, sub) => {
    if (!q) return true;
    const hay = `${toStr(title)} ${toStr(sub)}`.toLowerCase();
    return hay.includes(q);
  };

  const serverNow = new Date();
  const serverNowText = serverNow.toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const outerStyle = {
    paddingTop: 22,
    paddingBottom: 28,
    paddingLeft: 14,
    paddingRight: 14,
    background:
      "radial-gradient(1200px 480px at 20% 0%, rgba(15,33,71,0.08), rgba(247,248,250,1) 60%), linear-gradient(180deg, #F7F8FA, #FFFFFF 55%)",
    minHeight: "100vh",
  };

  const innerStyle = {
    border: "1px solid rgba(15,33,71,0.10)",
    borderRadius: 22,
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(10px)",
    boxShadow: "0 18px 70px rgba(15,33,71,0.10)",
    maxWidth: 1440,
    margin: "0 auto",
    overflow: "hidden",
  };

  const headerStyle = {
    padding: "18px 22px",
    borderBottom: "1px solid rgba(15,33,71,0.08)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.88))",
  };

  const titleStyle = {
    fontSize: 20,
    fontWeight: 900,
    color: "#0C2340",
    letterSpacing: "-0.02em",
  };

  const subtitleStyle = {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 6,
    lineHeight: 1.55,
  };

  const gridWrap = { padding: 20, paddingTop: 14 };

  const ribbonItems = [
    {
      label: "Orders today",
      value: orders?.ordersToday ?? "—",
      sub: revenueTodayText ? `Revenue: ${revenueTodayText}` : "",
    },
    {
      label: "Low stock",
      value: inventory?.lowStock ?? "—",
      sub: inventory?.products != null ? `Products: ${inventory.products}` : "",
    },
    {
      label: "In transit",
      value: logistics?.byStatus?.in_transit ?? "—",
      sub: "Parcels currently moving",
    },
    {
      label: "Health",
      value: healthKpi ?? "—",
      sub: "Queues / workers",
    },
  ];

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        <div style={headerStyle}>
          <div className="admin-headTop">
            <div>
              <div style={titleStyle}>Admin Dashboard — One-Stop Management</div>
              <div style={subtitleStyle}>
                Keep tiles intact. Faster scanning, cleaner hierarchy, smoother
                interactions.
              </div>
            </div>

            <div className="admin-headRight">
              <div className="admin-badge" title="Server time (Asia/Dhaka)">
                Updated: {serverNowText}
              </div>

              <Link href="/" className="admin-ghostBtn" prefetch={false}>
                Storefront
              </Link>

              <Link
                href="/admin/settings"
                className="admin-ghostBtn"
                prefetch={false}
              >
                Settings
              </Link>
            </div>
          </div>

          <div className="admin-ribbon">
            {ribbonItems.map((it) => (
              <div key={it.label} className="admin-ribbonItem">
                <div className="admin-ribbonLabel">{it.label}</div>
                <div className="admin-ribbonValue">{it.value}</div>
                <div className="admin-ribbonSub">{it.sub || " "}</div>
              </div>
            ))}
          </div>

          <form method="GET" className="admin-searchRow">
            <input
              name="q"
              defaultValue={toStr(searchParams?.q)}
              placeholder="Search tiles… (e.g., orders, inventory, tax)"
              className="admin-searchInput"
            />
            <button type="submit" className="admin-searchBtn">
              Search
            </button>
            <Link href="/admin" className="admin-searchClear" prefetch={false}>
              Clear
            </Link>
          </form>

          {/* Silent admin-cookie indicator (no visible UI change) */}
          <input type="hidden" value={hasAdminCookie ? "1" : "0"} readOnly />
        </div>

        <div style={gridWrap}>
          <div className="admin-dashboard-grid">
            {match("Analytics", "Orders / last 7 days") && (
              <Tile
                title="Analytics"
                href="/admin/analytics"
                kpi={orders?.ordersLast7d}
                sub={
                  orders?.ordersLast7d !== undefined
                    ? "Orders / last 7 days"
                    : undefined
                }
                allowed={allow.analytics}
              />
            )}

            {match(
              "Orders",
              revenueTodayText ? `Revenue today: ${revenueTodayText}` : ""
            ) && (
              <Tile
                title="Orders"
                href="/admin/orders"
                kpi={orders?.ordersToday}
                sub={
                  revenueTodayText !== undefined
                    ? `Revenue today: ${revenueTodayText}`
                    : undefined
                }
                allowed={allow.orders}
              />
            )}

            {match("Returns & Exchanges", "Open cases") && (
              <Tile
                title="Returns & Exchanges"
                href="/admin/returns"
                kpi={returns?.open}
                sub={returns?.open !== undefined ? "Open cases" : undefined}
                allowed={allow.returns}
              />
            )}

            {match(
              "Customers",
              customers?.new7d !== undefined
                ? `New in 7 days: ${customers.new7d}`
                : ""
            ) && (
              <Tile
                title="Customers"
                href="/admin/customers"
                kpi={customers?.total}
                sub={
                  customers?.new7d !== undefined
                    ? `New in 7 days: ${customers.new7d}`
                    : undefined
                }
                allowed={allow.customers}
              />
            )}

            {match("Catalog", "Total products") && (
              <Tile
                title="Catalog"
                href="/admin/catalog"
                kpi={inventory?.products}
                sub={
                  inventory?.products !== undefined
                    ? "Total products"
                    : undefined
                }
                allowed={allow.catalog}
              />
            )}

            {match("Inventory", "Low stock SKUs") && (
              <Tile
                title="Inventory"
                href="/admin/inventory"
                kpi={inventory?.lowStock}
                sub={
                  inventory?.lowStock !== undefined
                    ? "Low stock SKUs"
                    : undefined
                }
                allowed={allow.inventory}
              />
            )}

            {match("Logistics", "Parcels in transit") && (
              <Tile
                title="Logistics"
                href="/admin/logistics"
                kpi={logistics?.byStatus?.in_transit}
                sub={
                  logistics?.byStatus?.in_transit !== undefined
                    ? "Parcels in transit"
                    : undefined
                }
                allowed={allow.logistics}
              />
            )}

            {match(
              "Tax",
              tax?.effectiveRate !== undefined
                ? `Effective rate: ${tax.effectiveRate}%`
                : ""
            ) && (
              <Tile
                title="Tax"
                href="/admin/tax"
                kpi={tax?.collected}
                sub={
                  tax?.effectiveRate !== undefined
                    ? `Effective rate: ${tax.effectiveRate}%`
                    : undefined
                }
                allowed={allow.tax}
              />
            )}

            {match(
              "Carts",
              cart?.abandonRate7d !== undefined
                ? `Abandon (7d): ${cart.abandonRate7d}%`
                : ""
            ) && (
              <Tile
                title="Carts"
                href="/admin/checkout"
                kpi={cart?.activeCarts}
                sub={
                  cart?.abandonRate7d !== undefined
                    ? `Abandon (7d): ${cart.abandonRate7d}%`
                    : undefined
                }
                allowed={allow.cart}
              />
            )}

            {match(
              "Checkout",
              checkout?.conversion != null ? "Conversion (7 days)" : ""
            ) && (
              <Tile
                title="Checkout"
                href="/admin/checkout"
                kpi={
                  checkout?.conversion != null
                    ? `${checkout.conversion}%`
                    : undefined
                }
                sub={
                  checkout?.conversion != null
                    ? "Conversion (7 days)"
                    : undefined
                }
                allowed={allow.checkout}
              />
            )}

            {match(
              "Payments",
              paymentsCount !== undefined ? "Active providers" : ""
            ) && (
              <Tile
                title="Payments"
                href="/admin/payments"
                kpi={paymentsCount}
                sub={paymentsCount !== undefined ? "Active providers" : undefined}
                allowed={allow.payments}
              />
            )}

            {match(
              "Wallet",
              wallet?.totalFloat !== undefined
                ? `Float: ${wallet.totalFloat}`
                : ""
            ) && (
              <Tile
                title="Wallet"
                href="/admin/wallet"
                kpi={wallet?.activeUsers}
                sub={
                  wallet?.totalFloat !== undefined
                    ? `Float: ${wallet.totalFloat}`
                    : undefined
                }
                allowed={allow.wallet}
              />
            )}

            {match("Loyalty & Rewards", "Active members") && (
              <Tile
                title="Loyalty & Rewards"
                href="/admin/loyalty"
                kpi={loyalty?.active}
                sub={loyalty?.active !== undefined ? "Active members" : undefined}
                allowed={allow.loyalty}
              />
            )}

            {match("Promotions", "") && (
              <Tile
                title="Promotions"
                href="/admin/promotions"
                allowed={allow.promotions}
              />
            )}

            {match(
              "Notifications",
              notifs?.deliveries24h !== undefined
                ? `Delivered 24h: ${notifs.deliveries24h}`
                : ""
            ) && (
              <Tile
                title="Notifications"
                href="/admin/notifications"
                kpi={notifs?.queued}
                sub={
                  notifs?.deliveries24h !== undefined
                    ? `Delivered 24h: ${notifs.deliveries24h}`
                    : undefined
                }
                allowed={allow.notifications}
              />
            )}

            {match("CMS (Strapi + Prisma)", "") && (
              <Tile
                title="CMS (Strapi + Prisma)"
                href="/admin/cms"
                allowed={allow.cms}
              />
            )}

            {match(
              "Audit",
              audit?.total7d !== undefined ? "Events (7 days)" : ""
            ) && (
              <Tile
                title="Audit"
                href="/admin/audit"
                kpi={audit?.total7d}
                sub={audit?.total7d !== undefined ? "Events (7 days)" : undefined}
                allowed={allow.audit}
              />
            )}

            {match("Health & Queues", "Service & worker health") && (
              <Tile
                title="Health & Queues"
                href="/admin/health"
                kpi={healthKpi}
                sub={healthKpi ? "Service & worker health" : undefined}
                allowed={allow.health}
              />
            )}

            {match("Settings", "") && (
              <Tile
                title="Settings"
                href="/admin/settings"
                allowed={allow.settings}
              />
            )}

            {match("Reports", "") && (
              <Tile
                title="Reports"
                href="/admin/reports/product-pnl"
                allowed={allow.reports}
              />
            )}
          </div>

          <div style={{ marginTop: 10, marginBottom: 18 }}>
            <ControlPanelClient allow={allow} endpoints={getEndpoints()} />
          </div>
        </div>
      </div>

      <style>{globalStyles}</style>
    </div>
  );
}

function getEndpoints() {
  return {
    logistics: { labelBase: "/api/logistics/labels" },
    payments: { reconcile: "/api/payments/reconcile" },
    notifications: { send: "/api/notifications/send" },
    promotions: {
      coupons: "/api/promotions/coupons",
      banners: "/api/promotions/banners",
    },
    tax: { rules: "/api/tax/rules" },
    cms: {
      strapi: {
        clearCache: "/api/cms/strapi/clear-cache",
        rebuild: "/api/cms/strapi/rebuild",
        publish: "/api/cms/strapi/publish",
      },
      prisma: {
        migrate: "/api/cms/prisma/migrate",
        generate: "/api/cms/prisma/generate",
      },
    },
  };
}

/* Premium global CSS for existing tile system (NO styled-jsx) */
const globalStyles = `
  .no-underline { text-decoration: none; }

  .admin-headTop{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:14px;
    flex-wrap:wrap;
  }
  .admin-headRight{
    display:flex;
    gap:10px;
    align-items:center;
    flex-wrap:wrap;
    justify-content:flex-end;
  }
  .admin-badge{
    border:1px solid rgba(15,33,71,0.12);
    background:rgba(255,255,255,0.8);
    border-radius:999px;
    padding:8px 12px;
    font-size:12px;
    font-weight:800;
    color:#0C2340;
    box-shadow:0 10px 30px rgba(15,33,71,0.08);
    white-space:nowrap;
  }
  .admin-ghostBtn{
    border:1px solid rgba(15,33,71,0.12);
    background:#fff;
    border-radius:999px;
    padding:8px 12px;
    font-size:12px;
    font-weight:800;
    color:#0C2340;
    text-decoration:none;
    box-shadow:0 10px 30px rgba(15,33,71,0.08);
  }
  .admin-ghostBtn:hover{ box-shadow:0 16px 45px rgba(15,33,71,0.12); transform:translateY(-1px); }

  .admin-ribbon{
    margin-top:12px;
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:10px;
  }
  .admin-ribbonItem{
    border:1px solid rgba(15,33,71,0.10);
    background:rgba(255,255,255,0.92);
    border-radius:16px;
    padding:10px 12px;
    box-shadow:0 12px 40px rgba(15,33,71,0.08);
  }
  .admin-ribbonLabel{
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.06em;
    color:#6b7280;
    font-weight:800;
  }
  .admin-ribbonValue{
    margin-top:4px;
    font-size:18px;
    font-weight:900;
    color:#0C2340;
    letter-spacing:-0.02em;
  }
  .admin-ribbonSub{
    margin-top:2px;
    font-size:11px;
    color:#6b7280;
    min-height:14px;
  }

  .admin-searchRow{
    margin-top:12px;
    display:flex;
    gap:10px;
    align-items:center;
    flex-wrap:wrap;
  }
  .admin-searchInput{
    flex:1;
    min-width:240px;
    border:1px solid rgba(15,33,71,0.12);
    border-radius:999px;
    padding:10px 14px;
    font-size:13px;
    outline:none;
    box-shadow:0 10px 30px rgba(15,33,71,0.08);
    background(...)
`;
