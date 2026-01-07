import rules from "@/config/automation.json" assert { type: "json" };
import { getPrisma } from "@/lib/_dynamic_prisma";
import { M } from "@/lib/_mapping";

// Simple event engine — extend by adding new step "type"s and config/automation.json
export async function runAutomation(event, payload = {}) {
  const cfg = rules[event];
  if (!cfg) return { ok: true, skipped: true };

  const prisma = await getPrisma();

  for (const step of cfg) {
    if (step.type === "restock_from_return") {
      const RTNI = M("ReturnItem");
      const INV = M("Inventory");
      const items = await prisma[RTNI.model].findMany({
        where: { [RTNI.returnId]: payload.returnId }
      });
      for (const it of items) {
        const variantId = it[RTNI.variantId];
        const qty = it[RTNI.qty];
        const firstInv = await prisma[INV.model].findFirst({ where: { [INV.variantId]: variantId } });
        if (firstInv) {
          await prisma[INV.model].update({
            where: { id: firstInv.id },
            data: { [INV.onHand]: Number(firstInv[INV.onHand]) + Number(qty) }
          });
        }
      }
    }
  }
  return { ok: true };
}
