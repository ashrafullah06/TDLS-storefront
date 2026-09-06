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

const TITLE = "TDLS | Refined Style. Effortless Confidence.";

/*
 * Google/meta description:
 * Deliberately shorter than the social description so the strongest
 * brand statement is less likely to be truncated in search results.
 */
const DESCRIPTION =
  "TDLS is where refined design meets effortless confidence. Timeless in character, effortless in comfort—created to be felt, lived in, and remembered.";

/*
 * Facebook / WhatsApp / Messenger / LinkedIn / X:
 * Full approved brand statement.
 */
const SOCIAL_DESCRIPTION =
  "TDLS is where refined design meets effortless confidence. Created for those who believe style is more than what you wear—it is how you feel, how you move, and what you leave behind. Timeless in character, effortless in comfort, unmistakably TDLS.";

const OG_IMAGE = `${SITE_URL}/tdls-social-preview`;

const LOGO_IMAGE = `${SITE_URL}/favicon.ico`;

// Next.js App Router metadata for this page
export const metadata = {
  /*
   * ✅ absolute prevents the root title template from turning this into:
   * TDLS | Refined Style... | TDLS
   */
  title: {
    absolute: TITLE,
  },

  description: DESCRIPTION,

  alternates: {
    canonical: SITE_URL,
  },

  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: BRAND,
    title: TITLE,
    description: SOCIAL_DESCRIPTION,

    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "TDLS — refined design, effortless confidence and timeless character.",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SOCIAL_DESCRIPTION,
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
    "@id": `${SITE_URL}/#organization`,
    name: BRAND,
    url: SITE_URL,
    logo: LOGO_IMAGE,
    image: OG_IMAGE,
    description: DESCRIPTION,
  };

  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BRAND,
    url: SITE_URL,
    description: DESCRIPTION,

    publisher: {
      "@id": `${SITE_URL}/#organization`,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(orgJsonLd),
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(siteJsonLd),
        }}
      />

      <ClientHomepage homepage={homepage} error={error} />

      <BottomFloatingBarShell />
    </>
  );
}