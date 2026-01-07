// FILE: lib/stock/strapiSync.js
export async function runStrapiStockSync({ prisma, triggeredByUser }) {
  // 1. Fetch Strapi products/variants/sizes
  // 2. Upsert Product, ProductVariant (only new sizes→touch stockAvailable/initialStock)
  // 3. Create/append StockSyncLog
  // 4. Return summary
}
