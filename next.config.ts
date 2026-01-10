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

addSpec(specs, { protocol: "https", hostname: "www.thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "media.thednalabstore.com" });
addSpec(specs, { protocol: "https", hostname: "cms.thednalabstore.com" });

addSpec(
  specs,
  specFromUrl(process.env.NEXT_PUBLIC_STRAPI_URL) || specFromUrl(process.env.STRAPI_URL) || null
);

addSpec(specs, { protocol: "http", hostname: "127.0.0.1", port: "1337" });
addSpec(specs, { protocol: "http", hostname: "localhost", port: "1337" });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Output File Tracing
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "*": [
      // Avoid Windows user-profile junctions / protected locations.
      // Do NOT reference "Application Data" (junction). Use AppData instead.
      "**/AppData/**",
      "**/Cookies/**",
      "**/Local Settings/**",
      "**/NTUSER.DAT*",
      "**/$RECYCLE.BIN/**",
      "**/Documents and Settings/**",
      "**/System Volume Information/**",

      // Add absolute-forward-slash patterns to avoid any Windows glob resolver
      // accidentally touching the "Application Data" junction while evaluating.
      "C:/Users/**/AppData/**",
      "C:/$Recycle.Bin/**",
      "C:/$RECYCLE.BIN/**",
      "C:/System Volume Information/**",
      "C:/Documents and Settings/**",
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

  eslint: { ignoreDuringBuilds: false },
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
