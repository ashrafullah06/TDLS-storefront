// PATH: src/lib/rbac.js
//
// TDLC RBAC — Extended “E-commerce Universe” Permission Map
//
// This file defines:
// - Roles
// - Permissions
// - ROLE_PERMISSIONS (default grants)
// - Helpers: userRoles(), isAdminRole(), isAdminPortalRole(), hasPermission(), permissionsFor()
// - Optional OTP gating map: otpPurposeForPermission()
//
// IMPORTANT GUARANTEE:
// - No existing exports removed.
// - Existing Roles/Permissions keys are preserved.
// - Additions are additive and safe: they do nothing unless you start using them.

//
// ────────────────────────────────────────────────────────────────────────
// ROLES
// ────────────────────────────────────────────────────────────────────────
//

export const Roles = {
  // Existing core roles
  SUPERADMIN: "superadmin",
  ADMIN: "admin",
  MANAGER: "manager",
  FINANCE: "finance",
  ANALYST: "analyst",
  STAFF: "staff",

  // Suggested additional e-commerce roles
  SUPPORT: "support",
  OPERATIONS: "operations",
  WAREHOUSE: "warehouse",
  INVENTORY_MANAGER: "inventory_manager",
  MARKETING: "marketing",
  CONTENT_MANAGER: "content_manager",
  DISPATCHER: "dispatcher",
  AUDITOR: "auditor",
  READONLY: "readonly",

  // Additional high-value roles
  GROWTH: "growth",
  CRM: "crm",
  SEO: "seo",
  MODERATOR: "moderator",
  LOGISTICS_MANAGER: "logistics_manager",
  COMPLIANCE: "compliance",
  FRAUD_ANALYST: "fraud_analyst",
  DEVOPS: "devops",

  // “Enterprise / advanced commerce” roles (new, additive)
  PROCUREMENT: "procurement", // suppliers, purchase orders, inbound shipments
  MERCHANDISER: "merchandiser", // collections, placement, onsite merchandising
  PRICING_MANAGER: "pricing_manager", // price books, markdown rules, margin controls
  PARTNER_MANAGER: "partner_manager", // affiliates, influencers, wholesale accounts
  MARKETPLACE_MANAGER: "marketplace_manager", // sellers, commissions, disputes
  POS_MANAGER: "pos_manager", // physical store POS, registers, staff shifts
  DATA_STEWARD: "data_steward", // exports, retention, governance, PII workflows
  QA: "qa", // QA and staging validation, preflight checks
  CUSTOMER_SUCCESS: "customer_success", // VIP care, refunds/escalations (gated)
};

export const ALL_ROLES = Object.values(Roles);

//
// ────────────────────────────────────────────────────────────────────────
// PERMISSIONS
// ────────────────────────────────────────────────────────────────────────
//

// NOTE:
// - Keep existing permission keys unchanged.
// - Add new ones for feature completeness.
// - All are lowercase strings (recommended).

export const Permissions = {
  // ── Core analytics & reporting ──
  VIEW_ANALYTICS: "view_analytics",
  VIEW_REPORTS: "view_reports",
  VIEW_PRODUCT_PNL: "view_product_pnl",
  VIEW_AUDIT_LOGS: "view_audit_logs",
  VIEW_FINANCIALS: "view_financials",

  // ── Management actions (users, products, orders) ──
  MANAGE_USERS: "manage_users",
  MANAGE_PRODUCTS: "manage_products",
  MANAGE_ORDERS: "manage_orders",

  // ── Catalog & merchandising ──
  MANAGE_CATALOG: "manage_catalog",
  MANAGE_COLLECTIONS: "manage_collections",
  MANAGE_PRICING: "manage_pricing",
  MANAGE_DISCOUNTS: "manage_discounts",

  // ── Customer & CRM ──
  VIEW_CUSTOMERS: "view_customers",
  MANAGE_CUSTOMERS: "manage_customers",
  VIEW_CUSTOMER_SENSITIVE: "view_customer_sensitive",
  VIEW_TICKETS: "view_tickets",
  MANAGE_TICKETS: "manage_tickets",

  // ── Orders & fulfillment ──
  VIEW_ORDERS: "view_orders",
  VIEW_FULFILLMENT: "view_fulfillment",
  MANAGE_FULFILLMENT: "manage_fulfillment",
  MANAGE_RETURNS: "manage_returns",
  MANAGE_EXCHANGES: "manage_exchanges",

  // ── Inventory & warehouse ──
  VIEW_INVENTORY: "view_inventory",
  MANAGE_INVENTORY: "manage_inventory",
  VIEW_WAREHOUSES: "view_warehouses",
  MANAGE_WAREHOUSES: "manage_warehouses",

  // ── Payment & finance ops ──
  MANAGE_PAYMENT_PROVIDERS: "manage_payment_providers",
  MANAGE_REFUNDS: "manage_refunds",
  MANAGE_INVOICES: "manage_invoices",
  MANAGE_PAYOUTS: "manage_payouts",
  MANAGE_TAX_RATES: "manage_tax_rates",

  // ── Wallet & loyalty ──
  MANAGE_WALLET: "manage_wallet",
  MANAGE_LOYALTY: "manage_loyalty",
  MANAGE_WALLET_LOYALTY: "manage_wallet_loyalty",

  // ── Content & CMS ──
  MANAGE_CONTENT_PAGES: "manage_content_pages",
  MANAGE_MEDIA_LIBRARY: "manage_media_library",

  // ── Automation & system settings ──
  VIEW_HEALTH: "view_health",
  MANAGE_SETTINGS: "manage_settings",
  MANAGE_AUTOMATIONS: "manage_automations",
  MANAGE_RBAC: "manage_rbac",
  MANAGE_APP_SETTINGS: "manage_app_settings",
  IMPERSONATE_USER: "impersonate_user",

  // ── Developer / diagnostic (optional) ──
  VIEW_DEV_TOOLS: "view_dev_tools",

  // ─────────────────────────────────────────────────────────────
  // Notifications, CRM, Marketing, Reviews, Risk, Ops (existing)
  // ─────────────────────────────────────────────────────────────

  // Notifications (customer-facing)
  VIEW_NOTIFICATIONS: "view_notifications",
  MANAGE_NOTIFICATIONS: "manage_notifications",
  SEND_NOTIFICATIONS: "send_notifications",
  MANAGE_NOTIFICATION_TEMPLATES: "manage_notification_templates",
  MANAGE_NOTIFICATION_SEGMENTS: "manage_notification_segments",
  MANAGE_NOTIFICATION_CHANNELS: "manage_notification_channels",
  VIEW_NOTIFICATION_DELIVERABILITY: "view_notification_deliverability",

  // CRM / Lifecycle
  MANAGE_SEGMENTS: "manage_segments",
  MANAGE_CUSTOMER_TAGS: "manage_customer_tags",
  MANAGE_CUSTOMER_NOTES: "manage_customer_notes",
  MANAGE_COUPON_TARGETING: "manage_coupon_targeting",
  VIEW_CUSTOMER_TIMELINE: "view_customer_timeline",

  // Marketing / Growth
  MANAGE_CAMPAIGNS: "manage_campaigns",
  MANAGE_PROMOTIONS: "manage_promotions",
  MANAGE_PROMOBAR: "manage_promobar",
  MANAGE_HOMEPAGE_SECTIONS: "manage_homepage_sections",
  MANAGE_AB_TESTS: "manage_ab_tests",

  // Reviews & UGC
  VIEW_REVIEWS: "view_reviews",
  MODERATE_REVIEWS: "moderate_reviews",
  MANAGE_REVIEWS: "manage_reviews",
  VIEW_COMPLAINTS: "view_complaints",
  MANAGE_COMPLAINTS: "manage_complaints",

  // Shipping / Couriers / Logistics
  VIEW_SHIPPING: "view_shipping",
  MANAGE_SHIPPING_RATES: "manage_shipping_rates",
  MANAGE_COURIERS: "manage_couriers",
  MANAGE_DISPATCH_RULES: "manage_dispatch_rules",
  MANAGE_RTO: "manage_rto",

  // Fraud / Risk / Security
  VIEW_RISK: "view_risk",
  MANAGE_RISK_RULES: "manage_risk_rules",
  MANAGE_FRAUD_CASES: "manage_fraud_cases",
  MANAGE_CHARGEBACKS: "manage_chargebacks",
  VIEW_SECURITY_LOGS: "view_security_logs",

  // Data export / compliance
  EXPORT_DATA: "export_data",
  EXPORT_PII: "export_pii",
  DELETE_PII: "delete_pii",
  MANAGE_RETENTION: "manage_retention",
  MANAGE_CONSENT: "manage_consent",

  // Integrations / Webhooks / API
  VIEW_INTEGRATIONS: "view_integrations",
  MANAGE_INTEGRATIONS: "manage_integrations",
  MANAGE_WEBHOOKS: "manage_webhooks",
  MANAGE_API_KEYS: "manage_api_keys",

  // Catalog enrichment
  MANAGE_SEO: "manage_seo",
  VIEW_SEO: "view_seo",
  MANAGE_SITEMAP: "manage_sitemap",
  MANAGE_STRUCTURED_DATA: "manage_structured_data",

  // Warehouse ops extras
  MANAGE_STOCK_ADJUSTMENTS: "manage_stock_adjustments",
  APPROVE_STOCK_ADJUSTMENTS: "approve_stock_adjustments",

  // Financial ops extras
  RUN_RECONCILIATION: "run_reconciliation",
  VIEW_LEDGER: "view_ledger",
  MANAGE_LEDGER: "manage_ledger",

  // ─────────────────────────────────────────────────────────────
  // “E-commerce Universe” additions (new)
  // ─────────────────────────────────────────────────────────────

  // Storefront configuration
  MANAGE_STOREFRONT_THEME: "manage_storefront_theme",
  MANAGE_NAVIGATION: "manage_navigation",
  MANAGE_SEARCH: "manage_search",
  MANAGE_SITE_BANNERS: "manage_site_banners",
  MANAGE_SITE_FOOTER: "manage_site_footer",
  MANAGE_SITE_LEGAL: "manage_site_legal",
  MANAGE_LANGUAGES: "manage_languages",
  MANAGE_CURRENCIES: "manage_currencies",
  MANAGE_REGIONS: "manage_regions",

  // Pricing engine (advanced)
  MANAGE_PRICE_BOOKS: "manage_price_books",
  MANAGE_MARKDOWNS: "manage_markdowns",
  MANAGE_MARGIN_RULES: "manage_margin_rules",
  VIEW_MARGIN: "view_margin",

  // Promotions (advanced)
  MANAGE_BUNDLES: "manage_bundles",
  MANAGE_BOGO_RULES: "manage_bogo_rules",
  MANAGE_GIFT_CARDS: "manage_gift_cards",
  MANAGE_STORE_CREDITS: "manage_store_credits",
  MANAGE_REFERRALS: "manage_referrals",
  MANAGE_AFFILIATES: "manage_affiliates",

  // Subscriptions / memberships
  MANAGE_SUBSCRIPTIONS: "manage_subscriptions",
  MANAGE_MEMBERSHIPS: "manage_memberships",

  // Marketplace / wholesale / B2B
  MANAGE_WHOLESALE: "manage_wholesale",
  MANAGE_B2B_PRICING: "manage_b2b_pricing",
  MANAGE_PARTNERS: "manage_partners",
  MANAGE_MARKETPLACE: "manage_marketplace",
  MANAGE_SELLERS: "manage_sellers",
  MANAGE_COMMISSIONS: "manage_commissions",
  MANAGE_SELLER_PAYOUTS: "manage_seller_payouts",
  MANAGE_DISPUTES: "manage_disputes",

  // Procurement / suppliers / inbound
  VIEW_SUPPLIERS: "view_suppliers",
  MANAGE_SUPPLIERS: "manage_suppliers",
  VIEW_PURCHASE_ORDERS: "view_purchase_orders",
  MANAGE_PURCHASE_ORDERS: "manage_purchase_orders",
  MANAGE_INBOUND_SHIPMENTS: "manage_inbound_shipments",

  // Warehouse fulfillment depth
  MANAGE_PICK_PACK: "manage_pick_pack",
  MANAGE_BARCODE_FLOWS: "manage_barcode_flows",
  MANAGE_PACKAGING_RULES: "manage_packaging_rules",

  // Returns lifecycle depth
  MANAGE_RMA: "manage_rma",
  MANAGE_RETURN_QC: "manage_return_qc",
  MANAGE_RESTOCK_POLICIES: "manage_restock_policies",

  // Customer communications depth
  MANAGE_MESSAGE_TEMPLATES: "manage_message_templates",
  VIEW_MESSAGE_LOGS: "view_message_logs",
  MANAGE_CHAT: "manage_chat",
  MANAGE_KNOWLEDGE_BASE: "manage_knowledge_base",

  // Fraud / risk depth
  MANAGE_DEVICE_TRUST: "manage_device_trust",
  MANAGE_BLOCKLISTS: "manage_blocklists",
  MANAGE_RATE_LIMITS: "manage_rate_limits",

  // Observability / ops
  VIEW_METRICS: "view_metrics",
  VIEW_LOGS: "view_logs",
  MANAGE_ALERTS: "manage_alerts",
  MANAGE_JOBS: "manage_jobs",
  MANAGE_CRONS: "manage_crons",

  // Experimentation & personalization
  MANAGE_PERSONALIZATION: "manage_personalization",
  MANAGE_RECOMMENDATIONS: "manage_recommendations",
  VIEW_EXPERIMENT_RESULTS: "view_experiment_results",

  // POS / offline
  MANAGE_POS: "manage_pos",
  MANAGE_REGISTERS: "manage_registers",
  MANAGE_SHIFTS: "manage_shifts",

  // Governance / data lifecycle
  MANAGE_DATA_GOVERNANCE: "manage_data_governance",
  APPROVE_EXPORTS: "approve_exports",
  APPROVE_DELETIONS: "approve_deletions",
};

export const ALL_PERMISSIONS = Object.values(Permissions);

//
// ────────────────────────────────────────────────────────────────────────
// ROLE_PERMISSIONS (default grants)
// ────────────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS = {
  // SUPERADMIN: full control over everything.
  [Roles.SUPERADMIN]: new Set(ALL_PERMISSIONS),

  // ADMIN: near-full control (still includes sensitive actions; you can OTP-gate).
  [Roles.ADMIN]: new Set([
    ...ALL_PERMISSIONS.filter((p) => p !== Permissions.APPROVE_DELETIONS), // example: reserve ultra-dangerous ops
  ]),

  [Roles.MANAGER]: new Set([
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.VIEW_PRODUCT_PNL,
    Permissions.VIEW_ORDERS,
    Permissions.MANAGE_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
    Permissions.MANAGE_RETURNS,
    Permissions.MANAGE_EXCHANGES,
    Permissions.MANAGE_RTO,
    Permissions.VIEW_CUSTOMERS,
    Permissions.MANAGE_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_TIMELINE,
    Permissions.MANAGE_CUSTOMER_NOTES,
    Permissions.MANAGE_CUSTOMER_TAGS,
    Permissions.VIEW_INVENTORY,
    Permissions.MANAGE_INVENTORY,
    Permissions.VIEW_SHIPPING,
    Permissions.MANAGE_DISPATCH_RULES,
    Permissions.VIEW_REVIEWS,
    Permissions.MODERATE_REVIEWS,
    Permissions.MANAGE_CAMPAIGNS,
    Permissions.MANAGE_PROMOTIONS,
    Permissions.MANAGE_DISCOUNTS,
    Permissions.MANAGE_COLLECTIONS,
    Permissions.MANAGE_CATALOG,
    Permissions.MANAGE_HOMEPAGE_SECTIONS,
    Permissions.MANAGE_PROMOBAR,
    Permissions.VIEW_NOTIFICATIONS,
    Permissions.SEND_NOTIFICATIONS,
    Permissions.VIEW_HEALTH,
  ]),

  [Roles.FINANCE]: new Set([
    Permissions.VIEW_FINANCIALS,
    Permissions.VIEW_LEDGER,
    Permissions.MANAGE_LEDGER,
    Permissions.RUN_RECONCILIATION,
    Permissions.MANAGE_REFUNDS,
    Permissions.MANAGE_INVOICES,
    Permissions.MANAGE_PAYOUTS,
    Permissions.MANAGE_TAX_RATES,
    Permissions.MANAGE_PAYMENT_PROVIDERS,
    Permissions.MANAGE_CHARGEBACKS,
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.EXPORT_DATA,
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.VIEW_PRODUCT_PNL,
  ]),

  [Roles.ANALYST]: new Set([
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.VIEW_PRODUCT_PNL,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_INVENTORY,
    Permissions.VIEW_SHIPPING,
    Permissions.VIEW_SEO,
    Permissions.VIEW_NOTIFICATION_DELIVERABILITY,
    Permissions.VIEW_AUDIT_LOGS,
  ]),

  [Roles.STAFF]: new Set([
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_TICKETS,
    Permissions.MANAGE_TICKETS,
  ]),

  [Roles.SUPPORT]: new Set([
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_SENSITIVE,
    Permissions.VIEW_CUSTOMER_TIMELINE,
    Permissions.MANAGE_CUSTOMER_NOTES,
    Permissions.MANAGE_CUSTOMER_TAGS,
    Permissions.VIEW_TICKETS,
    Permissions.MANAGE_TICKETS,
    Permissions.VIEW_ORDERS,
    Permissions.MANAGE_RETURNS,
    Permissions.MANAGE_EXCHANGES,
    Permissions.VIEW_NOTIFICATIONS,
    Permissions.SEND_NOTIFICATIONS,
    Permissions.MANAGE_MESSAGE_TEMPLATES,
    Permissions.VIEW_MESSAGE_LOGS,
    Permissions.MANAGE_CHAT,
    Permissions.IMPERSONATE_USER, // keep OTP-gated
  ]),

  [Roles.OPERATIONS]: new Set([
    Permissions.VIEW_ORDERS,
    Permissions.MANAGE_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
    Permissions.MANAGE_RETURNS,
    Permissions.MANAGE_EXCHANGES,
    Permissions.MANAGE_RTO,
    Permissions.VIEW_SHIPPING,
    Permissions.MANAGE_DISPATCH_RULES,
    Permissions.MANAGE_COURIERS,
    Permissions.VIEW_INVENTORY,
    Permissions.VIEW_WAREHOUSES,
    Permissions.MANAGE_WAREHOUSES,
  ]),

  [Roles.WAREHOUSE]: new Set([
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
    Permissions.VIEW_INVENTORY,
    Permissions.MANAGE_INVENTORY,
    Permissions.MANAGE_PICK_PACK,
    Permissions.MANAGE_BARCODE_FLOWS,
    Permissions.MANAGE_PACKAGING_RULES,
    Permissions.MANAGE_STOCK_ADJUSTMENTS,
  ]),

  [Roles.INVENTORY_MANAGER]: new Set([
    Permissions.VIEW_INVENTORY,
    Permissions.MANAGE_INVENTORY,
    Permissions.MANAGE_STOCK_ADJUSTMENTS,
    Permissions.APPROVE_STOCK_ADJUSTMENTS,
    Permissions.VIEW_WAREHOUSES,
    Permissions.MANAGE_WAREHOUSES,
    Permissions.MANAGE_CATALOG,
    Permissions.MANAGE_PRODUCTS,
    Permissions.MANAGE_PRICING,
    Permissions.MANAGE_PRICE_BOOKS,
    Permissions.MANAGE_MARKDOWNS,
    Permissions.VIEW_MARGIN,
  ]),

  [Roles.MARKETING]: new Set([
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.MANAGE_CAMPAIGNS,
    Permissions.MANAGE_PROMOTIONS,
    Permissions.MANAGE_DISCOUNTS,
    Permissions.MANAGE_BOGO_RULES,
    Permissions.MANAGE_BUNDLES,
    Permissions.MANAGE_PROMOBAR,
    Permissions.MANAGE_HOMEPAGE_SECTIONS,
    Permissions.MANAGE_SITE_BANNERS,
    Permissions.VIEW_NOTIFICATIONS,
    Permissions.SEND_NOTIFICATIONS,
    Permissions.MANAGE_NOTIFICATION_TEMPLATES,
    Permissions.MANAGE_NOTIFICATION_SEGMENTS,
    Permissions.VIEW_NOTIFICATION_DELIVERABILITY,
    Permissions.MANAGE_REFERRALS,
    Permissions.MANAGE_AFFILIATES,
  ]),

  [Roles.CONTENT_MANAGER]: new Set([
    Permissions.MANAGE_CONTENT_PAGES,
    Permissions.MANAGE_MEDIA_LIBRARY,
    Permissions.MANAGE_NAVIGATION,
    Permissions.MANAGE_SITE_FOOTER,
    Permissions.MANAGE_SITE_LEGAL,
    Permissions.VIEW_SEO,
    Permissions.MANAGE_SEO,
    Permissions.MANAGE_SITEMAP,
    Permissions.MANAGE_STRUCTURED_DATA,
  ]),

  [Roles.DISPATCHER]: new Set([
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
    Permissions.VIEW_SHIPPING,
  ]),

  [Roles.AUDITOR]: new Set([
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.VIEW_FINANCIALS,
    Permissions.VIEW_LEDGER,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_SENSITIVE,
    Permissions.VIEW_INVENTORY,
    Permissions.VIEW_SHIPPING,
    Permissions.VIEW_SECURITY_LOGS,
    Permissions.EXPORT_DATA,
  ]),

  [Roles.READONLY]: new Set([
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_INVENTORY,
    Permissions.VIEW_SHIPPING,
    Permissions.VIEW_REVIEWS,
  ]),

  [Roles.GROWTH]: new Set([
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
    Permissions.MANAGE_AB_TESTS,
    Permissions.MANAGE_PERSONALIZATION,
    Permissions.MANAGE_RECOMMENDATIONS,
    Permissions.VIEW_EXPERIMENT_RESULTS,
    Permissions.MANAGE_CAMPAIGNS,
    Permissions.MANAGE_PROMOTIONS,
    Permissions.MANAGE_PROMOBAR,
    Permissions.MANAGE_HOMEPAGE_SECTIONS,
    Permissions.VIEW_NOTIFICATION_DELIVERABILITY,
  ]),

  [Roles.CRM]: new Set([
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_TIMELINE,
    Permissions.MANAGE_SEGMENTS,
    Permissions.MANAGE_CUSTOMER_TAGS,
    Permissions.MANAGE_CUSTOMER_NOTES,
    Permissions.MANAGE_COUPON_TARGETING,
    Permissions.VIEW_NOTIFICATIONS,
    Permissions.SEND_NOTIFICATIONS,
    Permissions.MANAGE_NOTIFICATION_TEMPLATES,
    Permissions.MANAGE_NOTIFICATION_SEGMENTS,
    Permissions.VIEW_NOTIFICATION_DELIVERABILITY,
  ]),

  [Roles.SEO]: new Set([
    Permissions.VIEW_SEO,
    Permissions.MANAGE_SEO,
    Permissions.MANAGE_SITEMAP,
    Permissions.MANAGE_STRUCTURED_DATA,
    Permissions.MANAGE_SEARCH,
  ]),

  [Roles.MODERATOR]: new Set([
    Permissions.VIEW_REVIEWS,
    Permissions.MODERATE_REVIEWS,
    Permissions.MANAGE_REVIEWS,
    Permissions.VIEW_COMPLAINTS,
    Permissions.MANAGE_COMPLAINTS,
    Permissions.VIEW_TICKETS,
  ]),

  [Roles.LOGISTICS_MANAGER]: new Set([
    Permissions.VIEW_SHIPPING,
    Permissions.MANAGE_SHIPPING_RATES,
    Permissions.MANAGE_COURIERS,
    Permissions.MANAGE_DISPATCH_RULES,
    Permissions.MANAGE_RTO,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_FULFILLMENT,
    Permissions.MANAGE_FULFILLMENT,
  ]),

  [Roles.COMPLIANCE]: new Set([
    Permissions.VIEW_AUDIT_LOGS,
    Permissions.VIEW_SECURITY_LOGS,
    Permissions.MANAGE_CONSENT,
    Permissions.MANAGE_RETENTION,
    Permissions.MANAGE_DATA_GOVERNANCE,
    Permissions.EXPORT_DATA,
    Permissions.EXPORT_PII,
    Permissions.DELETE_PII,
    Permissions.APPROVE_EXPORTS,
    Permissions.APPROVE_DELETIONS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_SENSITIVE,
  ]),

  [Roles.FRAUD_ANALYST]: new Set([
    Permissions.VIEW_RISK,
    Permissions.MANAGE_RISK_RULES,
    Permissions.MANAGE_FRAUD_CASES,
    Permissions.MANAGE_CHARGEBACKS,
    Permissions.MANAGE_BLOCKLISTS,
    Permissions.MANAGE_DEVICE_TRUST,
    Permissions.VIEW_SECURITY_LOGS,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_CUSTOMERS,
  ]),

  [Roles.DEVOPS]: new Set([
    Permissions.VIEW_HEALTH,
    Permissions.VIEW_DEV_TOOLS,
    Permissions.VIEW_SECURITY_LOGS,
    Permissions.VIEW_LOGS,
    Permissions.VIEW_METRICS,
    Permissions.MANAGE_ALERTS,
    Permissions.MANAGE_JOBS,
    Permissions.MANAGE_CRONS,
    Permissions.VIEW_INTEGRATIONS,
    Permissions.MANAGE_INTEGRATIONS,
    Permissions.MANAGE_WEBHOOKS,
    Permissions.MANAGE_API_KEYS,
    Permissions.MANAGE_RATE_LIMITS,
  ]),

  // New roles (enterprise)
  [Roles.PROCUREMENT]: new Set([
    Permissions.VIEW_SUPPLIERS,
    Permissions.MANAGE_SUPPLIERS,
    Permissions.VIEW_PURCHASE_ORDERS,
    Permissions.MANAGE_PURCHASE_ORDERS,
    Permissions.MANAGE_INBOUND_SHIPMENTS,
    Permissions.VIEW_INVENTORY,
    Permissions.VIEW_WAREHOUSES,
  ]),

  [Roles.MERCHANDISER]: new Set([
    Permissions.MANAGE_COLLECTIONS,
    Permissions.MANAGE_CATALOG,
    Permissions.MANAGE_SITE_BANNERS,
    Permissions.MANAGE_HOMEPAGE_SECTIONS,
    Permissions.MANAGE_PROMOBAR,
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
  ]),

  [Roles.PRICING_MANAGER]: new Set([
    Permissions.MANAGE_PRICING,
    Permissions.MANAGE_PRICE_BOOKS,
    Permissions.MANAGE_MARKDOWNS,
    Permissions.MANAGE_MARGIN_RULES,
    Permissions.VIEW_MARGIN,
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
  ]),

  [Roles.PARTNER_MANAGER]: new Set([
    Permissions.MANAGE_PARTNERS,
    Permissions.MANAGE_AFFILIATES,
    Permissions.MANAGE_REFERRALS,
    Permissions.MANAGE_WHOLESALE,
    Permissions.MANAGE_B2B_PRICING,
    Permissions.VIEW_ANALYTICS,
    Permissions.VIEW_REPORTS,
  ]),

  [Roles.MARKETPLACE_MANAGER]: new Set([
    Permissions.MANAGE_MARKETPLACE,
    Permissions.MANAGE_SELLERS,
    Permissions.MANAGE_COMMISSIONS,
    Permissions.MANAGE_SELLER_PAYOUTS,
    Permissions.MANAGE_DISPUTES,
    Permissions.VIEW_FINANCIALS,
    Permissions.VIEW_REPORTS,
  ]),

  [Roles.POS_MANAGER]: new Set([
    Permissions.MANAGE_POS,
    Permissions.MANAGE_REGISTERS,
    Permissions.MANAGE_SHIFTS,
    Permissions.VIEW_ORDERS,
    Permissions.MANAGE_ORDERS,
    Permissions.VIEW_INVENTORY,
  ]),

  [Roles.DATA_STEWARD]: new Set([
    Permissions.MANAGE_DATA_GOVERNANCE,
    Permissions.EXPORT_DATA,
    Permissions.EXPORT_PII,
    Permissions.MANAGE_RETENTION,
    Permissions.MANAGE_CONSENT,
    Permissions.APPROVE_EXPORTS,
    Permissions.VIEW_AUDIT_LOGS,
  ]),

  [Roles.QA]: new Set([
    Permissions.VIEW_DEV_TOOLS,
    Permissions.VIEW_HEALTH,
    Permissions.VIEW_LOGS,
    Permissions.VIEW_ORDERS,
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CATALOG,
    Permissions.VIEW_INVENTORY,
  ]),

  [Roles.CUSTOMER_SUCCESS]: new Set([
    Permissions.VIEW_CUSTOMERS,
    Permissions.VIEW_CUSTOMER_SENSITIVE,
    Permissions.VIEW_CUSTOMER_TIMELINE,
    Permissions.VIEW_ORDERS,
    Permissions.MANAGE_RETURNS,
    Permissions.MANAGE_EXCHANGES,
    Permissions.MANAGE_REFUNDS, // should be OTP-gated
    Permissions.VIEW_TICKETS,
    Permissions.MANAGE_TICKETS,
    Permissions.SEND_NOTIFICATIONS,
  ]),
};

//
// ────────────────────────────────────────────────────────────────────────
// Optional OTP gating map (permission → required OTP purpose)
// ────────────────────────────────────────────────────────────────────────

export const OTP_GATED_PERMISSIONS = new Map();

// Recommended defaults (only used if you call otpPurposeForPermission() in guards)
(function seedOtpGates() {
  const S = "rbac_sensitive_action";

  // Org/security-critical
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_RBAC, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_SETTINGS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_APP_SETTINGS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_API_KEYS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_WEBHOOKS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.IMPERSONATE_USER, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_RATE_LIMITS, S);

  // Money-critical
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_PAYMENT_PROVIDERS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_REFUNDS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_PAYOUTS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.MANAGE_CHARGEBACKS, S);
  OTP_GATED_PERMISSIONS.set(Permissions.RUN_RECONCILIATION, S);

  // Data/PII critical
  OTP_GATED_PERMISSIONS.set(Permissions.EXPORT_PII, S);
  OTP_GATED_PERMISSIONS.set(Permissions.DELETE_PII, S);
  OTP_GATED_PERMISSIONS.set(Permissions.APPROVE_DELETIONS, S);
})();

export function otpPurposeForPermission(permission) {
  return OTP_GATED_PERMISSIONS.get(permission) || null;
}

//
// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

function normalizeRoleName(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return "";

  const underscored = raw.replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  const compact = underscored.replace(/_/g, "");

  if (compact === "superadmin") return Roles.SUPERADMIN;
  if (compact === "admin") return Roles.ADMIN;

  return underscored;
}

/**
 * Extract normalized role names from a user object OR role string(s).
 * Supports:
 * - user.role = "admin"
 * - user.roles = ["admin", "finance"]
 * - user.roles = [{ role: { name: "admin" } }, { name: "finance" }]
 * - directly passing "admin"
 * - directly passing ["admin", "finance"]
 */
export function userRoles(user) {
  if (!user) return [Roles.STAFF];

  if (typeof user === "string") {
    const r = normalizeRoleName(user);
    return r ? [r] : [Roles.STAFF];
  }

  if (Array.isArray(user) && user.every((r) => typeof r === "string")) {
    const arr = user.map(normalizeRoleName).filter(Boolean);
    return arr.length ? arr : [Roles.STAFF];
  }

  if (user.role && typeof user.role === "string") {
    return [normalizeRoleName(user.role)];
  }

  if (Array.isArray(user.roles) && user.roles.every((r) => typeof r === "string")) {
    const arr = user.roles.map(normalizeRoleName).filter(Boolean);
    return arr.length ? arr : [Roles.STAFF];
  }

  if (Array.isArray(user.roles)) {
    const names = [];
    for (const r of user.roles) {
      if (r?.role?.name) {
        names.push(normalizeRoleName(r.role.name));
        continue;
      }
      if (r?.name) {
        names.push(normalizeRoleName(r.name));
        continue;
      }
      if (typeof r === "object" && typeof r.role === "string") {
        names.push(normalizeRoleName(r.role));
      }
    }
    return names.length ? names : [Roles.STAFF];
  }

  return [Roles.STAFF];
}

/**
 * Admin-level check: SUPERADMIN or ADMIN
 */
export function isAdminRole(input) {
  const roles =
    !input ? [] : typeof input === "string" ? [normalizeRoleName(input)] : Array.isArray(input) ? input.map(normalizeRoleName) : userRoles(input);
  return roles.some((r) => r === Roles.SUPERADMIN || r === Roles.ADMIN);
}

/**
 * Admin-portal check: any recognized staff/admin role (including STAFF, MANAGER, etc.)
 * Useful for “admin access required” gates where staff should still access the portal.
 */
export function isAdminPortalRole(input) {
  const roles =
    !input ? [] : typeof input === "string" ? [normalizeRoleName(input)] : Array.isArray(input) ? input.map(normalizeRoleName) : userRoles(input);
  const allowed = new Set(ALL_ROLES.map((r) => normalizeRoleName(r)));
  return roles.some((r) => allowed.has(normalizeRoleName(r)));
}

/**
 * Check if a user has a specific permission.
 * - SUPERADMIN always returns true (even if permission string is new).
 */
export function hasPermission(user, permission) {
  const perm = String(permission || "").trim().toLowerCase();
  if (!perm) return false;

  const roles = userRoles(user);

  // SUPERADMIN bypass (hard guarantee)
  if (roles.some((r) => normalizeRoleName(r) === Roles.SUPERADMIN)) return true;

  for (const roleName of roles) {
    const normalized = normalizeRoleName(roleName);
    const set = ROLE_PERMISSIONS[normalized] || ROLE_PERMISSIONS[Roles.STAFF];
    if (!set) continue;

    if (set.has(perm)) return true;

    // defensive: in case callers pass the enum key instead of value
    for (const p of set) {
      if (String(p).toLowerCase() === perm) return true;
    }
  }
  return false;
}

/**
 * Return a Set<string> of all permissions granted to this user across all roles.
 * NOTE: keeps existing behavior (Set return).
 */
export function permissionsFor(user) {
  const roles = userRoles(user);
  const out = new Set();

  // SUPERADMIN: return every permission deterministically
  if (roles.some((r) => normalizeRoleName(r) === Roles.SUPERADMIN)) {
    for (const p of ALL_PERMISSIONS) out.add(p);
    return out;
  }

  for (const roleName of roles) {
    const normalized = normalizeRoleName(roleName);
    const set = ROLE_PERMISSIONS[normalized] || ROLE_PERMISSIONS[Roles.STAFF];
    if (set && set.size) {
      for (const p of set) out.add(p);
    }
  }
  return out;
}

export function permissionsForRoles(roles = []) {
  return permissionsFor({ roles });
}

/**
 * Helper for settings / RBAC panel:
 * returns a plain JS object: { [roleName]: string[] } of default perms.
 */
export function defaultRolePermissionMatrix() {
  const matrix = {};
  for (const role of ALL_ROLES) {
    const set = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[Roles.STAFF];
    matrix[role] = set ? Array.from(set) : [];
  }
  return matrix;
}

// ────────────────────────────────────────────────────────────────────────
// Optional extra helpers (additive; do not break existing imports)
// ────────────────────────────────────────────────────────────────────────

export function hasAnyPermission(user, perms = []) {
  for (const p of perms || []) if (hasPermission(user, p)) return true;
  return false;
}

export function hasAllPermissions(user, perms = []) {
  for (const p of perms || []) if (!hasPermission(user, p)) return false;
  return true;
}

// Back-compat shims (kept stable for existing imports)
export const BasePermissions = Permissions;
export const RolePermissions = new Proxy(ROLE_PERMISSIONS, {
  set() {
    return false;
  },
  defineProperty() {
    return false;
  },
  deleteProperty() {
    return false;
  },
});
