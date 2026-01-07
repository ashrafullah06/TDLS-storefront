// scripts/fix-strapi-schema.mjs
import fs from 'node:fs';
import path from 'node:path';

const [,, schemaPathArg] = process.argv;
if (!schemaPathArg) {
  console.error('Usage: node scripts/fix-strapi-schema.mjs prisma/strapi/schema.prisma');
  process.exit(1);
}

const schemaPath = path.resolve(schemaPathArg);
let src = fs.readFileSync(schemaPath, 'utf8');

// 1) In datasource: drop deprecated referentialIntegrity and ensure relationMode = "prisma"
src = src.replace(
  /(datasource\s+\w+\s*{[^}]*?)\breferentialIntegrity\s*=\s*".*?"\s*([\s\S]*?})/g,
  (_m, p1, p2) => `${p1}${p2}` // just remove the line; next step ensures relationMode is present
);

// Ensure relationMode = "prisma" exists (idempotent)
src = src.replace(
  /(datasource\s+\w+\s*{[^}]*?)(})/g,
  (_m, body, closing) => {
    if (!/relationMode\s*=/.test(body)) {
      return body.replace(closing, `  relationMode = "prisma"\n${closing}`);
    }
    return body + closing;
  }
);

// 2) For @relation attributes: if onUpdate: NoAction is present but onDelete is missing, add onDelete: NoAction
src = src.replace(
  /@relation\(([^)]*onUpdate:\s*NoAction[^)]*)\)/g,
  (m, inner) => {
    if (/onDelete\s*:/.test(inner)) return m; // already has onDelete
    const withOnDelete = inner.trim().replace(/,\s*$/, '');
    return `@relation(${withOnDelete}, onDelete: NoAction)`;
  }
);

// 3) Make map:"..." names unique within each model block.
// We parse model blocks and de-duplicate map names inside each one.
src = src.replace(
  /(model\s+\w+\s*{)([\s\S]*?)(^\})/gm,
  (modelHeader, open, modelBody, close) => {
    const seen = new Map();
    const newBody = modelBody.replace(
      /(@relation\([^)]*?\bmap:\s*")([^"]+)(")/g,
      (m, pre, name, post) => {
        let final = name;
        if (seen.has(name)) {
          const n = seen.get(name) + 1;
          seen.set(name, n);
          final = `${name}_${n}`;
        } else {
          seen.set(name, 0);
        }
        return `${pre}${final}${post}`;
      }
    );
    return `${open}${newBody}${close}`;
  }
);

// 4) For safety, normalize spacing inside @relation(...) (no functional change)
src = src.replace(/@relation\(\s+/g, '@relation(').replace(/\s+\)/g, ')');

// Write back
fs.writeFileSync(schemaPath, src, 'utf8');

console.log(`✔ Fixed Prisma schema at: ${schemaPath}`);
console.log('Now run:\n  npx prisma format --schema=' + schemaPath + '\n  npx prisma validate --schema=' + schemaPath);
