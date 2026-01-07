// FILE: src/lib/_mapping.js
// (Only change: import now points to the JS module, no JSON assert.)
import mappingModule from "@/mapping/prisma_models";

const mapping = mappingModule?.default ?? mappingModule;

export function M(name) {
  const m = mapping[name];
  if (!m || !m.model) throw new Error(`Mapping missing for model: ${name}`);
  return m;
}

// Optional convenience (safe to keep; won't break existing callers)
export const hasModel = (name) => !!mapping?.[name]?.model;
export const listModels = () => Object.keys(mapping);
