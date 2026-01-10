// FILE: src/lib/prisma-client.js
/**
 * Back-compat shim.
 * Old imports like `@/lib/prisma-client` should resolve to the canonical Prisma singleton in `./prisma`.
 *
 * IMPORTANT:
 * - Do NOT instantiate PrismaClient here; keep a single source of truth to avoid drift.
 */

export { default } from "./prisma";
export * from "./prisma";
