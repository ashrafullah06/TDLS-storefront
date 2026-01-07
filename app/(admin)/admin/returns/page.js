// PATH: app/(admin)/admin/returns/page.jsx
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Return Center • TDLC Admin",
};

import Link from "next/link";
import { redirect } from "next/navigation";

import RerPanel from "../orders/rer-panel";
import { requireAdmin } from "@/lib/auth";
import { Permissions } from "@/lib/rbac";

const NAVY = "#0F2147";
const GOLD = "#D4AF37";
const BORDER = "#E6E9F2";
const MUTED = "#64748b";

function Chip({ children, tone = "neutral" }) {
  const toneStyles =
    tone === "gold"
      ? { border: `1px solid ${GOLD}33`, background: `${GOLD}14`, color: NAVY }
      : tone === "navy"
      ? { border: `1px solid ${NAVY}22`, background: `${NAVY}0D`, color: NAVY }
      : { border: `1px solid ${BORDER}`, background: "#fff", color: MUTED };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.2,
        ...toneStyles,
      }}
    >
      {children}
    </span>
  );
}

export default async function ReturnCenterPage() {
  let admin;
  try {
    // Keep MANAGE_ORDERS for now because your existing RER APIs are gated the same way.
    admin = await requireAdmin(null, { permission: Permissions.MANAGE_ORDERS });
  } catch (err) {
    const status = err?.status || 401;
    if (status === 401) {
      // ✅ Correct next path
      redirect("/login?next=/admin/returns");
    }
    return (
      <div className="mx-auto max-w-5xl px-4 lg:px-6 py-10">
        <div
          className="rounded-2xl border bg-white p-6"
          style={{ borderColor: BORDER }}
        >
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Return Center
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            You don’t have permission to access this area.
          </p>
          <div className="mt-6">
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold border bg-white hover:bg-slate-50 transition"
              style={{ borderColor: BORDER, color: NAVY }}
            >
              Back to Admin
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const userName =
    admin?.session?.user?.name ||
    admin?.session?.user?.email ||
    admin?.session?.user?.phone ||
    "Admin";
  const roles = Array.isArray(admin?.roles) ? admin.roles : [];

  return (
    <div className="mx-auto max-w-7xl px-4 lg:px-6 py-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900">
              Return Center
            </h1>
            <Chip tone="navy">Reporting • Approvals • Stock Sync</Chip>
          </div>

          <p className="text-sm text-slate-600 max-w-4xl">
            Central control plane for <b>Returns</b>, <b>Exchanges</b>, and{" "}
            <b>Refunds</b> — unified view across website requests and showroom
            manual entries. Stock is updated only after admin approval.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <Chip tone="gold">Live DB • No cache</Chip>
            <Chip>{`Signed in as: ${userName}`}</Chip>
            {roles.length ? <Chip>{`Roles: ${roles.join(", ")}`}</Chip> : null}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Link
            href="/admin/orders"
            className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold shadow-sm border transition"
            style={{
              borderColor: BORDER,
              background: "#fff",
              color: NAVY,
            }}
          >
            Go to Orders
          </Link>

          <Link
            href="/admin"
            className="inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-semibold shadow-sm transition"
            style={{
              background: NAVY,
              color: "#fff",
            }}
          >
            Admin Home
          </Link>
        </div>
      </header>

      <section
        className="rounded-3xl border bg-white"
        style={{
          borderColor: BORDER,
          boxShadow: "0 18px 60px rgba(15,23,42,0.08)",
        }}
      >
        <div className="p-4 md:p-6">
          <RerPanel defaultTab="overview" />
        </div>
      </section>
    </div>
  );
}
