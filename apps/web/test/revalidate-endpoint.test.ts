import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as RevalidateRoute from "@/app/api/revalidate/route";

/**
 * `POST /api/revalidate`, the door the sync and the copy scripts knock on.
 *
 * Held to four things: nobody without the secret gets in, a body that is not
 * exactly one of the two shapes is refused before anything happens, nothing
 * is ever revalidated as the layout (which turns the `dynamicParams = false`
 * pages into cached 404s; `lib/revalidate-shop.ts`), and the answer names what
 * was refreshed. `revalidatePath` and `revalidateTag` are recorders; nothing
 * here touches a database or a cache.
 */

const calls = vi.hoisted(() => [] as Array<[string, string | undefined]>);
const tags = vi.hoisted(() => [] as Array<[string, unknown]>);
const fail = vi.hoisted(() => ({ next: false }));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => {
    if (fail.next) throw new Error("cache unavailable");
    calls.push([path, type]);
  },
  revalidateTag: (tag: string, profile: unknown) => {
    tags.push([tag, profile]);
  },
}));

const SECRET = "s".repeat(40);
const URL_ = "https://buy-a-coffee.com/api/revalidate";

let route: typeof RevalidateRoute;

const { SELF_TIMED_ROUTES, SHOP_PAGE_ROUTES, checkShopPath, isProductSlug } =
  await import("@/lib/revalidate-shop");
const { REVALIDATE_CALLS, revalidateCallLimit } = await import("@/lib/revalidate-request");

/** The sitemap expired at once, by the shop's tag. */
const SITEMAP_EXPIRED: Array<[string, unknown]> = [["sitemap", { expire: 0 }]];

function post(
  body: unknown,
  {
    authorization = `Bearer ${SECRET}`,
    type = "application/json",
  }: { authorization?: string | null; type?: string } = {},
) {
  const headers = new Headers({ "content-type": type });
  if (authorization) headers.set("authorization", authorization);
  return new Request(URL_, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  // A fresh module each time: the rate limiter's window starts empty.
  vi.resetModules();
  route = await import("@/app/api/revalidate/route");
  vi.stubEnv("REVALIDATE_SECRET", SECRET);
  vi.stubEnv("CRON_SECRET", "c".repeat(40));
  calls.length = 0;
  tags.length = 0;
  fail.next = false;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may call it", () => {
  it("does not exist while no REVALIDATE_SECRET is configured, CRON_SECRET or not", async () => {
    vi.stubEnv("REVALIDATE_SECRET", "");
    for (const authorization of [`Bearer ${SECRET}`, `Bearer ${"c".repeat(40)}`, null]) {
      const response = await route.POST(post({ scope: "catalog" }, { authorization }));
      expect(response.status, String(authorization)).toBe(404);
    }
    vi.stubEnv("REVALIDATE_SECRET", "   ");
    expect((await route.POST(post({ scope: "catalog" }))).status).toBe(404);
    expect(calls).toEqual([]);
    expect(tags).toEqual([]);
  });

  it("answers 401 without the secret, with the wrong one, or with CRON_SECRET, and refreshes nothing", async () => {
    const cron = `Bearer ${"c".repeat(40)}`;
    for (const authorization of [null, "Bearer wrong", SECRET, `Basic ${SECRET}`, cron]) {
      const response = await route.POST(post({ scope: "catalog" }, { authorization }));
      expect(response.status, String(authorization)).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
    }
    expect(calls).toEqual([]);
    expect(tags).toEqual([]);
  });

  it("is POST only", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
    expect(route.dynamic).toBe("force-dynamic");
  });
});

describe("what it accepts", () => {
  const refused = async (request: Request, status: number, error: string) => {
    const response = await route.POST(request);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { error: string; rejected?: unknown[] };
    expect(body.error).toBe(error);
    return body;
  };

  it("refuses anything but one JSON object of the two shapes, and refreshes nothing", async () => {
    await refused(post({ scope: "catalog" }, { type: "text/plain" }), 415, "content_type_not_json");
    await refused(post("{scope:", {}), 400, "invalid_json");
    await refused(post(["catalog"]), 400, "not_an_object");
    await refused(post("null"), 400, "not_an_object");
    await refused(post({}), 400, "nothing_to_revalidate");
    await refused(post({ scope: "everything" }), 400, "unknown_scope");
    await refused(post({ scope: "layout" }), 400, "unknown_scope");
    await refused(post({ scope: "catalog", paths: ["/bg"] }), 400, "scope_with_paths");
    const unknown = await refused(post({ paths: ["/bg"], type: "layout" }), 400, "unknown_field");
    expect(unknown.rejected).toEqual([{ value: "type", reason: "unknown_field" }]);
    await refused(post({ paths: "/bg" }), 400, "paths_not_a_list");
    await refused(post({ paths: [] }), 400, "paths_empty");
    await refused(post({ paths: ["/bg", 7] }), 400, "paths_not_strings");
    await refused(post({ slugs: [null] }), 400, "slugs_not_strings");
    expect(calls).toEqual([]);
  });

  it("is bounded: 100 paths, 100 slugs, 16 KiB", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `/bg/produkt-${i}`);
    await refused(post({ paths: many }), 400, "paths_too_many");
    await refused(post({ slugs: many.map((path) => path.slice(4)) }), 400, "slugs_too_many");
    const padding = "x".repeat(17 * 1024);
    await refused(post({ paths: ["/bg"], padding }), 413, "body_too_large");
    expect(calls).toEqual([]);
  });

  it("refuses the whole request when one path is not a page it may refresh", async () => {
    const body = await refused(
      post({
        paths: [
          "/bg/marki/lavazza",
          "/bg/blog/vidove-kapsuli-za-kafe",
          "/bg/za-kafemashina/krups",
          "/(site)/[lang]",
          "/admin",
          "/api/revalidate",
          "/en/brands",
          "/bg/kategorii/nyama-takava",
          "/bg/",
          "/bg/../admin",
          "/bg/Lavazza",
          "/bg?x=1",
          "https://buy-a-coffee.com/bg",
        ],
      }),
      400,
      "rejected",
    );
    expect(body.rejected).toEqual([
      { value: "/bg/blog/vidove-kapsuli-za-kafe", reason: "self_timed" },
      { value: "/bg/za-kafemashina/krups", reason: "self_timed" },
      { value: "/(site)/[lang]", reason: "malformed" },
      { value: "/admin", reason: "malformed" },
      { value: "/api/revalidate", reason: "malformed" },
      { value: "/en/brands", reason: "locale" },
      { value: "/bg/kategorii/nyama-takava", reason: "unknown_route" },
      { value: "/bg/", reason: "malformed" },
      { value: "/bg/../admin", reason: "malformed" },
      { value: "/bg/Lavazza", reason: "malformed" },
      { value: "/bg?x=1", reason: "malformed" },
      { value: "https://buy-a-coffee.com/bg", reason: "malformed" },
    ]);
    expect(calls).toEqual([]);
  });

  it("refuses a slug that is not one the catalog could have allocated", async () => {
    const body = await refused(
      post({ slugs: ["lavazza-crema", "Lavazza Crema", "kategorii", "bg", "a/b", ""] }),
      400,
      "rejected",
    );
    expect(body.rejected).toEqual([
      { value: "Lavazza Crema", reason: "not_a_product_slug" },
      { value: "kategorii", reason: "not_a_product_slug" },
      { value: "bg", reason: "not_a_product_slug" },
      { value: "a/b", reason: "not_a_product_slug" },
      { value: "", reason: "not_a_product_slug" },
    ]);
    expect(calls).toEqual([]);
  });
});

describe("what it refreshes", () => {
  it("for the catalog: every page route as a page, llms.txt and the sitemap, never the layout", async () => {
    const response = await route.POST(post({ scope: "catalog" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      scope: string;
      routes: string[];
      paths: string[];
      files: string[];
    };
    expect(body.scope).toBe("catalog");
    expect(body.routes).toEqual(SHOP_PAGE_ROUTES.map((page) => `/(site)/[lang]${page}`));
    expect(body.paths).toEqual([]);
    expect(body.files).toEqual(["/sitemap.xml", "/llms.txt"]);

    expect(calls).toEqual([
      ...SHOP_PAGE_ROUTES.map((page): [string, string] => [`/(site)/[lang]${page}`, "page"]),
      ["/llms.txt", undefined],
    ]);
    expect(tags).toEqual(SITEMAP_EXPIRED);
    expect(calls.some(([, type]) => type === "layout")).toBe(false);
    for (const page of SELF_TIMED_ROUTES) {
      expect(calls.some(([path]) => path.endsWith(page))).toBe(false);
    }
  });

  it("for pages and slugs: each URL once, as a single page, and the sitemap", async () => {
    const response = await route.POST(
      post({
        paths: ["/bg/marki/lavazza", "/bg", "/bg/marki/lavazza", "/bg/lavazza-crema"],
        slugs: ["lavazza-crema", "illy-classico"],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      scope: null;
      routes: string[];
      paths: string[];
      files: string[];
    };
    expect(body.scope).toBeNull();
    expect(body.routes).toEqual([]);
    expect(body.paths).toEqual([
      "/bg/marki/lavazza",
      "/bg",
      "/bg/lavazza-crema",
      "/bg/illy-classico",
    ]);
    expect(body.files).toEqual(["/sitemap.xml"]);
    expect(calls).toEqual([
      ["/bg/marki/lavazza", undefined],
      ["/bg", undefined],
      ["/bg/lavazza-crema", undefined],
      ["/bg/illy-classico", undefined],
    ]);
    expect(tags).toEqual(SITEMAP_EXPIRED);
  });

  it("answers 500, and says so in the log, when the cache cannot be reached", async () => {
    fail.next = true;
    const response = await route.POST(post({ scope: "catalog" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "revalidate_failed" });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("revalidate.failed"));
  });

  it("allows twenty calls in ten minutes, then answers 429 with when to come back", async () => {
    for (let call = 0; call < 20; call += 1) {
      expect((await route.POST(post({ paths: ["/bg"] }))).status).toBe(200);
    }
    const limited = await route.POST(post({ paths: ["/bg"] }));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(calls).toHaveLength(20);
    expect(tags).toHaveLength(20);
  });
});

describe("its ceiling", () => {
  it("is twenty calls on every deployment, whatever the environment says", () => {
    expect(REVALIDATE_CALLS).toBe(20);
    for (const value of [undefined, "1000", "100000", "5", "abc"]) {
      expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: value }, true), String(value)).toBe(20);
    }
  });

  it("may be raised, never lowered, off a deployment, up to 100,000", () => {
    expect(revalidateCallLimit({}, false)).toBe(20);
    expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: "1000" }, false)).toBe(1000);
    expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: "5" }, false)).toBe(20);
    expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: "100001" }, false)).toBe(20);
    expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: "1e3" }, false)).toBe(1000);
    expect(revalidateCallLimit({ REVALIDATE_RATE_LIMIT: "12.5" }, false)).toBe(20);
  });
});

describe("the paths it may refresh, held to the route list", () => {
  /** A URL of a route pattern, with a sample value for each dynamic segment. */
  const sample = (page: string) => `/bg${page.replace(/\[[^\]]+\]/g, "primer")}`;

  it("accepts a URL of every page route, and of none of the self-timed ones", () => {
    for (const page of SHOP_PAGE_ROUTES)
      expect(checkShopPath(sample(page)), page).toEqual({ ok: true });
    for (const page of SELF_TIMED_ROUTES) {
      expect(checkShopPath(sample(page)), page).toEqual({ ok: false, reason: "self_timed" });
    }
  });

  it("takes a product slug as the catalog writes them", () => {
    expect(isProductSlug("lavazza-qualita-oro-kafe-na-zarna-1-kg")).toBe(true);
    expect(isProductSlug("x".repeat(121))).toBe(false);
    expect(isProductSlug("-lavazza")).toBe(false);
    expect(isProductSlug("lavazza--oro")).toBe(false);
  });
});
