// FILE: app/layout.js
import "@/styles/globals.css";
import OptionsProvider from "@/providers/optionsprovider";
import Providers from "./providers";
import CartProvider from "@/components/common/cart_context";
import AutoSignoutGuard from "@/components/auth/auto_signout_guard";
import SwrProvider from "@/providers/swrprovider";
import RouteFlagger from "@/components/route-flagger";
import Promobar from "@/components/common/promobar";

// Global cart panel
import CartPanel from "@/components/cart/cart_panel";

import AdminRouteGate from "@/components/admin/admin_route_gate"; // ✅ new tiny client gate

// ✅ Preload Sliding Menu Bar (no UI, runs on site load)
import SlidingMenuBarPreloader from "@/components/common/slidingmenubar.preloader";

// ✅ NEW: Preload HomePanel data (no click loading)
import HomePanelPreloader from "@/components/common/homepanel.preloader";

// ✅ NEW: Preload BottomFloatingBar data (no click loading)
import BottomFloatingBarPreloader from "@/components/common/bottomfloatingbar.preloader";

// ✅ NEW: Preload Collections / All Products dataset (no click loading)
import { HomePanelAllProductsPreloader } from "@/components/common/homepanel_all_products";

/* ------------------------- URL + asset normalization ------------------------- */
const SITE_URL = (() => {
  const raw =
    (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();

  // Vercel provides VERCEL_URL without scheme. This makes local/dev safe too.
  const vercel = (process.env.VERCEL_URL || "").trim();

  let url = raw || (vercel ? `https://${vercel}` : "");
  if (!url) url = "https://www.thednalabstore.com";

  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
})();

const OG_IMAGE = (() => {
  const v = (process.env.NEXT_PUBLIC_OG_IMAGE || "").trim();
  if (!v) return "/favicon.ico";
  if (/^https?:\/\//i.test(v)) return v;
  return v.startsWith("/") ? v : `/${v}`;
})();

const OG_IS_FAVICON = /\/favicon\.ico$/i.test(OG_IMAGE);
const OG_W = OG_IS_FAVICON ? 256 : 1200;
const OG_H = OG_IS_FAVICON ? 256 : 630;

/* ---------------- SEO identity (no UI/UX or business logic impact) ---------------- */
const BRAND = "TDLS";
const DEFAULT_TITLE = `${BRAND} — Premium multi-product ecommerce`;
const DEFAULT_DESC =
  "TDLS is a premium multi-product ecommerce brand. Shop curated essentials across multiple categories with a clean, reliable buying experience.";

/** @type {import("next").Metadata} */
export const metadata = {
  metadataBase: new URL(SITE_URL),

  // Stronger SERP title without using the full brand expansion
  title: { default: DEFAULT_TITLE, template: `%s | ${BRAND}` },

  // Stronger meta description so Google does not fall back to footer text
  description: DEFAULT_DESC,

  // Advanced canonical strategy:
  // - Use relative canonical so Next composes the correct per-route canonical under metadataBase.
  // - Prevents every page from claiming the homepage as canonical.
  alternates: { canonical: "./" },

  // Helpful “other fields” supported by Next metadata API
  applicationName: BRAND,
  referrer: "origin-when-cross-origin",
  category: "ecommerce",
  creator: BRAND,
  publisher: BRAND,
  keywords: [
    "TDLS",
    "premium ecommerce",
    "online shopping",
    "fashion",
    "accessories",
    "home decor",
    "Bangladesh",
  ],
  formatDetection: { email: false, address: false, telephone: false },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },

  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: BRAND,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    locale: "en_US",
    images: [
      {
        url: OG_IMAGE,
        width: OG_W,
        height: OG_H,
        alt: BRAND,
      },
    ],
  },

  twitter: {
    card: OG_IS_FAVICON ? "summary" : "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    images: [OG_IMAGE],
  },

  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },

  // iOS “Add to Home Screen” friendliness (no UI change)
  appleWebApp: {
    title: BRAND,
    capable: true,
    statusBarStyle: "default",
  },
};

/** @type {import("next").Viewport} */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Theme color belongs in viewport config (per Next), not metadata.themeColor
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#050b1f" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }) {
  // Minimal JSON-LD to strengthen brand identity in search + social parsers (no UI impact)
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND,
    url: SITE_URL,
    logo: OG_IMAGE,
  };

  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BRAND,
    url: SITE_URL,
  };

  return (
    <html lang="en">
      <body id="app-shell">
        {/* Structured data (no UI) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />

        <AdminRouteGate
          adminTree={<main role="main">{children}</main>}
          siteTree={
            <>
              <AutoSignoutGuard />

              {/* ✅ Preloaders run as early as possible on site load (no UI) */}
              <SlidingMenuBarPreloader />
              <HomePanelPreloader />
              <HomePanelAllProductsPreloader />
              <BottomFloatingBarPreloader />

              <Providers>
                <CartProvider>
                  <OptionsProvider>
                    <SwrProvider>
                      <Promobar />

                      {/* Global mirror slider, reading from real cart */}
                      <CartPanel />

                      <main role="main">
                        <RouteFlagger>{children}</RouteFlagger>
                      </main>
                    </SwrProvider>
                  </OptionsProvider>
                </CartProvider>
              </Providers>
            </>
          }
        />
      </body>
    </html>
  );
}
