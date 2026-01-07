export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPrisma } from "@/lib/_dynamic_prisma";
import StockSyncButton from "@/components/admin/StockSyncButton";

const MAIN_WAREHOUSE_CODE = "MAIN";

/* ───────────────── helpers ───────────────── */

function hasInventoryAccess(user) {
  if (!user) return false;

  const bag = new Set(
    []
      .concat(user.roles || [])
      .concat(user.permissions || [])
      .concat(user.perms || [])
      .concat(user.role ? [user.role] : [])
      .map((v) => String(v || "").toUpperCase())
  );

  // Tune these tokens to match your existing RBAC
  return (
    bag.has("ADMIN") ||
    bag.has("SUPERADMIN") ||
    bag.has("MANAGE_CATALOG") ||
    bag.has("VIEW_ANALYTICS") ||
    bag.has("MANAGE_INVENTORY")
  );
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/* ───────────────── server action: stock movement ───────────────── */

export async function applyStockMovement(formData) {
  "use server";

  const session = await auth();
  if (!session?.user || !hasInventoryAccess(session.user)) {
    throw new Error("Not authorized to adjust inventory");
  }

  const prisma = await getPrisma();

  const variantId = String(formData.get("variantId") || "").trim();
  const movementType = String(formData.get("movementType") || "").toUpperCase();
  const qtyRaw = String(formData.get("quantity") || "").trim();
  const reason = String(formData.get("reason") || "").trim() || null;
  const warehouseCodeRaw = String(formData.get("warehouseCode") || "").trim();
  const warehouseCode = warehouseCodeRaw || MAIN_WAREHOUSE_CODE;

  const qty = parseInt(qtyRaw, 10);

  if (!variantId) throw new Error("variantId is required");

  if (!["IN", "OUT", "ADJUST"].includes(movementType)) {
    throw new Error("Invalid movementType");
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Quantity must be a positive integer");
  }

  // Ensure variant exists (and fail fast if not)
  const variantExists = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true },
  });

  if (!variantExists) {
    throw new Error("Variant not found");
  }

  // All inventory math + logging + mirroring happens in a single transaction
  await prisma.$transaction(async (tx) => {
    // 1) Ensure warehouse exists (code must be unique in your Prisma schema)
    const warehouse = await tx.warehouse.upsert({
      where: { code: warehouseCode },
      update: {},
      create: {
        code: warehouseCode,
        name:
          warehouseCode === MAIN_WAREHOUSE_CODE
            ? "Main Warehouse"
            : warehouseCode,
      },
    });

    // 2) Ensure InventoryItem row exists for (variantId, warehouseId)
    let inv = await tx.inventoryItem.findUnique({
      where: {
        // @@unique([variantId, warehouseId]) → named variantId_warehouseId in Prisma
        variantId_warehouseId: {
          variantId: variantId,
          warehouseId: warehouse.id,
        },
      },
    });

    if (!inv) {
      inv = await tx.inventoryItem.create({
        data: {
          variantId: variantId,
          warehouseId: warehouse.id,
          onHand: 0,
          reserved: 0,
          safetyStock: 0,
        },
      });
    }

    // 3) Compute new onHand based on movement type
    let newOnHand = inv.onHand;

    if (movementType === "IN") {
      newOnHand = inv.onHand + qty;
    } else if (movementType === "OUT") {
      // Prevent negative on-hand
      newOnHand = Math.max(inv.onHand - qty, 0);
    } else if (movementType === "ADJUST") {
      // Quantity is treated as the NEW physical on-hand count
      newOnHand = qty;
    }

    // 4) Log StockMovement
    await tx.stockMovement.create({
      data: {
        inventoryItemId: inv.id,
        type: movementType,
        quantity: qty,
        reason: reason || `Backoffice ${movementType}`,
        reference: "BACKOFFICE",
      },
    });

    // 5) Update this InventoryItem row
    const updatedInv = await tx.inventoryItem.update({
      where: { id: inv.id },
      data: { onHand: newOnHand },
    });

    // 6) Recompute totals across ALL warehouses for this variant
    const agg = await tx.inventoryItem.aggregate({
      where: { variantId: variantId },
      _sum: {
        onHand: true,
        reserved: true,
        safetyStock: true,
      },
    });

    const onHandTotal = n(agg._sum.onHand);
    const reservedTotal = n(agg._sum.reserved);
    const safetyTotal = n(agg._sum.safetyStock);

    const stockAvailable = Math.max(
      onHandTotal - reservedTotal - safetyTotal,
      0
    );

    // 7) Mirror totals onto ProductVariant (Prisma is the stock master)
    await tx.productVariant.update({
      where: { id: variantId },
      data: {
        stockAvailable,
        stockReserved: reservedTotal,
      },
    });

    return updatedInv;
  });

  // Refresh this page so the admin sees updated numbers instantly
  revalidatePath("/admin/inventory");
}

/* ───────────────── page ───────────────── */

export default async function InventoryPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) {
    // adjust this to your real admin login route if needed
    redirect("/login");
  }
  if (!hasInventoryAccess(session.user)) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-red-600">Access denied</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Your account does not have permission to manage inventory.
        </p>
      </div>
    );
  }

  const prisma = await getPrisma();

  const q = String(searchParams?.q || "").trim();

  const where =
    q.length > 0
      ? {
          OR: [
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q, mode: "insensitive" } },
            {
              product: {
                title: { contains: q, mode: "insensitive" },
              },
            },
            {
              sizeName: { contains: q, mode: "insensitive" },
            },
            {
              colorName: { contains: q, mode: "insensitive" },
            },
          ],
        }
      : {};

  const [variants, warehouses] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { title: true } },
        inventoryItems: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
      },
    }),
    prisma.warehouse.findMany({
      orderBy: { name: "asc" },
    }),
  ]);

  const rows = variants.map((v) => {
    const onHand = v.inventoryItems.reduce(
      (sum, it) => sum + n(it.onHand),
      0
    );
    const reserved = v.inventoryItems.reduce(
      (sum, it) => sum + n(it.reserved),
      0
    );
    const safety = v.inventoryItems.reduce(
      (sum, it) => sum + n(it.safetyStock),
      0
    );
    const available = Math.max(onHand - reserved - safety, 0);

    const warehousesLabel = v.inventoryItems
      .map((it) => {
        const w = it.warehouse;
        const label = w?.name || w?.code || "Unknown";
        return `${label}: ${it.onHand} on hand, ${it.reserved} reserved`;
      })
      .join(" | ");

    return {
      variantId: v.id,
      sku: v.sku || "",
      barcode: v.barcode || "",
      productTitle: v.product?.title || "",
      sizeName: v.sizeName || v.sizeLabel || "",
      colorName: v.colorName || v.colorLabel || "",
      onHand,
      reserved,
      safety,
      available,
      mirroredAvailable: v.stockAvailable, // from ProductVariant
      warehousesLabel,
    };
  });

  const warehouseOptions =
    warehouses.length > 0
      ? warehouses
      : [{ id: "tmp", name: "Main Warehouse (auto)", code: MAIN_WAREHOUSE_CODE }];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Prisma is the stock master. All on-hand / reserved / available
            quantities are derived from <code>InventoryItem</code> and{" "}
            <code>StockMovement</code>.
          </p>
        </div>

        {/* Right: search + sync button */}
        <div className="flex flex-col items-stretch gap-2 md:items-end">
          <form className="flex gap-2" method="GET">
            <input
              name="q"
              defaultValue={q}
              placeholder="Search by SKU, product, color, size, barcode..."
              className="w-64 rounded border border-neutral-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Search
            </button>
          </form>

          {/* Stock sync button (Prisma → Strapi) */}
          <StockSyncButton />
        </div>
      </div>

      {/* Quick Stock Movement */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-neutral-900">
          Quick stock movement
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Use this to record physical stock in/out and adjustments. Each
          operation creates a <code>StockMovement</code>, updates the{" "}
          <code>InventoryItem</code>, and mirrors{" "}
          <code>stockAvailable</code> on the variant.
        </p>

        <form
          action={applyStockMovement}
          className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-end"
        >
          {/* Variant select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">
              Variant (SKU / product / size / color)
            </label>
            <select
              name="variantId"
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            >
              <option value="">Select variant…</option>
              {rows.map((r) => (
                <option key={r.variantId} value={r.variantId}>
                  {r.sku || "No-SKU"} — {r.productTitle}{" "}
                  {r.colorName ? ` / ${r.colorName}` : ""}{" "}
                  {r.sizeName ? ` / ${r.sizeName}` : ""} ({r.available} avail.)
                </option>
              ))}
            </select>
          </div>

          {/* Movement type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">
              Movement Type
            </label>
            <select
              name="movementType"
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            >
              <option value="IN">Stock In (add)</option>
              <option value="OUT">Stock Out (remove)</option>
              <option value="ADJUST">Adjust to physical count</option>
            </select>
          </div>

          {/* Quantity */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-700">
              Quantity
            </label>
            <input
              name="quantity"
              type="number"
              min="1"
              step="1"
              required
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[10px] text-neutral-500">
              For <strong>ADJUST</strong>, this is the new on-hand quantity for
              the selected warehouse.
            </p>
          </div>

          {/* Warehouse + reason + submit */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-700">
                Warehouse
              </label>
              <select
                name="warehouseCode"
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">Auto ({MAIN_WAREHOUSE_CODE})</option>
                {warehouseOptions.map((w) => (
                  <option key={w.id} value={w.code}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <input
              name="reason"
              placeholder="Reason (optional note)"
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            <button
              type="submit"
              className="mt-1 w-full rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Apply movement
            </button>
          </div>
        </form>
      </section>

      {/* Inventory table */}
      <section className="rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-neutral-900">
            Variant inventory snapshot
          </h2>
          <p className="text-[11px] text-neutral-500">
            Showing {rows.length} variants (max 200). On-hand / reserved are
            summed across all warehouses.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Product</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Color</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-3 py-2 text-right">On Hand</th>
                <th className="px-3 py-2 text-right">Reserved</th>
                <th className="px-3 py-2 text-right">Safety</th>
                <th className="px-3 py-2 text-right">Available</th>
                <th className="px-3 py-2 text-right">
                  Variant.stockAvailable
                </th>
                <th className="px-3 py-2 text-left">Warehouses</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-6 text-center text-xs text-neutral-500"
                  >
                    No inventory found. Try changing your search or create stock
                    via the form above.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.variantId}
                    className="border-t border-neutral-100"
                  >
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-neutral-900">
                        {r.productTitle || "Untitled product"}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-neutral-800">
                      {r.sku || (
                        <span className="text-neutral-400">—</span>
                      )}
                      {r.barcode && (
                        <div className="text-[10px] text-neutral-500">
                          {r.barcode}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {r.colorName || (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {r.sizeName || (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums">
                      {r.onHand}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums">
                      {r.reserved}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums">
                      {r.safety}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums font-semibold text-emerald-700">
                      {r.available}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums text-neutral-600">
                      {n(r.mirroredAvailable)}
                    </td>
                    <td className="px-3 py-2 align-top text-[10px] text-neutral-500">
                      {r.warehousesLabel || "No warehouse rows yet"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
