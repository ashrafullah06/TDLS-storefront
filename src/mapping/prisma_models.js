// FILE: src/mapping/prisma_models.js
/**
 * TDLC Prisma Model Directory (ESM)
 * ---------------------------------
 * - Single source of truth for model identifiers used across the app.
 * - The ONLY required field (for existing usages) is `model`.
 * - Extra meta (delegate, table, primaryKey, label, searchFields, dateFields, relations)
 *   is optional and future-proofs admin/reporting without affecting current logic.
 *
 * Usage (existing code):
 *   import mapping from "@/mapping/prisma_models";
 *   const m = mapping["Product"]; // -> { model: "Product", ... }
 */

/** @typedef {Object} ModelMeta
 *  @property {string} model            // Prisma model name (as declared in schema.prisma)
 *  @property {string} [delegate]       // Preferred PrismaClient delegate (camelCase)
 *  @property {string} [table]          // Underlying DB table/view if applicable
 *  @property {string} [primaryKey]     // Primary key field (default usually "id")
 *  @property {string} [label]          // Human-friendly label field (title/name)
 *  @property {string[]} [unique]       // Candidate unique fields (slug, code, etc.)
 *  @property {string[]} [searchFields] // Default search fields
 *  @property {string[]} [dateFields]   // Date fields often used for range filtering
 *  @property {Record<string,string>} [relations] // Key: relation name, Value: target model
 */

/** @type {Record<string, ModelMeta>} */
const MODELS = {
  // Catalog
  Product: {
    model: "Product",
    delegate: "product",
    label: "title",
    primaryKey: "id",
    unique: ["slug"],
    searchFields: ["title", "slug", "sku"],
    dateFields: ["createdAt", "updatedAt"],
    relations: {
      variants: "ProductVariant",
      categories: "Category",
      brandTier: "BrandTier",
      audience: "AudienceCategory"
    }
  },
  ProductVariant: {
    model: "ProductVariant",
    delegate: "productVariant",
    label: "title",
    primaryKey: "id",
    unique: ["sku", "barcode"],
    searchFields: ["title", "sku", "barcode"],
    dateFields: ["createdAt", "updatedAt"],
    relations: {
      product: "Product",
      optionValues: "ProductVariantOptionValue",
      inventory: "InventoryItem"
    }
  },
  ProductOption: {
    model: "ProductOption",
    delegate: "productOption",
    label: "name",
    primaryKey: "id",
    unique: ["productId", "name"],
    searchFields: ["name"],
    dateFields: ["createdAt", "updatedAt"],
    relations: { product: "Product", values: "ProductOptionValue" }
  },
  ProductOptionValue: {
    model: "ProductOptionValue",
    delegate: "productOptionValue",
    label: "value",
    primaryKey: "id",
    unique: ["optionId", "value"],
    searchFields: ["value"],
    dateFields: ["createdAt", "updatedAt"],
    relations: { option: "ProductOption" }
  },
  ProductVariantOptionValue: {
    model: "ProductVariantOptionValue",
    delegate: "productVariantOptionValue",
    primaryKey: "id",
    relations: { variant: "ProductVariant", optionValue: "ProductOptionValue" }
  },

  // Taxonomy
  Category: {
    model: "Category",
    delegate: "category",
    label: "name",
    primaryKey: "id",
    unique: ["slug"],
    searchFields: ["name", "slug"]
  },
  BrandTier: {
    model: "BrandTier",
    delegate: "brandTier",
    label: "name",
    primaryKey: "id",
    unique: ["slug"],
    searchFields: ["name", "slug"]
  },
  AudienceCategory: {
    model: "AudienceCategory",
    delegate: "audienceCategory",
    label: "name",
    primaryKey: "id",
    unique: ["slug"],
    searchFields: ["name", "slug"]
  },
  Tag: {
    model: "Tag",
    delegate: "tag",
    label: "name",
    primaryKey: "id",
    unique: ["slug"],
    searchFields: ["name", "slug"]
  },
  Color: {
    model: "Color",
    delegate: "color",
    label: "name",
    primaryKey: "id",
    unique: ["code"],
    searchFields: ["name", "code"]
  },
  Size: {
    model: "Size",
    delegate: "size",
    label: "name",
    primaryKey: "id",
    unique: ["code"],
    searchFields: ["name", "code"]
  },

  // Inventory & Purchasing
  InventoryItem: {
    model: "InventoryItem",
    delegate: "inventoryItem",
    primaryKey: "id",
    searchFields: ["sku", "barcode"],
    relations: { variant: "ProductVariant" },
    dateFields: ["createdAt", "updatedAt"]
  },
  StockMovement: {
    model: "StockMovement",
    delegate: "stockMovement",
    primaryKey: "id",
    relations: { inventoryItem: "InventoryItem" },
    dateFields: ["createdAt", "movedAt"]
  },
  PurchaseOrder: {
    model: "PurchaseOrder",
    delegate: "purchaseOrder",
    primaryKey: "id",
    label: "code",
    unique: ["code"],
    dateFields: ["createdAt", "orderedAt", "receivedAt"],
    relations: { supplier: "Supplier" }
  },
  Supplier: {
    model: "Supplier",
    delegate: "supplier",
    primaryKey: "id",
    label: "name",
    searchFields: ["name", "code", "email", "phone"]
  },

  // Sales
  Order: {
    model: "Order",
    delegate: "order",
    primaryKey: "id",
    label: "orderNo",
    unique: ["orderNo"],
    searchFields: ["orderNo", "email", "phone"],
    dateFields: ["createdAt", "updatedAt", "placedAt", "paidAt", "fulfilledAt"],
    relations: { customer: "Customer" }
  },
  OrderItem: {
    model: "OrderItem",
    delegate: "orderItem",
    primaryKey: "id",
    relations: { order: "Order", variant: "ProductVariant" }
  },
  Payment: {
    model: "Payment",
    delegate: "payment",
    primaryKey: "id",
    unique: ["txnId"],
    searchFields: ["txnId", "provider"]
  },
  Refund: {
    model: "Refund",
    delegate: "refund",
    primaryKey: "id",
    relations: { payment: "Payment", order: "Order" }
  },

  // Logistics
  Shipment: {
    model: "Shipment",
    delegate: "shipment",
    primaryKey: "id",
    unique: ["trackingNo"],
    searchFields: ["trackingNo", "courierName"],
    relations: { order: "Order", courier: "Courier" },
    dateFields: ["createdAt", "shippedAt", "deliveredAt"]
  },
  ShipmentItem: {
    model: "ShipmentItem",
    delegate: "shipmentItem",
    primaryKey: "id",
    relations: { shipment: "Shipment", orderItem: "OrderItem" }
  },
  Courier: {
    model: "Courier",
    delegate: "courier",
    primaryKey: "id",
    label: "name",
    unique: ["code"],
    searchFields: ["name", "code"]
  },
  Address: {
    model: "Address",
    delegate: "address",
    primaryKey: "id",
    relations: { customer: "Customer" },
    searchFields: ["name", "phone", "city", "area", "postalCode"]
  },

  // Users/Customers/RBAC
  Customer: {
    model: "Customer",
    delegate: "customer",
    primaryKey: "id",
    label: "name",
    unique: ["email", "phone"],
    searchFields: ["name", "email", "phone"]
  },
  User: {
    model: "User",
    delegate: "user",
    primaryKey: "id",
    label: "name",
    unique: ["email"],
    searchFields: ["name", "email"]
  },
  Role: {
    model: "Role",
    delegate: "role",
    primaryKey: "id",
    label: "name",
    unique: ["name"]
  },
  Permission: {
    model: "Permission",
    delegate: "permission",
    primaryKey: "id",
    label: "code",
    unique: ["code"]
  },

  // Returns & CX
  Return: {
    model: "Return",
    delegate: "return",
    primaryKey: "id",
    relations: { order: "Order" },
    dateFields: ["createdAt", "approvedAt", "receivedAt", "refundedAt"]
  },
  ReturnItem: {
    model: "ReturnItem",
    delegate: "returnItem",
    primaryKey: "id",
    relations: { return: "Return", orderItem: "OrderItem" }
  },
  Review: {
    model: "Review",
    delegate: "review",
    primaryKey: "id",
    relations: { product: "Product", customer: "Customer" }
  },
  SupportTicket: {
    model: "SupportTicket",
    delegate: "supportTicket",
    primaryKey: "id",
    searchFields: ["subject", "ticketNo", "email", "phone"],
    dateFields: ["createdAt", "updatedAt", "closedAt"]
  },

  // Marketing/Content
  Banner: {
    model: "Banner",
    delegate: "banner",
    primaryKey: "id",
    label: "title"
  },
  Page: {
    model: "Page",
    delegate: "page",
    primaryKey: "id",
    label: "title",
    unique: ["slug"],
    searchFields: ["title", "slug"]
  },
  BlogPost: {
    model: "BlogPost",
    delegate: "blogPost",
    primaryKey: "id",
    label: "title",
    unique: ["slug"],
    searchFields: ["title", "slug"]
  },
  FAQ: {
    model: "FAQ",
    delegate: "fAQ",
    primaryKey: "id",
    label: "question"
  },

  // Wallet & Loyalty
  Wallet: {
    model: "Wallet",
    delegate: "wallet",
    primaryKey: "id",
    relations: { customer: "Customer" }
  },
  WalletTransaction: {
    model: "WalletTransaction",
    delegate: "walletTransaction",
    primaryKey: "id",
    relations: { wallet: "Wallet" }
  },
  LoyaltyPoint: {
    model: "LoyaltyPoint",
    delegate: "loyaltyPoint",
    primaryKey: "id",
    relations: { customer: "Customer" }
  },

  // Pricing & Promotions
  Coupon: {
    model: "Coupon",
    delegate: "coupon",
    primaryKey: "id",
    unique: ["code"],
    label: "code"
  },
  Discount: {
    model: "Discount",
    delegate: "discount",
    primaryKey: "id",
    label: "name"
  },
  TaxRate: {
    model: "TaxRate",
    delegate: "taxRate",
    primaryKey: "id",
    label: "name"
  },

  // System
  Setting: {
    model: "Setting",
    delegate: "setting",
    primaryKey: "id",
    label: "key",
    unique: ["key"]
  },
  AuditLog: {
    model: "AuditLog",
    delegate: "auditLog",
    primaryKey: "id",
    dateFields: ["createdAt"]
  },
  WebhookEvent: {
    model: "WebhookEvent",
    delegate: "webhookEvent",
    primaryKey: "id",
    unique: ["eventId"]
  }
};

// Prevent accidental runtime mutation
Object.freeze(MODELS);
for (const k of Object.keys(MODELS)) {
  Object.freeze(MODELS[k]);
}

export default MODELS;
