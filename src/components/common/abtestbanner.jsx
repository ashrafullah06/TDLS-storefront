// /src/components/common/abtestbanner.jsx
import React from "react";

/**
 * ABTestBanner - Master Banner component for A/B testing and dynamic homepage banners.
 * 
 * @param {Array} banners - Array of banner objects from Strapi (see README for structure)
 * Example banner item:
 * {
 *   attributes: {
 *     title: "Banner Title",
 *     description: "Banner description.",
 *     image: { data: { attributes: { url: "/img/banner1.jpg" } } },
 *     cta_text: "Shop Now",
 *     cta_url: "/collections/limited-edition",
 *     bg_color: "#fffbe8"
 *   }
 * }
 */
export default function Abtestbanner({ banners = [] }) {
  if (!Array.isArray(banners) || banners.length === 0) return null;

  return (
    <div className="w-full flex flex-col gap-4 px-2 md:px-0">
      {banners.map((banner, i) => {
        const attr = banner?.attributes || {};
        const title = attr.title || "Notice";
        const description = attr.description || "";
        const imgUrl = attr?.image?.data?.attributes?.url
          ? attr.image.data.attributes.url
          : null;
        const ctaText = attr.cta_text || "Shop Now";
        const ctaUrl = attr.cta_url || null;
        const bgColor = attr.bg_color || "#fffbe8";

        return (
          <div
            key={i}
            className="relative flex flex-col md:flex-row items-center justify-between gap-6 border border-yellow-200 rounded-2xl shadow-lg overflow-hidden"
            style={{
              background: bgColor,
            }}
          >
            {/* Banner image, if available */}
            {imgUrl && (
              <img
                src={imgUrl}
                alt={title}
                className="w-full md:w-52 h-36 object-cover object-center md:rounded-l-2xl"
                loading="lazy"
                style={{ minWidth: "140px", maxWidth: "210px", background: "#faf7e7" }}
              />
            )}

            {/* Text content */}
            <div className={`flex-1 px-4 py-5 ${imgUrl ? "" : "text-center"}`}>
              <div className="font-extrabold text-lg md:text-2xl text-yellow-900 mb-2">{title}</div>
              {description && (
                <div className="text-yellow-800/90 text-base md:text-lg mb-2">{description}</div>
              )}
              {ctaUrl && (
                <a
                  href={ctaUrl}
                  className="inline-block mt-3 px-6 py-2 rounded-full text-base font-semibold bg-yellow-400 text-yellow-900 shadow hover:bg-yellow-500 transition"
                >
                  {ctaText}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
