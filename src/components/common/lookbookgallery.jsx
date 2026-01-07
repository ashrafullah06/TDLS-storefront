// /src/components/common/lookbookgallery.jsx
import React, { useState } from "react";

// Hardcoded fallback lookbooks (if Strapi is missing or empty)
const HARDCODED_LOOKBOOKS = [
  {
    id: 1,
    title: "TDLC Summer '25 Essentials",
    description: "Minimalist, effortless, and premium. Discover the TDLC summer story.",
    images: [
      "/img/lookbook1-1.jpg",
      "/img/lookbook1-2.jpg",
      "/img/lookbook1-3.jpg",
    ],
    tags: ["#Summer", "#Minimalist", "#TDLC"],
    cta_text: "Shop Summer",
    cta_url: "/collections/summer",
  },
  {
    id: 2,
    title: "Signature Maroon & Gold",
    description: "Bold meets refined. Our maroon and gold drop in signature silhouettes.",
    images: ["/img/lookbook2-1.jpg", "/img/lookbook2-2.jpg"],
    tags: ["#Signature", "#Maroon", "#Gold"],
    cta_text: "Explore Signature",
    cta_url: "/collections/signature-series",
  },
  {
    id: 3,
    title: "Winter Capsule",
    description: "Layer with luxury: winter warmth, premium finishing.",
    images: ["/img/lookbook3-1.jpg", "/img/lookbook3-2.jpg"],
    tags: ["#Winter", "#Layering", "#Premium"],
    cta_text: "View Collection",
    cta_url: "/collections/winter",
  },
];

// Lightbox modal for zoom view
function Lightbox({ open, images, startIdx, onClose, title, description, tags }) {
  const [idx, setIdx] = useState(startIdx || 0);
  if (!open) return null;

  function next() {
    setIdx((i) => (i + 1) % images.length);
  }
  function prev() {
    setIdx((i) => (i - 1 + images.length) % images.length);
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 px-2"
      tabIndex={-1}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full shadow-lg p-6 flex flex-col items-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-lg font-bold text-primary-900 bg-white rounded-full px-2 py-1 shadow hover:bg-red-100"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <div className="w-full flex justify-between items-center mb-2">
          <button
            className="text-2xl px-3 py-1 text-primary-700 hover:bg-primary-100 rounded-full"
            onClick={prev}
            aria-label="Previous"
          >
            &#8592;
          </button>
          <img
            src={images[idx]}
            alt={title || "Lookbook"}
            className="rounded-xl max-h-[60vh] w-auto object-contain"
          />
          <button
            className="text-2xl px-3 py-1 text-primary-700 hover:bg-primary-100 rounded-full"
            onClick={next}
            aria-label="Next"
          >
            &#8594;
          </button>
        </div>
        <div className="w-full text-center">
          <div className="text-primary-900 font-bold text-lg mb-1">{title}</div>
          <div className="text-primary-700 text-base mb-1">{description}</div>
          {Array.isArray(tags) && tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-1 justify-center">
              {tags.map((tag, i) => (
                <span
                  key={i}
                  className="bg-primary-50 text-primary-700 text-xs px-3 py-1 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-primary-600 mt-2">
            Image {idx + 1} of {images.length}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LookbookGallery({ lookbooks }) {
  // Normalize Strapi or fallback data
  const normalizedLookbooks =
    Array.isArray(lookbooks) && lookbooks.length
      ? lookbooks.map((lb) => {
          const attr = lb?.attributes || {};
          const imgs =
            Array.isArray(attr?.images?.data) && attr.images.data.length
              ? attr.images.data.map(
                  (img) => img?.attributes?.url || img?.url || "/img/lookbook-placeholder.jpg"
                )
              : ["/img/lookbook-placeholder.jpg"];
          return {
            id: lb.id || attr.id,
            title: attr.title || "",
            description: attr.description || "",
            images: imgs,
            tags: attr.tags || [],
            cta_text: attr.cta_text || "",
            cta_url: attr.cta_url || "",
          };
        })
      : HARDCODED_LOOKBOOKS;

  // Lightbox state
  const [lightbox, setLightbox] = useState({
    open: false,
    images: [],
    idx: 0,
    title: "",
    description: "",
    tags: [],
  });

  // Carousel logic for mobile (show one lookbook at a time)
  const [mobileIdx, setMobileIdx] = useState(0);
  const isMobile =
    typeof window !== "undefined"
      ? window.innerWidth < 640
      : false;
  const showLookbooks = isMobile
    ? [normalizedLookbooks[mobileIdx]]
    : normalizedLookbooks;

  function openLightbox(images, idx, title, description, tags) {
    setLightbox({
      open: true,
      images,
      idx,
      title,
      description,
      tags,
    });
  }

  return (
    <section className="w-full">
      <div className="mb-8 text-center">
        <h2 className="text-3xl md:text-4xl font-extrabold text-primary-900 tracking-tight mb-2">
          TDLC Lookbook
        </h2>
        <p className="text-lg text-primary-700 font-medium">
          Explore style inspiration and our seasonal campaigns.
        </p>
      </div>
      {/* Carousel for mobile, grid for desktop */}
      <div className="relative">
        <div className="block sm:hidden mb-7">
          <div className="flex items-center gap-2">
            <button
              className="rounded-full p-2 bg-primary-50 text-primary-800 hover:bg-primary-100"
              onClick={() =>
                setMobileIdx((i) =>
                  i === 0 ? normalizedLookbooks.length - 1 : i - 1
                )
              }
              aria-label="Previous"
            >
              &#8592;
            </button>
            <div className="flex-1">
              {showLookbooks.map((lb, i) => (
                <div
                  key={lb.id || i}
                  className="rounded-2xl border border-neutral-100 shadow p-4 bg-white"
                >
                  <div className="flex overflow-x-auto gap-3 pb-2">
                    {lb.images.map((img, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={img}
                        alt={lb.title}
                        className="h-44 min-w-[140px] object-cover rounded-xl cursor-pointer hover:shadow-xl transition"
                        onClick={() =>
                          openLightbox(lb.images, imgIdx, lb.title, lb.description, lb.tags)
                        }
                        loading="lazy"
                      />
                    ))}
                  </div>
                  <div className="mt-3 mb-1 text-primary-900 font-bold text-lg">
                    {lb.title}
                  </div>
                  <div className="text-primary-700 text-base mb-1">
                    {lb.description}
                  </div>
                  {Array.isArray(lb.tags) && lb.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-1">
                      {lb.tags.map((tag, ti) => (
                        <span
                          key={ti}
                          className="bg-primary-50 text-primary-700 text-xs px-3 py-1 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {lb.cta_url && (
                    <a
                      href={lb.cta_url}
                      className="inline-block mt-2 px-5 py-2 rounded-full text-base font-semibold bg-primary-600 text-white shadow hover:bg-primary-700 transition"
                    >
                      {lb.cta_text || "Shop Now"}
                    </a>
                  )}
                </div>
              ))}
            </div>
            <button
              className="rounded-full p-2 bg-primary-50 text-primary-800 hover:bg-primary-100"
              onClick={() =>
                setMobileIdx((i) =>
                  i === normalizedLookbooks.length - 1 ? 0 : i + 1
                )
              }
              aria-label="Next"
            >
              &#8594;
            </button>
          </div>
        </div>
        {/* Grid for desktop/tablet */}
        <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {normalizedLookbooks.map((lb, i) => (
            <div
              key={lb.id || i}
              className="rounded-2xl border border-neutral-100 shadow p-5 bg-white flex flex-col h-full"
            >
              <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
                {lb.images.map((img, imgIdx) => (
                  <img
                    key={imgIdx}
                    src={img}
                    alt={lb.title}
                    className="h-44 min-w-[140px] object-cover rounded-xl cursor-pointer hover:shadow-xl transition"
                    onClick={() =>
                      openLightbox(lb.images, imgIdx, lb.title, lb.description, lb.tags)
                    }
                    loading="lazy"
                  />
                ))}
              </div>
              <div className="mt-1 mb-1 text-primary-900 font-bold text-xl">{lb.title}</div>
              <div className="text-primary-700 text-base mb-1 flex-1">{lb.description}</div>
              {Array.isArray(lb.tags) && lb.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {lb.tags.map((tag, ti) => (
                    <span
                      key={ti}
                      className="bg-primary-50 text-primary-700 text-xs px-3 py-1 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {lb.cta_url && (
                <a
                  href={lb.cta_url}
                  className="inline-block mt-3 px-5 py-2 rounded-full text-base font-semibold bg-primary-600 text-white shadow hover:bg-primary-700 transition"
                >
                  {lb.cta_text || "Shop Now"}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
      {/* Lightbox view */}
      <Lightbox
        open={lightbox.open}
        images={lightbox.images}
        startIdx={lightbox.idx}
        onClose={() => setLightbox((l) => ({ ...l, open: false }))}
        title={lightbox.title}
        description={lightbox.description}
        tags={lightbox.tags}
      />
    </section>
  );
}
