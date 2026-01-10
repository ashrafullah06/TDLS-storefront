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

function listEngineFiles(dir) {
  if (!exists(dir)) return [];
  const names = fs.readdirSync(dir);
  // Cover library + binary engine artifacts across platforms
  return names.filter(
    (n) =>
      n.startsWith("libquery_engine-") ||
      n.startsWith("query-engine-") ||
      n.startsWith("schema-engine-")
  );
}

function copyFile(src, dstDir) {
  ensureDir(dstDir);
  const dst = path.join(dstDir, path.basename(src));
  fs.copyFileSync(src, dst);
  return dst;
}

const repoRoot = process.cwd();
const prismaClientDir = path.join(repoRoot, "node_modules", ".prisma", "client");

const engines = listEngineFiles(prismaClientDir);
if (!engines.length) {
  console.error(`[copy-engines] No Prisma engine files found in: ${prismaClientDir}`);
  process.exit(1);
}

const targets = [
  path.join(repoRoot, "src", "generated", "prisma", "app"),
  path.join(repoRoot, "src", "generated", "prisma", "strapi"),
  path.join(repoRoot, "generated", "prisma"),

  // Extra deterministic fallback: Prisma can resolve engines relative to @prisma/client in some serverless bundles
  path.join(repoRoot, "node_modules", "@prisma", "client")
];

console.log(`[copy-engines] Found engines: ${engines.join(", ")}`);
for (const e of engines) {
  const src = path.join(prismaClientDir, e);
  for (const t of targets) {
    const out = copyFile(src, t);
    console.log(`[copy-engines] Copied: ${src} -> ${out}`);
  }
}
