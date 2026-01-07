// /src/components/common/instagramgallery.jsx
import React, { useState } from "react";

// Hardcoded fallback posts (if Strapi is missing or empty)
const HARDCODED_POSTS = [
  {
    id: 1,
    image: "/img/ig-1.jpg",
    caption: "Ultra-premium T-shirts: softest touch, perfect fit.",
    url: "https://www.instagram.com/p/abcdef1/",
    likes: 224,
    tags: ["#TDLC", "#PremiumWear"],
  },
  {
    id: 2,
    image: "/img/ig-2.jpg",
    caption: "Gold label trims. Details make the difference.",
    url: "https://www.instagram.com/p/abcdef2/",
    likes: 192,
    tags: ["#Signature", "#Luxury"],
  },
  {
    id: 3,
    image: "/img/ig-3.jpg",
    caption: "Sustainable cotton, ethically produced in Bangladesh.",
    url: "https://www.instagram.com/p/abcdef3/",
    likes: 260,
    tags: ["#Sustainable", "#EthicalFashion"],
  },
  {
    id: 4,
    image: "/img/ig-4.jpg",
    caption: "A TDLC essential, styled for every season.",
    url: "https://www.instagram.com/p/abcdef4/",
    likes: 180,
    tags: ["#Seasonal", "#Essentials"],
  },
  {
    id: 5,
    image: "/img/ig-5.jpg",
    caption: "Minimalist, versatile, and unmistakably TDLC.",
    url: "https://www.instagram.com/p/abcdef5/",
    likes: 212,
    tags: ["#Minimalist", "#Versatile"],
  },
  {
    id: 6,
    image: "/img/ig-6.jpg",
    caption: "TDLC – For those who value craft and quality.",
    url: "https://www.instagram.com/p/abcdef6/",
    likes: 178,
    tags: ["#Craft", "#Quality"],
  },
];

// Helper: Format likes as '1.2K'
function formatLikes(num) {
  return num >= 1000 ? (num / 1000).toFixed(1) + "K" : num;
}

// Lightbox component (simple, no deps)
function Lightbox({ open, post, onClose }) {
  if (!open || !post) return null;
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 px-2"
      tabIndex={-1}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full shadow-lg p-5 flex flex-col items-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-4 right-4 text-lg font-bold text-primary-900 bg-white rounded-full px-2 py-1 shadow hover:bg-red-100"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
        <img
          src={post.image}
          alt={post.caption || "Instagram post"}
          className="rounded-xl w-full max-h-[60vh] object-contain mb-4"
        />
        <div className="w-full">
          <div className="text-primary-900 font-bold text-base mb-1">
            {post.caption}
          </div>
          {Array.isArray(post.tags) && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1 mb-2">
              {post.tags.map((tag, i) => (
                <span
                  key={i}
                  className="bg-primary-50 text-primary-700 text-xs px-3 py-1 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 text-primary-700 text-xs">
            <span>♥ {formatLikes(post.likes || 0)}</span>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary-900"
            >
              View on Instagram
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InstagramGallery({ posts }) {
  // Strapi post format normalization (handles both Strapi and fallback)
  const normalizedPosts =
    Array.isArray(posts) && posts.length
      ? posts
          .map((post) => {
            // Strapi API structure, customize as needed
            const attr = post?.attributes || {};
            return {
              id: post.id || attr.id,
              image:
                attr?.image?.data?.attributes?.url ||
                attr?.image_url ||
                attr?.media_url ||
                "/img/ig-placeholder.jpg",
              caption: attr.caption || attr.title || "",
              url: attr.permalink || attr.url || "#",
              likes: attr.likes || 0,
              tags: attr.tags || [],
            };
          })
          .filter((p) => p.image)
      : HARDCODED_POSTS;

  // Lightbox state
  const [lightbox, setLightbox] = useState({ open: false, post: null });

  // Carousel logic for mobile
  const [slide, setSlide] = useState(0);
  const maxSlide = normalizedPosts.length - 1;
  const isMobile =
    typeof window !== "undefined"
      ? window.innerWidth < 640
      : false;

  const handleNext = () => setSlide((s) => (s < maxSlide ? s + 1 : 0));
  const handlePrev = () => setSlide((s) => (s > 0 ? s - 1 : maxSlide));

  return (
    <section
      aria-label="Instagram Gallery"
      className="w-full"
    >
      <div className="mb-6 flex items-center justify-between px-2">
        <h2 className="text-xl md:text-2xl font-extrabold text-primary-900">
          As Seen On Instagram
        </h2>
        <a
          href="https://instagram.com/thednalabclothing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-primary-700 font-semibold text-sm hover:underline"
        >
          <img
            src="/img/icon-ig.png"
            alt="Instagram"
            className="h-5 w-5"
          />
          Follow @thednalabclothing
        </a>
      </div>
      {/* Responsive Grid/Carousel */}
      <div className="relative">
        {/* Carousel for mobile, grid for desktop */}
        <div className="block sm:hidden">
          {/* Mobile Carousel */}
          <div className="flex items-center gap-2">
            <button
              className="rounded-full p-2 bg-primary-50 text-primary-800 hover:bg-primary-100"
              onClick={handlePrev}
              aria-label="Previous"
            >
              &#8592;
            </button>
            <div className="flex-1">
              <div
                className="rounded-xl overflow-hidden shadow group relative aspect-square"
                onClick={() =>
                  setLightbox({ open: true, post: normalizedPosts[slide] })
                }
                tabIndex={0}
                aria-label="Open post"
              >
                <img
                  src={normalizedPosts[slide].image}
                  alt={normalizedPosts[slide].caption || "Instagram post"}
                  className="object-cover w-full h-60 transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 text-white text-xs flex justify-between items-center">
                  <span className="truncate max-w-[60%]">
                    {normalizedPosts[slide].caption}
                  </span>
                  <span>♥ {formatLikes(normalizedPosts[slide].likes)}</span>
                </div>
              </div>
            </div>
            <button
              className="rounded-full p-2 bg-primary-50 text-primary-800 hover:bg-primary-100"
              onClick={handleNext}
              aria-label="Next"
            >
              &#8594;
            </button>
          </div>
        </div>
        <div className="hidden sm:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {normalizedPosts.map((post, i) => (
            <div
              key={post.id || i}
              className="rounded-xl overflow-hidden shadow group relative aspect-square cursor-pointer"
              tabIndex={0}
              aria-label={post.caption}
              onClick={() => setLightbox({ open: true, post })}
              onKeyDown={(e) => e.key === "Enter" && setLightbox({ open: true, post })}
            >
              <img
                src={post.image}
                alt={post.caption || "Instagram post"}
                className="object-cover w-full h-56 transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
              <div className="absolute bottom-0 left-0 right-0 p-2 bg-black/50 text-white text-xs flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="truncate max-w-[60%]">
                  {post.caption}
                </span>
                <span>♥ {formatLikes(post.likes)}</span>
              </div>
              {/* Tags */}
              {Array.isArray(post.tags) && post.tags.length > 0 && (
                <div className="absolute top-2 left-2 flex flex-wrap gap-1 z-10">
                  {post.tags.map((tag, ti) => (
                    <span
                      key={ti}
                      className="bg-primary-50 text-primary-700 text-[11px] px-2 py-0.5 rounded-full shadow"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {/* Instagram link overlay */}
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 z-10"
                aria-label="View on Instagram"
                tabIndex={-1}
              />
            </div>
          ))}
        </div>
      </div>
      {/* Lightbox view */}
      <Lightbox
        open={lightbox.open}
        post={lightbox.post}
        onClose={() => setLightbox({ open: false, post: null })}
      />
    </section>
  );
}
