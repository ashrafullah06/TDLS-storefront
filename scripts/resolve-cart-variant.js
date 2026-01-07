// FILE: src/lib/resolve-cart-variant.js

/**
 * Compatibility wrapper for resolving a cart variant.
 *
 * This simply forwards to resolveVariantIdForCartItem from src/lib/variant-resolver.js
 * so you can:
 *
 *   import resolveCartVariant from "@/lib/resolve-cart-variant";
 *   // or
 *   import { resolveCartVariant } from "@/lib/resolve-cart-variant";
 */

import { resolveVariantIdForCartItem } from "./variant-resolver";

export async function resolveCartVariant(item) {
  return resolveVariantIdForCartItem(item);
}

export default resolveCartVariant;
