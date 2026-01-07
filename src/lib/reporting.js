import { fetch_audit_products } from "./fetchproducts";
import * as XLSX from "xlsx";

/**
 * Export sales report.
 * - period: "daily" | "weekly" | "monthly" | "custom" (used for filename)
 * - start/end: optional ISO dates to filter rows (kept feature, now actually used)
 */
export async function export_sales_report({ period = "daily", start, end } = {}) {
  const products = await fetch_audit_products();
  let sold_products = products.filter(p => p.sold_by_personnel && !p.is_returned);

  // Optional date filtering (keeps params in use)
  if (start || end) {
    const s = start ? new Date(start).getTime() : -Infinity;
    const e = end ? new Date(end).getTime() : Infinity;
    sold_products = sold_products.filter(p => {
      const t = p.sold_date ? new Date(p.sold_date).getTime() : 0;
      return t >= s && t <= e;
    });
  }

  const data = sold_products.map(p => ({
    name: p.name,
    sku: p.sku,
    sold_by: p.sold_by_personnel,
    sold_date: p.sold_date,
    price: p.price,
    tier: p.tier,
    returned: p.is_returned,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "sales_report");
  XLSX.writeFile(wb, `sales_report_${period}.xlsx`);
}

export async function export_inventory_report() {
  const products = await fetch_audit_products();
  const data = products.map(p => ({
    name: p.name,
    sku: p.sku,
    stock: p.stock_quantity,
    catagory: p.catagory,
    tier: p.tier,
    warehouse: p.warehouse_location,
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "inventory_report");
  XLSX.writeFile(wb, "inventory_report.xlsx");
}
