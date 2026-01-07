// src/lib/db.js
// Keeps your current shape but adds a dev-time write guard for the Strapi client.

const { PrismaClient: StrapiPrisma } = require("../generated/prisma/strapi");
const { PrismaClient: AppPrisma } = require("../generated/prisma/app");

const g = globalThis;

// --- tiny helper to block mutation methods on the RO client in dev ---
function wrapReadOnly(client) {
  if (process.env.NODE_ENV === "production") return client; // DB role still enforces RO
  const forbidden = new Set([
    "create",
    "createMany",
    "update",
    "updateMany",
    "upsert",
    "delete",
    "deleteMany",
    "$executeRaw",
    "$executeRawUnsafe",
  ]);
  return new Proxy(client, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && forbidden.has(prop)) {
        throw new Error(
          `[READ-ONLY] Prisma write method '${prop}' is disabled on strapiDb`
        );
      }
      return v;
    },
  });
}

// Strapi (READ-ONLY client)
const _strapi = g.__strapiDb__ || new StrapiPrisma();
const strapiDb = wrapReadOnly(_strapi);
if (process.env.NODE_ENV !== "production") g.__strapiDb__ = _strapi;

// App (WRITE client)
const appDb = g.__appDb__ || new AppPrisma();
if (process.env.NODE_ENV !== "production") g.__appDb__ = appDb;

// ✅ FIX: Export in both CommonJS + ESM compatible way
const db = { strapiDb, appDb };
module.exports = db;
module.exports.strapiDb = strapiDb;
module.exports.appDb = appDb;
export { strapiDb, appDb };
export default db;
