import type { NextConfig } from "next";

/**
 * Storefront configuration.
 *
 * Two things here are load-bearing rather than boilerplate:
 *
 *  - `transpilePackages` lets the app import the workspace packages straight
 *    from TypeScript source, so there is no build step between a change in
 *    `packages/db` and the app seeing it.
 *  - `images.remotePatterns` is the enforcement point for the hard rule that
 *    the storefront never loads anything from the source domain. Only our own
 *    configured image host is allowed; anything else fails to load rather than
 *    silently hotlinking.
 */

const imageHost = process.env.NEXT_PUBLIC_IMAGE_BASE_URL?.trim();

function remotePatternFor(url: string | undefined) {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    return [
      {
        protocol: parsed.protocol.replace(":", "") as "http" | "https",
        hostname: parsed.hostname,
        ...(parsed.port ? { port: parsed.port } : {}),
        pathname: "/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ["@catalog/db", "@catalog/shared"],

  images: {
    remotePatterns: remotePatternFor(imageHost),
    formats: ["image/avif", "image/webp"],
    // Product imagery is content-addressed and immutable, so it can be cached
    // for a long time.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
