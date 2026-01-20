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

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

/* ---------------- SEO identity (no UI/UX or business logic impact) ---------------- */
const BRAND = "TDLS";
const DEFAULT_TITLE = `${BRAND} — Premium multi-product ecommerce`;
const DEFAULT_DESC =
  "TDLS is a premium multi-product ecommerce brand. Shop curated essentials across multiple categories with a clean, reliable buying experience.";

const OG_IMAGE = `${SITE_URL}/favicon.ico`; // uses an existing asset (no assumptions)

export const metadata = {
  metadataBase: new URL(SITE_URL),

  // Stronger SERP title without using the full brand expansion
  title: { default: DEFAULT_TITLE, template: `%s | ${BRAND}` },

  // Stronger meta description so Google does not fall back to footer text
  description: DEFAULT_DESC,

  alternates: {
    canonical: SITE_URL,
  },

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
    images: [
      {
        url: OG_IMAGE,
        width: 256,
        height: 256,
        alt: BRAND,
      },
    ],
  },

  twitter: {
    card: "summary",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESC,
    images: [OG_IMAGE],
  },

  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  // Minimal JSON-LD to strengthen brand identity in search + social parsers (no UI impact)
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND,
    url: SITE_URL,
    logo: OG_IMAGE,
  };

  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
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
