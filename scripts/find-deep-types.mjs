import fs from "node:fs";

const INTROSPECTION_PATH = "./src/lib/graphql/schema.json";
const data = JSON.parse(fs.readFileSync(INTROSPECTION_PATH, "utf8"));
const types = data?.__schema?.types ?? [];

const MAX_SAFE = 7; // standard introspection ofType depth

function depthOf(typeRef) {
  let d = 0, t = typeRef;
  while (t && t.ofType) { d++; t = t.ofType; }
  return d;
}

const hits = [];

for (const t of types) {
  // 1) Output fields
  if (t?.fields) {
    for (const f of t.fields) {
      const d = depthOf(f.type);
      if (d > MAX_SAFE) hits.push({ kind: "FIELD", type: t.name, name: f.name, depth: d });
      // 1a) Field arguments
      if (f?.args) {
        for (const a of f.args) {
          const da = depthOf(a.type);
          if (da > MAX_SAFE) hits.push({ kind: "ARG", type: t.name, field: f.name, name: a.name, depth: da });
        }
      }
    }
  }
  // 2) Input object fields
  if (t?.inputFields) {
    for (const inf of t.inputFields) {
      const di = depthOf(inf.type);
      if (di > MAX_SAFE) hits.push({ kind: "INPUT", type: t.name, name: inf.name, depth: di });
    }
  }
}

if (hits.length === 0) {
  console.log("No fields/args/input-fields exceed wrapper depth 7. The JSON might be malformed or truncated.");
} else {
  console.log("Exceeding wrappers found:");
  for (const h of hits) console.log(h);
  process.exitCode = 1;
}
