import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Content-Security-Policy header in `next.config.ts`.
 *
 * The config reads its environment at module load, so each case stubs the
 * environment and imports the module afresh.
 */

const HEADER = "Content-Security-Policy-Report-Only";

async function loadPolicy(env: Record<string, string>): Promise<{
  raw: string;
  directives: Map<string, string[]>;
  headerNames: string[];
  remotePatterns: unknown;
}> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

  const config = (await import("../next.config")).default;
  const rules = (await config.headers?.()) ?? [];
  const everywhere = rules.find((rule) => rule.source === "/:path*");
  const raw = everywhere?.headers.find((header) => header.key === HEADER)?.value ?? "";

  const directives = new Map<string, string[]>();
  for (const part of raw.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return {
    raw,
    directives,
    headerNames: everywhere?.headers.map((header) => header.key) ?? [],
    remotePatterns: config.images?.remotePatterns,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Content-Security-Policy", () => {
  it("is sent report-only, on every path, next to the existing headers", async () => {
    const { raw, headerNames } = await loadPolicy({ NODE_ENV: "production" });
    expect(raw).not.toBe("");
    expect(headerNames).toContain(HEADER);
    expect(headerNames).not.toContain("Content-Security-Policy");
    expect(headerNames).toEqual(
      expect.arrayContaining([
        "X-Content-Type-Options",
        "Referrer-Policy",
        "X-Frame-Options",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ]),
    );
  });

  it("is well-formed: one of each directive, valid names, nothing that breaks a header", async () => {
    const { raw, directives } = await loadPolicy({
      NODE_ENV: "production",
      NEXT_PUBLIC_IMAGE_BASE_URL: "https://images.example.test/catalog/",
    });

    expect(raw).not.toMatch(/[\r\n,]/);
    expect(raw).not.toMatch(/;\s*;/);
    expect(raw.trim().endsWith(";")).toBe(false);

    const names = raw.split(";").map((part) => part.trim().split(/\s+/)[0]);
    expect(new Set(names).size).toBe(names.length);
    for (const [name, sources] of directives) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(source).toMatch(/^('[a-z-]+'|[a-z]+:|https?:\/\/[a-z0-9.-]+(:\d+)?)$/);
      }
    }
  });

  it("pins every source to this origin in production", async () => {
    const { directives } = await loadPolicy({ NODE_ENV: "production" });

    expect(directives.get("default-src")).toEqual(["'self'"]);
    // Inline is required by the App Router's streamed payload; eval is not.
    expect(directives.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get("font-src")).toEqual(["'self'"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });

  it("allows images from this origin only when no image host is configured", async () => {
    const { directives } = await loadPolicy({
      NODE_ENV: "production",
      NEXT_PUBLIC_IMAGE_BASE_URL: "",
    });
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
  });

  it("adds the configured image host, the same one remotePatterns allows", async () => {
    const { directives, remotePatterns } = await loadPolicy({
      NODE_ENV: "production",
      NEXT_PUBLIC_IMAGE_BASE_URL: " https://images.example.test:8443/catalog/ ",
    });

    expect(directives.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://images.example.test:8443",
    ]);
    expect(remotePatterns).toEqual([
      { protocol: "https", hostname: "images.example.test", port: "8443", pathname: "/**" },
    ]);
  });

  it("ignores an image host that is not a usable http(s) URL, in both places", async () => {
    for (const value of ["not a url", "javascript:alert(1)", "ftp://files.example.test/"]) {
      const { directives, remotePatterns } = await loadPolicy({
        NODE_ENV: "production",
        NEXT_PUBLIC_IMAGE_BASE_URL: value,
      });
      expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
      expect(remotePatterns).toEqual([]);
    }
  });

  it("relaxes only what development needs, and only in development", async () => {
    const { directives } = await loadPolicy({ NODE_ENV: "development" });
    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("connect-src")).toContain("ws:");
  });
});
