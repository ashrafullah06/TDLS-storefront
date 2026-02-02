//✅ FILE: app/layout.js
import "@/styles/globals.css";

import OptionsProvider from "@/providers/optionsprovider";
import Providers from "./providers";
import CartProvider from "@/components/common/cart_context";
import SwrProvider from "@/providers/swrprovider";
import RouteFlagger from "@/components/route-flagger";
import Promobar from "@/components/common/promobar";

// Global cart panel
import CartPanel from "@/components/cart/cart_panel";

import AdminRouteGate from "@/components/admin/admin_route_gate"; // ✅ client gate

// ✅ Client-only deferred boot helpers (ssr:false must live in a Client Component)
import ClientBoot from "@/components/common/client_boot";

/* ------------------------- URL + asset normalization ------------------------- */
const SITE_URL = (() => {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
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

const OG_IMAGE_ABS = new URL(OG_IMAGE, SITE_URL).toString();

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

  title: { default: DEFAULT_TITLE, template: `%s | ${BRAND}` },
  description: DEFAULT_DESC,

  alternates: { canonical: "./" },

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#050b1f" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }) {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND,
    url: SITE_URL,
    logo: OG_IMAGE_ABS, // ✅ absolute for schema correctness
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
            <Providers>
              {/* ✅ All ssr:false dynamics moved into a client-only boot component */}
              <ClientBoot />

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
          }
        />
      </body>
    </html>
  );
}