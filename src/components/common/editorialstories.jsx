// /src/components/common/editorialstories.jsx
import React from "react";

/**
 * EditorialStories - Premium, responsive editorial/story grid.
 *
 * @param {Array} stories - Array of story objects from Strapi (see README for structure)
 * Each story item example:
 * {
 *   id: 1,
 *   attributes: {
 *     title: "The Art of Cotton",
 *     subtitle: "A journey into Bangladesh's sustainable cotton",
 *     summary: "Discover how our partners produce the world’s softest cotton in an ethical way.",
 *     images: { data: [{ attributes: { url: "/img/editorial1.jpg" } }] },
 *     tags: ["Sustainability", "Craft"],
 *     cta_text: "Read Full Story",
 *     cta_url: "/stories/the-art-of-cotton",
 *     publishedAt: "2025-07-01T10:00:00Z"
 *   }
 * }
 */
export default function EditorialStories({ stories = [] }) {
  if (!Array.isArray(stories) || stories.length === 0) return null;

  return (
    <section className="w-full mx-auto">
      <div className="mb-10 text-center">
        <h2 className="text-3xl md:text-4xl font-extrabold text-primary-900 tracking-tight mb-2">
          Editorial Stories
        </h2>
        <p className="text-lg text-primary-700 font-medium">
          Explore our latest features, spotlights, and journal entries.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {stories.map((story, idx) => {
          const attr = story?.attributes || {};
          const title = attr.title || "Untitled Story";
          const subtitle = attr.subtitle || "";
          const summary = attr.summary || attr.description || "";
          const images = Array.isArray(attr?.images?.data)
            ? attr.images.data
            : [];
          const imageUrl =
            images.length > 0
              ? images[0]?.attributes?.url
              : "/img/story-placeholder.jpg";
          const tags = attr.tags || [];
          const ctaText = attr.cta_text || "Read More";
          const ctaUrl = attr.cta_url || null;
          const publishedAt = attr.publishedAt
            ? new Date(attr.publishedAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : null;

          return (
            <article
              key={story.id || idx}
              className="group flex flex-col bg-white rounded-3xl shadow-lg hover:shadow-2xl border border-neutral-200 overflow-hidden transition-shadow duration-300 h-full"
              tabIndex={0}
              aria-label={title}
            >
              {/* Image */}
              <div className="relative w-full aspect-[4/3] overflow-hidden">
                <img
                  src={imageUrl}
                  alt={title}
                  className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  style={{ minHeight: "180px", background: "#f2f2f2" }}
                />
                {/* Tags overlay */}
                {tags.length > 0 && (
                  <div className="absolute top-3 left-3 flex flex-wrap gap-2 z-10">
                    {tags.map((tag, ti) => (
                      <span
                        key={ti}
                        className="bg-primary-50 text-primary-700 text-xs px-3 py-1 rounded-full shadow"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {/* Content */}
              <div className="flex-1 flex flex-col p-5">
                <div className="mb-1 text-primary-500 text-xs">
                  {publishedAt}
                </div>
                <h3 className="font-bold text-lg md:text-xl text-primary-900 mb-1 line-clamp-2">
                  {title}
                </h3>
                {subtitle && (
                  <div className="font-medium text-base text-primary-800 mb-2 line-clamp-1">
                    {subtitle}
                  </div>
                )}
                {summary && (
                  <div className="text-primary-700 text-sm md:text-base mb-3 line-clamp-3">
                    {summary}
                  </div>
                )}
                {/* CTA */}
                {ctaUrl && (
                  <a
                    href={ctaUrl}
                    className="mt-auto inline-block bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold px-5 py-2 rounded-full shadow transition duration-200"
                    tabIndex={0}
                  >
                    {ctaText}
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
