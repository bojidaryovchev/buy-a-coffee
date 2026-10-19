import { afterEach, describe, expect, it, vi } from "vitest";
import { newsletterFixture, newsletterProductsFixture } from "@/emails/fixtures";
import { buildCustomRoute } from "next/dist/server/lib/router-utils/filesystem";
import { prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { MEDIA_KEY, MEDIA_PREFIXES, emailMediaUrl, storeKey } from "@/emails/media";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { PRODUCTION_ORIGIN } from "@/emails/theme";
import { unsubscribeUrl } from "@/lib/newsletter/links";

/**
 * Pictures and files in mail come from the shop's own address: our store's
 * addresses are written as `https://buy-a-coffee.com/media/<key>`
 * (`emails/media.ts`), and `next.config.ts` proxies exactly those paths to the
 * store. Both halves are held here, and held to each other — the rewrite run
 * through Next's own matcher and destination builder (`buildCustomRoute`,
 * `prepareDestination`), the ones its server uses, so what is tested is how
 * Next will read the rule.
 */

const STORE = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com";
const env = { NEXT_PUBLIC_IMAGE_BASE_URL: STORE, NEXT_PUBLIC_SITE_URL: "https://buy-a-coffee.com" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("an address in mail", () => {
  it("is ours for our store's photographs and uploads, query and all", () => {
    expect(emailMediaUrl(`${STORE}/catalog/ab/cd/abcd.jpg`, env)).toBe(
      `${PRODUCTION_ORIGIN}/media/catalog/ab/cd/abcd.jpg`,
    );
    expect(emailMediaUrl(`${STORE}/newsletter/c1/ceni-x1Y.pdf?download=1`, env)).toBe(
      `${PRODUCTION_ORIGIN}/media/newsletter/c1/ceni-x1Y.pdf?download=1`,
    );
  });

  it("is left alone when it is anybody else's, or outside the two prefixes", () => {
    for (const url of [
      // Another Blob store: not the one our rewrite serves.
      "https://otherstore.public.blob.vercel-storage.com/newsletter/a.jpg",
      // A host that only starts like ours.
      "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com.evil.example/catalog/a.jpg",
      // Our store over plain http is another origin.
      "http://j6xpmlta50zfdxeo.public.blob.vercel-storage.com/catalog/a.jpg",
      // Our store, but not a path `/media` serves.
      `${STORE}/private/a.jpg`,
      `${STORE}/catalogue/a.jpg`,
      `${STORE}/catalog`,
      // Our store and prefix, but a key `/media` would not serve.
      `${STORE}/CATALOG/a.jpg`,
      `${STORE}/catalog/..%2Fprivate%2Fsecret.png`,
      `${STORE}/catalog/ab/.hidden`,
      `${STORE}/newsletter/a%20b.pdf`,
      "https://www.kafezona.com/img/a.jpg",
      "https://example.com/catalog/a.jpg",
      "mailto:info@buy-a-coffee.com",
      "not a url",
    ]) {
      expect(emailMediaUrl(url, env), url).toBe(url);
    }
  });

  it("is left alone when no store is configured", () => {
    expect(emailMediaUrl(`${STORE}/catalog/a.jpg`, {})).toBe(`${STORE}/catalog/a.jpg`);
    expect(
      storeKey(`${STORE}/catalog/a.jpg`, { NEXT_PUBLIC_IMAGE_BASE_URL: "nonsense" }),
    ).toBeNull();
  });

  it("follows a store base with a path, as `resolveImageUrl` does", () => {
    const withPath = { NEXT_PUBLIC_IMAGE_BASE_URL: "https://cdn.example.test/shop/" };
    expect(emailMediaUrl("https://cdn.example.test/shop/catalog/a.jpg", withPath)).toBe(
      `${PRODUCTION_ORIGIN}/media/catalog/a.jpg`,
    );
    expect(emailMediaUrl("https://cdn.example.test/catalog/a.jpg", withPath)).toBe(
      "https://cdn.example.test/catalog/a.jpg",
    );
  });

  it("is made absolute on a laptop, where `/media` reads the disk", () => {
    expect(
      emailMediaUrl("/media/catalog/a.jpg", { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }),
    ).toBe("http://localhost:3000/media/catalog/a.jpg");
  });
});

describe("the newsletter's pictures and files", () => {
  it("come from the shop's address in both parts", async () => {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_BASE_URL", STORE);
    const recipient = { unsubscribeUrl: unsubscribeUrl("a".repeat(64)) };
    const plain = await composeNewsletterEmail(newsletterFixture, recipient);
    const products = await composeNewsletterEmail(newsletterProductsFixture, recipient);

    for (const { html, text } of [plain, products]) {
      expect(html).not.toContain("blob.vercel-storage.com");
      expect(text).not.toContain("blob.vercel-storage.com");
    }
    expect(plain.html).toContain(
      `src="${PRODUCTION_ORIGIN}/media/newsletter/oktomvri-novi-kafeta-AbC123xYz.jpg"`,
    );
    expect(plain.html).toContain(
      `href="${PRODUCTION_ORIGIN}/media/newsletter/ceni-oktomvri-QwE789rTy.pdf?download=1"`,
    );
    expect(plain.text).toContain(
      `${PRODUCTION_ORIGIN}/media/newsletter/ceni-oktomvri-QwE789rTy.pdf?download=1`,
    );
    expect(products.html).toMatch(
      new RegExp(
        `src="${PRODUCTION_ORIGIN}/media/catalog/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\\.jpg"`,
      ),
    );
  });
});

/* -- next.config.ts --------------------------------------------------------- */

type Rewrite = { source: string; destination: string };

async function loadConfig(values: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
  const config = (await import("../next.config")).default;
  const rewrites = (await config.rewrites?.()) as unknown as {
    beforeFiles: Rewrite[];
    afterFiles: Rewrite[];
  };
  const headers = (await config.headers?.()) ?? [];
  return { config, rewrites, headers };
}

/**
 * Where Next would send a request path: through every `beforeFiles` rule, as
 * its server builds and runs them (case-insensitive, as configured here),
 * to the first that matches. Null when none does.
 */
function route(rules: readonly Rewrite[], path: string, query: Record<string, string> = {}) {
  for (const rule of rules) {
    const built = buildCustomRoute("before_files_rewrite", rule, "", undefined);
    const params = built.match(path);
    if (!params) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params,
      query,
    });
    const search = new URLSearchParams(
      parsedDestination.query as Record<string, string>,
    ).toString();
    return `${parsedDestination.protocol}//${parsedDestination.hostname}${parsedDestination.pathname}${search ? `?${search}` : ""}`;
  }
  return null;
}

describe("the /media rewrite", () => {
  const production = { NODE_ENV: "production", NEXT_PUBLIC_IMAGE_BASE_URL: STORE };

  it("proxies the two prefixes mail writes to the configured store, one rule each", async () => {
    const { rewrites } = await loadConfig(production);
    expect(rewrites.beforeFiles).toEqual(
      MEDIA_PREFIXES.map((prefix) => ({
        source: `/media/${prefix}/:key(${MEDIA_KEY})`,
        destination: `${STORE}/${prefix}/:key`,
      })),
    );
    expect(route(rewrites.beforeFiles, "/media/catalog/ab/cd/abcd.jpg")).toBe(
      `${STORE}/catalog/ab/cd/abcd.jpg`,
    );
    expect(
      route(rewrites.beforeFiles, "/media/newsletter/6f1c/ceni-x1Y.pdf", { download: "1" }),
    ).toBe(`${STORE}/newsletter/6f1c/ceni-x1Y.pdf?download=1`);
    // The IndexNow rule is where it was.
    expect(rewrites.afterFiles).toHaveLength(1);
  });

  it("fetches nothing outside the two prefixes, and no key that could leave them", async () => {
    const { rewrites } = await loadConfig(production);
    for (const path of [
      "/media/private/a.jpg",
      "/media/catalogue/a.jpg",
      "/media/catalog",
      "/media/catalog/",
      "/media/catalog/..%2Fprivate%2Fsecret.png",
      "/media/catalog/../private/secret.png",
      "/media/catalog/ab/./x.jpg",
      "/media/catalog/.hidden",
      "/media/catalog/ab//x.jpg",
      "/media/catalog/a%20b.jpg",
      "/media/newsletter/a b.pdf",
      "/bg/media/catalog/a.jpg",
    ]) {
      expect(route(rewrites.beforeFiles, path), path).toBeNull();
    }
  });

  it("keeps a differently cased prefix inside its own: Next matches without regard to case", async () => {
    const { rewrites } = await loadConfig(production);
    expect(route(rewrites.beforeFiles, "/media/CATALOG/ab/x.jpg")).toBe(
      `${STORE}/catalog/ab/x.jpg`,
    );
    expect(route(rewrites.beforeFiles, "/media/NewsLetter/x.pdf")).toBe(
      `${STORE}/newsletter/x.pdf`,
    );
  });

  it("serves every address the mail writes, and the mail writes none the rewrite refuses", async () => {
    const { rewrites } = await loadConfig(production);
    for (const key of [
      "catalog/0a/82/0a8251d99ef0034db768b947b63d952a6079db8057cc63e8f6e6139bac7a5c0d.jpg",
      "newsletter/6f1c2b9e-3a47-4d8e-9b1a-2c3d4e5f6a7b/ceni-oktomvri-QwE789rTy.pdf",
    ]) {
      const written = emailMediaUrl(`${STORE}/${key}`, env);
      expect(written).toBe(`${PRODUCTION_ORIGIN}/media/${key}`);
      expect(route(rewrites.beforeFiles, new URL(written).pathname)).toBe(`${STORE}/${key}`);
    }
    for (const key of ["catalog/..%2Fx.jpg", "CATALOG/x.jpg", "newsletter/.x.pdf"]) {
      expect(emailMediaUrl(`${STORE}/${key}`, env)).toBe(`${STORE}/${key}`);
    }
  });

  it("leaves caching to the store's own headers, so a missing file is not kept", async () => {
    const { headers } = await loadConfig(production);
    const media = headers.filter((rule) => rule.source.startsWith("/media/"));
    expect(media).toHaveLength(MEDIA_PREFIXES.length);
    for (const rule of media) {
      expect(rule.headers).toEqual([{ key: "x-vercel-enable-rewrite-caching", value: "1" }]);
    }
  });

  it("leaves the storefront's image host and policy as they were", async () => {
    const { config, headers } = await loadConfig(production);
    expect(config.images?.remotePatterns).toEqual([
      {
        protocol: "https",
        hostname: "j6xpmlta50zfdxeo.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ]);
    const csp = headers
      .find((rule) => rule.source === "/:path*")
      ?.headers.find((header) => header.key === "Content-Security-Policy-Report-Only")?.value;
    expect(csp).toMatch(
      new RegExp(`img-src 'self' data: blob: ${STORE.replace(/\./g, "\\.")}(;|$)`),
    );
  });

  it("is not there without a store, where the development route serves /media from disk", async () => {
    const { rewrites, headers } = await loadConfig({
      NODE_ENV: "production",
      NEXT_PUBLIC_IMAGE_BASE_URL: "",
    });
    expect(rewrites.beforeFiles).toEqual([]);
    expect(headers.some((rule) => rule.source.startsWith("/media"))).toBe(false);
  });
});
