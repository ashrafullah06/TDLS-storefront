// /src/components/common/recirculation.jsx
import React from "react";

// --- Hardcoded fallback products ---
const HARDCODED_PRODUCTS = [
  {
    id: 101,
    name: "Ultra-Premium Blue Aura T-Shirt",
    slug: "ultra-premium-blue-aura-t-shirt",
    image: "/img/fallback-prod-1.jpg",
    price: 1690,
    sold: 32,
    in_stock: 17,
    tier: "Limited Edition",
    badges: ["Best Seller"],
  },
  {
    id: 102,
    name: "Maroon Signature Cotton Tee",
    slug: "maroon-signature-cotton-tee",
    image: "/img/fallback-prod-2.jpg",
    price: 1550,
    sold: 28,
    in_stock: 8,
    tier: "Signature Series",
    badges: ["Collectors"],
  },
  {
    id: 103,
    name: "Pearl Heritage Crewneck",
    slug: "pearl-heritage-crewneck",
    image: "/img/fallback-prod-3.jpg",
    price: 1890,
    sold: 45,
    in_stock: 2,
    tier: "Heritage Collection",
    badges: ["Low Stock", "Top Rated"],
  },
  {
    id: 104,
    name: "Premium Everyday White Tee",
    slug: "premium-everyday-white-tee",
    image: "/img/fallback-prod-4.jpg",
    price: 1290,
    sold: 54,
    in_stock: 33,
    tier: "Premium Collection",
    badges: [],
  },
];

// --- Helper to normalize Strapi or analytics product data ---
function normalizeProduct(p) {
  // Strapi format: { id, attributes: { ... } }
  if (p?.attributes) {
    const attr = p.attributes;
    return {
      id: p.id || attr.id,
      name: attr.name || "Product",
      slug: attr.slug || "#",
      image:
        attr.images?.data?.[0]?.attributes?.url ||
        attr.images?.[0]?.url ||
        "/img/product-placeholder.png",
      price: attr.price || 0,
      sold: attr.sold || 0,
      in_stock: attr.in_stock,
      tier: attr.tier?.data?.attributes?.name || attr.tier || "",
      badges: attr.badges || [],
    };
  }
  // Analytics DB or direct format
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    image: p.image || "/img/product-placeholder.png",
    price: p.price || 0,
    sold: p.sold || 0,
    in_stock: p.in_stock,
    tier: p.tier,
    badges: p.badges || [],
  };
}

export default function Recirculation({ products }) {
  // Normalize dynamic or fallback data
  const normalized =
    Array.isArray(products) && products.length
      ? products.map(normalizeProduct)
      : HARDCODED_PRODUCTS;

  return (
    <section
      className="w-full"
      aria-label="Recommended Products"
    >
      <div className="mb-6 text-center">
        <h2 className="text-2xl md:text-3xl font-extrabold text-primary-900 tracking-tight mb-1">
          Shop Again or Try These
        </h2>
        <p className="text-base md:text-lg text-primary-700 font-medium">
          Our bestsellers, just for you.
        </p>
      </div>
      {/* --- Horizontal scroll on mobile, grid on desktop --- */}
      <div className="flex sm:hidden gap-4 overflow-x-auto pb-2">
        {normalized.map((prod, i) => (
          <ProductCard key={prod.id || i} product={prod} />
        ))}
      </div>
      <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {normalized.map((prod, i) => (
          <ProductCard key={prod.id || i} product={prod} />
        ))}
      </div>
    </section>
  );
}

// --- Product Card Subcomponent ---
function ProductCard({ product }) {
  const {
    id,
    name,
    slug,
    image,
    price,
    sold,
    in_stock,
    tier,
    badges,
  } = product;

  return (
    <div
      className="relative bg-white rounded-2xl shadow hover:shadow-xl transition border border-neutral-100 w-56 min-w-[210px] flex flex-col"
      tabIndex={0}
      aria-label={name}
    >
      {/* Badges & Tier */}
      <div className="absolute top-2 left-2 flex flex-wrap gap-1 z-10">
        {tier && (
          <span className="bg-amber-100 text-amber-800 font-semibold text-xs px-2 py-0.5 rounded-full shadow">
            {tier}
          </span>
        )}
        {Array.isArray(badges) &&
          badges.map((b, i) => (
            <span
              key={i}
              className="bg-primary-50 text-primary-700 text-xs px-2 py-0.5 rounded-full shadow"
            >
              {b}
            </span>
          ))}
      </div>
      {/* Product Image */}
      <a href={`/product/${slug}`}>
        <img
          src={image}
          alt={name}
          className="rounded-t-2xl w-full h-40 object-cover object-center"
          loading="lazy"
        />
      </a>
      {/* Product Info */}
      <div className="flex-1 flex flex-col p-4">
        <div className="font-bold text-base text-primary-900 mb-0.5 line-clamp-2">
          {name}
        </div>
        <div className="font-semibold text-primary-700 mb-1">
          ৳{price?.toLocaleString()}
        </div>
        <div className="flex items-center gap-2 text-xs text-amber-800 mb-1">
          {sold > 0 && (
            <span>
              {sold} sold
            </span>
          )}
          {in_stock === 0 && (
            <span className="text-red-600 font-bold">Sold Out</span>
          )}
          {in_stock > 0 && in_stock < 5 && (
            <span className="text-red-700">Only {in_stock} left!</span>
          )}
        </div>
        <a
          href={`/product/${slug}`}
          className="inline-block mt-auto px-5 py-2 rounded-full bg-primary-700 text-white font-bold text-sm hover:bg-primary-800 transition text-center"
        >
          Shop Again
        </a>
      </div>
    </div>
  );
}
