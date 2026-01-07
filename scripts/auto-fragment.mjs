// scripts/auto-fragment.mjs
import fs from "node:fs";
import path from "node:path";

const schemaPath = path.join(process.cwd(), "src", "lib", "graphql", "schema.json");
const outDir = path.join(process.cwd(), "src", "lib", "graphql", "fragments");
const outFile = path.join(outDir, "product.generated.graphql");

// In Strapi v4, the attributes live on type "Product" (used under entity.attributes).
// If your content-type is named differently, change the name below:
const TARGET_TYPE = "Product";

// Treat these as scalars we want to include directly:
const SCALAR_KINDS = new Set(["SCALAR", "ENUM"]);
const STRAPI_SYSTEM_SCALARS = new Set(["ID", "String", "Int", "Float", "Boolean", "DateTime", "JSON", "Upload", "Long"]);

function unwrap(t) {
  // Unwrap ofType chain
  let cur = t;
  while (cur && cur.ofType) cur = cur.ofType;
  return cur || t;
}

function loadSchema() {
  const json = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  return json.__schema;
}

function indexTypes(__schema) {
  const map = new Map();
  for (const t of __schema.types) map.set(t.name, t);
  return map;
}

function findType(map, name) {
  const t = map.get(name);
  if (!t) throw new Error(`Type "${name}" not found in schema`);
  return t;
}

// Returns { scalars: string[], relations: string[] }
function extractFields(productType, typeIndex) {
  const scalars = [];
  const relations = [];

  for (const f of productType.fields || []) {
    const base = unwrap(f.type);
    const kind = base.kind;
    const name = f.name;

    // Skip internal GraphQL stuff
    if (name.startsWith("__")) continue;

    if (SCALAR_KINDS.has(kind) || STRAPI_SYSTEM_SCALARS.has(base.name)) {
      scalars.push(name);
      continue;
    }

    // For object/list fields, treat as relation/component; just select id(s)
    if (kind === "OBJECT" || kind === "INTERFACE" || kind === "UNION" || kind === "LIST") {
      relations.push(name);
    }
  }

  // Always include these system fields if present
  for (const sys of ["createdAt", "updatedAt", "publishedAt"]) {
    if (!scalars.includes(sys) && productType.fields?.some(f => f.name === sys)) {
      scalars.push(sys);
    }
  }

  return { scalars, relations };
}

function buildFragment({ scalars, relations }) {
  const lines = [];
  lines.push(`# AUTO-GENERATED. Do not edit by hand.`);
  lines.push(`# Regenerate via: npm run gql:auto:fragments`);
  lines.push(``);
  lines.push(`fragment ProductAuto on ${TARGET_TYPE} {`);

  // Scalars
  for (const s of scalars.sort()) {
    lines.push(`  ${s}`);
  }

  // Minimal relation selections -> data { id }
  for (const r of relations.sort()) {
    lines.push(`
  ${r} {
    data {
      ... on UploadFileEntity {
        id
      }
      ... on CategoryEntity {
        id
      }
      ... on ${TARGET_TYPE}Entity {
        id
      }
      ... on GenericMorph {
        __typename
      }
      id
    }
  }`.trim());
  }

  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}

function main() {
  const __schema = loadSchema();
  const idx = indexTypes(__schema);
  const product = findType(idx, TARGET_TYPE);

  const { scalars, relations } = extractFields(product, idx);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, buildFragment({ scalars, relations }), "utf8");
  console.log(`✓ Wrote ${outFile}`);
}

main();
