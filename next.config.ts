// FILE: next.config.ts
import type { NextConfig } from "next";

type HostSpec = { protocol: "http" | "https"; hostname: string; port?: string };

function specFromUrl(url?: string | null): HostSpec | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const protocol = (u.protocol.replace(":", "") as "http" | "https") || "https";
    const hostname = u.hostname;
    const port = u.port || undefined;
    if (!hostname) return null;
    return { protocol, hostname, port };
  } catch {
    return null;
  }
}

function addSpec(map: Map<string, HostSpec>, spec: HostSpec | null) {
  if (!spec) return;
  const key = `${spec.protocol}://${spec.hostname}${spec.port ? `:${spec.port}` : ""}`;
  map.set(key, spec);
}

const specs = new Map<string, HostSpec>();

// Safe defaults for your production domains
addSpec(specs, { protocol: "https", hostname: "www.thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "thednalabstore.com" });

// Cloudflare R2 public media domain
addSpec(specs, { protocol: "https", hostname: "media.thednalabstore.com" });

// Strapi (prod) domain default — also supports env overrides below
addSpec(specs, { protocol: "https", hostname: "cms.thednalabstore.com" });

// Strapi host from env (supports both dev + prod)
const envStrapi =
  specFromUrl(process.env.NEXT_PUBLIC_STRAPI_URL) ||
  specFromUrl(process.env.STRAPI_URL) ||
  null;

addSpec(specs, envStrapi);

// Local dev fallbacks (common cases)
addSpec(specs, { protocol: "http", hostname: "127.0.0.1", port: "1337" });
addSpec(specs, { protocol: "http", hostname: "localhost", port: "1337" });

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Security: avoid disclosing Next.js via header
  poweredByHeader: false,

  // If you use Next/Image for product images from Strapi or R2,
  // allow those hosts here (supports both dev + prod).
  images: {
    remotePatterns: Array.from(specs.values()).map((s) => ({
      protocol: s.protocol,
      hostname: s.hostname,
      port: s.port,
      pathname: "/**",
    })),
  },

  // Keep checks ON for safe production builds
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
