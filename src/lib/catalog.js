//src/lib/catalog.js
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

export async function getAvailabilityByVariantId(variantId) {
  const prisma = await getPrisma();
  const INV = M("Inventory");
  const recs = await prisma[INV.model].findMany({
    where: { [INV.variantId]: typeof variantId === "number" ? variantId : Number(variantId) }
  });
  let onHand = 0, reserved = 0;
  for (const r of recs) {
    onHand += Number(r[INV.onHand] || 0);
    reserved += Number(r[INV.reserved] || 0);
  }
  return { variantId: Number(variantId), onHand, reserved, available: onHand - reserved };
}
