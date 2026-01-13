// FILE: next.config.ts
import type { NextConfig } from "next";
import { URL } from "url";

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

addSpec(specs, { protocol: "https", hostname: "www.thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "media.thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "cms.thednalabstore.com" });

// Allow whatever you set in env to also be permitted for images
addSpec(
  specs,
  specFromUrl(process.env.NEXT_PUBLIC_STRAPI_URL) ||
    specFromUrl(process.env.STRAPI_URL) ||
    null
);

// Media domain from env (Strapi/Cloudflare R2 custom domain)
addSpec(
  specs,
  specFromUrl(process.env.NEXT_PUBLIC_MEDIA_PUBLIC_URL) ||
    specFromUrl(process.env.NEXT_PUBLIC_MEDIA_URL) ||
    specFromUrl(process.env.MEDIA_PUBLIC_URL) ||
    null
);

addSpec(specs, { protocol: "http", hostname: "127.0.0.1", port: "1337" });
addSpec(specs, { protocol: "http", hostname: "localhost", port: "1337" });

/**
 * Vercel build OOM mitigation:
 * Next.js runs ESLint during `next build` by default; this can increase peak memory on Vercel.
 * We keep lint strict locally/CI, but avoid build-time lint on Vercel only to prevent OOM SIGKILL.
 */
const isVercelBuild = process.env.VERCEL === "1" || process.env.VERCEL === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * FIX: Static generation timeout
   * Your /sitemap-products.xml route is exceeding the default 60s build worker limit.
   * Increase it to avoid build failures for large catalogs.
   */
  staticPageGenerationTimeout: 180,

  /**
   * Next build memory optimizations (does not change runtime behavior)
   */
  experimental: {
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
  },

  /**
   * Prisma on Vercel:
   * Keep Prisma packages external (resolved via Node require) to reduce bundling/tracing issues.
   */
  serverExternalPackages: ["@prisma/client", "prisma"],

  // Output File Tracing
  outputFileTracingRoot: process.cwd(),

  // Keys are route globs (matched against the route path); values are file globs from project root.
  outputFileTracingExcludes: {
    "/*": [
      // Avoid Windows user-profile junctions / protected locations.
      // Do NOT reference "Application Data" (junction). Use AppData instead.
      "**/AppData/**",
      "**/Cookies/**",
      "**/Local Settings/**",
      "**/NTUSER.DAT*",
      "**/$RECYCLE.BIN/**",
      "**/Documents and Settings/**",
      "**/System Volume Information/**",

      // Absolute forward-slash patterns to avoid junction traversal
      "C:/Users/**/AppData/**",
      "C:/$Recycle.Bin/**",
      "C:/$RECYCLE.BIN/**",
      "C:/System Volume Information/**",
      "C:/Documents and Settings/**",
    ],
  },

  outputFileTracingIncludes: {
    /**
     * IMPORTANT CHANGE:
     * Removed "./node_modules/@prisma/engines/**" from tracing because it bloats
     * the server output and increases "Deploying outputs..." memory pressure.
     *
     * Your runtime Prisma engines are already under:
     * - node_modules/.prisma/client
     * and you also copy them into:
     * - src/generated/prisma/**
     */
    "/*": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
      "./src/generated/prisma/**",
    ],

    "/api/**": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
      "./src/generated/prisma/**",
    ],
  },

  images: {
    remotePatterns: Array.from(specs.values()).map((s) => ({
      protocol: s.protocol,
      hostname: s.hostname,
      port: s.port,
      pathname: "/**",
    })),
  },

  // Keep build strict locally; avoid build-time lint only on Vercel to reduce peak memory.
  eslint: { ignoreDuringBuilds: isVercelBuild },
  typescript: { ignoreBuildErrors: false },

  webpack: (config) => {
    /**
     * WINDOWS EPERM FIX:
     * Do NOT merge existing `watchOptions.ignored` (it may contain non-string items).
     * Provide only valid non-empty string globs so webpack schema validation passes.
     */
    const ignoredGlobs: string[] = [
      "**/node_modules/**",
      "**/.git/**",
      "**/.next/**",
      "**/.vercel/**",
      "**/.turbo/**",

      // Windows protected junctions / dirs that can throw EPERM when scanned
      // IMPORTANT: do NOT include "Application Data" here (junction). Use AppData instead.
      "C:\\\\Users\\\\**\\\\AppData\\\\**",
      "C:\\\\Users\\\\**\\\\Cookies\\\\**",
      "C:\\\\Users\\\\**\\\\Local Settings\\\\**",
      "C:\\\\Users\\\\**\\\\NTUSER.DAT*",
      "C:\\\\$Recycle.Bin\\\\**",
      "C:\\\\System Volume Information\\\\**",
      "C:\\\\Documents and Settings\\\\**",

      // Also include forward-slash absolute patterns (some resolvers normalize this way)
      "C:/Users/**/AppData/**",
      "C:/$Recycle.Bin/**",
      "C:/$RECYCLE.BIN/**",
      "C:/System Volume Information/**",
      "C:/Documents and Settings/**",
    ];

    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ignoredGlobs,
    };

    return config;
  },
};

export default nextConfig;
