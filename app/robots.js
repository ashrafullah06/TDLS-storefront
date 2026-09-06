// FILE: app/robots.js

const SITE_URL =
  (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://www.thednalabstore.com"
  )
    .trim()
    .replace(/\/+$/, "");

export default function robots() {
  return {
    rules: [
      {
        userAgent: "*",

        allow: "/",

        disallow: [
          "/admin/",
          "/api/",
          "/internal/",
          "/draft/",
          "/private/",
          "/preview",

          "/login",
          "/signin",
          "/signup",
          "/logout",

          "/account",
          "/customer/",
          "/profile",
          "/orders",

          "/cart",
          "/checkout",

          "/search",
          "/info",
        ],
      },

      {
        userAgent: "AhrefsBot",
        disallow: "/",
      },

      {
        userAgent: "SemrushBot",
        disallow: "/",
      },

      {
        userAgent: "MJ12bot",
        disallow: "/",
      },

      {
        userAgent: "BLEXBot",
        disallow: "/",
      },

      {
        userAgent: "DotBot",
        disallow: "/",
      },
    ],

    /*
     * IMPORTANT:
     * Submit only the master sitemap index.
     *
     * /sitemap.xml already contains:
     * - sitemap-static.xml
     * - sitemap-products.xml
     * - sitemap-collections.xml
     * - sitemap-blog.xml
     * - server-sitemap.xml
     *
     * Google will discover all child sitemaps from this one URL.
     */
    sitemap: `${SITE_URL}/sitemap.xml`,

    host: SITE_URL,
  };
}