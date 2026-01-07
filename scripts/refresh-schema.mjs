// scripts/refresh-schema.mjs
import { loadSchema } from "@graphql-tools/load";
import { UrlLoader } from "@graphql-tools/url-loader";
import { printSchemaWithDirectives } from "@graphql-tools/utils";
import fs from "node:fs/promises";
import { graphql, getIntrospectionQuery } from "graphql";

// Uses env loaded by: node --env-file=.env.local ./scripts/refresh-schema.mjs
const endpoint = process.env.STRAPI_GRAPHQL_URL || "http://127.0.0.1:1337/graphql";
const token = process.env.STRAPI_GRAPHQL_TOKEN;

const headers = {};
if (token) headers.Authorization = `Bearer ${token}`;

// 1) Load the schema directly from Strapi
const schema = await loadSchema(endpoint, {
  loaders: [new UrlLoader()],
  headers,
});

// 2) Write **SDL** (preferred for codegen)
const sdlPath = "./src/lib/graphql/schema.graphql";
await fs.mkdir("./src/lib/graphql", { recursive: true });
await fs.writeFile(sdlPath, printSchemaWithDirectives(schema), "utf8");

// 3) (Optional) Also keep JSON for debugging
const result = await graphql({
  schema,
  source: getIntrospectionQuery({
    descriptions: true,
    schemaDescription: true,
    directiveIsRepeatable: true,
    specifiedByUrl: true,
    inputValueDeprecation: true,
  }),
});
if (result.errors?.length) {
  console.error("Introspection errors:", result.errors);
} else {
  await fs.writeFile("./src/lib/graphql/schema.json", JSON.stringify(result.data, null, 2), "utf8");
}

console.log(`✓ Wrote SDL to ${sdlPath}`);
console.log("✓ Wrote JSON to ./src/lib/graphql/schema.json");
