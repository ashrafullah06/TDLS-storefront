// FILE: src/lib/_dynamic_prisma.js
// (If your project currently has this under /lib instead of /src/lib, the code is still valid.)

import prismaDefault, { prisma as prismaNamed } from "@/lib/prisma";

/**
 * Return a Prisma client reliably.
 *
 * Why this approach:
 * - Your alias "@/*" -> "./src/*" is configured in tsconfig【turn4file4†L17-L20】.
 * - Next.js resolves aliases for STATIC imports (compile-time).
 * - Runtime string-based import() discovery is fragile in SSR bundles.
 *
 * This keeps the existing intent ("get Prisma client") but removes the brittle runtime discovery.
 */
export async function getPrisma() {
  const client = prismaNamed || prismaDefault;

  // Minimal sanity check (do NOT over-restrict)
  if (client && typeof client.$transaction === "function") {
    return client;
  }

  // Keep a fallback to db.js ONLY if absolutely needed, without breaking existing logic.
  // We do it via dynamic import, but it is a same-folder spec in your alias world.
  try {
    const dbMod = await import("@/lib/db");
    const appDb = dbMod?.appDb || dbMod?.default?.appDb || null;

    if (appDb && typeof appDb.$transaction === "function") return appDb;
  } catch {
    // ignore
  }

  throw new Error("No Prisma client exported by src/lib/prisma or src/lib/db");
}
