// FILE: scripts/prisma/copy-engines.mjs
import fs from "fs";
import path from "path";

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Runtime engine files only:
 * - libquery_engine-* (Node-API)
 * - query-engine-* (binary engine, sometimes used depending on Prisma settings)
 *
 * Exclude schema-engine-* to reduce output size; schema-engine is for migrations/introspection tooling,
 * not for runtime queries in your deployed Next.js app.
 */
function listRuntimeEngineFiles(dir) {
  if (!exists(dir)) return [];
  const names = fs.readdirSync(dir);

  return names.filter(
    (n) =>
      n.startsWith("libquery_engine-") ||
      n.startsWith("query-engine-")
  );
}

function copyFile(src, dstDir) {
  ensureDir(dstDir);
  const dst = path.join(dstDir, path.basename(src));

  // Skip copy if already present with same size (avoids extra writes)
  try {
    if (exists(dst)) {
      const a = fs.statSync(src);
      const b = fs.statSync(dst);
      if (a.size === b.size) return dst;
    }
  } catch {
    // fallthrough to copy
  }

  fs.copyFileSync(src, dst);
  return dst;
}

const repoRoot = process.cwd();
const prismaClientDir = path.join(repoRoot, "node_modules", ".prisma", "client");

const engines = listRuntimeEngineFiles(prismaClientDir);
if (!engines.length) {
  console.error(`[copy-engines] No runtime Prisma engine files found in: ${prismaClientDir}`);
  process.exit(1);
}

/**
 * Copy ONLY to the two generated Prisma client folders (your real outputs).
 * This removes duplication into extra folders that inflate Vercel packaging and cause OOM.
 */
const targets = [
  path.join(repoRoot, "src", "generated", "prisma", "app"),
  path.join(repoRoot, "src", "generated", "prisma", "strapi"),
];

console.log(`[copy-engines] Found runtime engines: ${engines.join(", ")}`);
for (const e of engines) {
  const src = path.join(prismaClientDir, e);
  for (const t of targets) {
    const out = copyFile(src, t);
    console.log(`[copy-engines] Copied: ${src} -> ${out}`);
  }
}
