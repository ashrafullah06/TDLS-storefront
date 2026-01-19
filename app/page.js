// FILE: app/page.js
export const revalidate = 60;

import ClientHomepage from "@/components/homepage/homepage-client";
import BottomFloatingBarShell from "@/components/common/bottomfloatingbar.shell.server";
import { fetchHomepage } from "@/lib/fetchhomepage";

/* ---------------- SEO/social (no UI/UX change, no business logic change) ---------------- */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://www.thednalabstore.com";

const BRAND = "TDLS";
const TITLE = `${BRAND} — Premium multi-product ecommerce`;
const DESCRIPTION =
  "TDLS is a premium multi-product ecommerce brand. Shop curated essentials across multiple categories with a clean, reliable buying experience.";
const OG_IMAGE = `${SITE_URL}/favicon.ico`;

// Next.js App Router metadata for this page
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: BRAND,
    title: TITLE,
    description: DESCRIPTION,
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
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default async function Page() {
  let homepage = {};
  let error = null;

  try {
    homepage = await fetchHomepage();
  } catch (e) {
    error = e?.message || "Failed to load homepage";
  }

  // JSON-LD: strengthens brand identity for search + social parsers (no UI)
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
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
      />

      <ClientHomepage homepage={homepage} error={error} />
      <BottomFloatingBarShell />
    </>
  );
}
