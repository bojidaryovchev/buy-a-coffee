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

/**
 * The configured image host, parsed once.
 *
 * `images.remotePatterns` and the Content-Security-Policy below are two
 * statements of the same rule, so they are derived from the same value. Two
 * parsers would be two answers the day the variable holds something odd.
 */
function parseImageHost(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

const imageHost = parseImageHost(process.env.NEXT_PUBLIC_IMAGE_BASE_URL?.trim());

function remotePatternFor(host: URL | null) {
  if (!host) return [];
  return [
    {
      protocol: host.protocol.replace(":", "") as "http" | "https",
      hostname: host.hostname,
      ...(host.port ? { port: host.port } : {}),
      pathname: "/**",
    },
  ];
}

/**
 * Content-Security-Policy.
 *
 * **A static policy, not a nonce-based one, and the reason is rendering.** A
 * nonce has to be new for every response, so Next.js can only apply one while
 * rendering a request: every page becomes dynamically rendered, and nothing
 * can be prerendered, revalidated or served from the CDN (the Next.js CSP
 * guide says so in as many words, and rules out Partial Prerendering with
 * it). This storefront is the opposite case — its pages are prerendered and
 * revalidated on a timer (`export const revalidate`) — and trading that for
 * a stricter `script-src` would make every product page a function
 * invocation and a database query.
 *
 * What the static policy costs is `'unsafe-inline'` in `script-src`. The App
 * Router streams its payload as inline `<script>` elements whose contents
 * differ per page, so they can be neither hashed here nor, without a nonce,
 * individually allowed. The policy therefore does not stop an injected inline
 * script; the defences against that remain the sanitiser on product
 * descriptions and React's escaping. What it does do is pin every *source*:
 * no script, style, font, frame, form target or connection outside this
 * origin, and no image outside this origin and the configured image host.
 * (The experimental hash-based SRI mode covers script files only, not the
 * inline payload, so it does not remove `'unsafe-inline'` either.)
 *
 * Directive by directive:
 *
 *  - `script-src 'self'` covers the app's chunks under `/_next/static` and
 *    the platform analytics, which are served same-origin from
 *    `/_vercel/insights/*` and `/_vercel/speed-insights/*`. The JSON-LD
 *    blocks are `type="application/ld+json"`: data, not script, and CSP does
 *    not govern them.
 *  - `style-src 'unsafe-inline'`: `next/font` and the framework emit inline
 *    `<style>`, and one honeypot field carries a `style` attribute.
 *  - `font-src 'self'`: `next/font/google` downloads the faces at build time
 *    and serves them from `/_next/static/media`. Nothing is fetched from
 *    Google by a visitor.
 *  - `img-src`: this origin (which includes `/_next/image` and the
 *    development `/media` route), the configured image host, and `data:` /
 *    `blob:` for the placeholders `next/image` generates.
 *  - `connect-src 'self'`: router fetches, the typeahead, server actions and
 *    the analytics beacons, all same-origin.
 *  - `frame-ancestors 'none'` restates `X-Frame-Options: DENY`, and
 *    `form-action 'self'` holds for the admin panel too: its forms are server
 *    actions, and attachment downloads are links, which CSP does not restrict.
 *
 * In development only: `'unsafe-eval'` (React rebuilds server stack traces
 * with `eval`), `ws:` for hot reload, and the host the analytics packages
 * load their debug build from.
 *
 * **Shipped as `Content-Security-Policy-Report-Only`.** Nothing is blocked
 * yet; violations show in the browser console. `upgrade-insecure-requests`
 * and a `report-uri` are left for the switch to enforcing: the first is
 * ignored in report-only mode, and the second needs an endpoint to receive it.
 */
const isDevelopment = process.env.NODE_ENV !== "production";

function contentSecurityPolicy(host: URL | null): string {
  const directives: Record<string, readonly string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDevelopment ? ["'unsafe-eval'", "https://va.vercel-scripts.com"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(host ? [host.origin] : [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(isDevelopment ? ["ws:"] : [])],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  transpilePackages: ["@catalog/db", "@catalog/shared"],

  experimental: {
    /*
     * `app/global-not-found.tsx` draws the 404 for a URL that matches no route.
     * It is needed because there is no `app/layout.tsx`: the shop's root layout
     * sits under `[lang]`, so `<html lang>` can follow the locale, and a plain
     * `not-found.tsx` has no root layout above it to render inside.
     */
    globalNotFound: true,
  },

  images: {
    remotePatterns: remotePatternFor(imageHost),
    formats: ["image/avif", "image/webp"],
    /*
     * Widths to offer. The defaults run to 3840 px, but the mirrored photos are
     * about 800 px wide, so anything past a phone's 2× width only upscales — and
     * each offered width is markup in every <img> on a 24-card listing, which
     * the browser parses before it paints.
     */
    deviceSizes: [384, 640, 828, 1080, 1200],
    imageSizes: [40, 64, 96, 128, 256],
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
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy(imageHost),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
