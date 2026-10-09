import { slugify } from "@catalog/shared";
import { RESERVED_PRODUCT_SLUGS } from "@catalog/shared/storefront-data";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";
import { parseCatalogQuery } from "@/lib/catalog/filters";
import type * as Queries from "@/lib/catalog/queries";
import type { ProductCardView } from "@/lib/catalog/types";
import { brandHref, brandSlug, matchBrandSlug, productHref } from "@/lib/routes";

/**
 * The shop's own names and addresses, against the real catalog.
 *
 *   - no view of a product carries the supplier's name for it;
 *   - every product is at the slug the plan gives it, and every slug it had
 *     before leads to it;
 *   - every brand is published at the slug it writes itself with;
 *   - search finds a product by the name on its page and by the supplier's.
 *
 * Read-only. Skipped, not failed, when no database is reachable or the catalog
 * is empty.
 */

let queries: typeof Queries | null = null;
let close: (() => Promise<void>) | null = null;
let cards: ProductCardView[] = [];
let stored: Array<{ slug: string; name: string; previousSlugs: string[] }> = [];

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  try {
    const loaded = await import("@/lib/catalog/queries");
    const first = await loaded.listProducts({
      query: parseCatalogQuery({ pageSize: "48" }),
      includeFacets: false,
    });
    if (first.total === 0) return;
    cards = [...first.items];
    for (let page = 2; page <= first.pageCount; page += 1) {
      const next = await loaded.listProducts({
        query: parseCatalogQuery({ pageSize: "48", page: String(page) }),
        includeFacets: false,
      });
      cards.push(...next.items);
    }
    const { db } = await import("@/lib/db");
    stored = (await db.execute(
      sql`select slug, name, previous_slugs as "previousSlugs" from products where status = 'active'`,
    )) as unknown as typeof stored;
    queries = loaded;
    close = globalThis.__catalogDb?.close ?? null;
  } catch {
    queries = null;
  }
}, 60_000);

afterAll(async () => {
  await close?.();
});

describe("product names on the storefront", () => {
  it("are never the supplier's", ({ skip }) => {
    if (!queries) skip();
    const supplierNames = new Set(stored.map((row) => row.name));
    expect(cards.length).toBe(stored.length);
    for (const card of cards) {
      expect(supplierNames.has(card.name), card.name).toBe(false);
      expect(supplierNames.has(card.title ?? ""), card.title).toBe(false);
      expect(card.image?.alt ?? card.name).toBe(card.name);
      // The supplier's shorthand, in any field a customer reads.
      for (const text of [card.name, card.title, card.detail, card.weight]) {
        expect(text ?? "").not.toMatch(/(?:^|\s)DG(?:\s|$)|дозети|\d(?:бр|кг)/iu);
      }
    }
  });

  it("are different for every product", ({ skip }) => {
    if (!queries) skip();
    expect(new Set(cards.map((card) => card.name)).size).toBe(cards.length);
  });

  it("open with the brand the card names beside them", ({ skip }) => {
    if (!queries) skip();
    for (const card of cards) {
      if (card.brand) expect(card.title, card.slug).toContain(card.brand.name);
    }
  });

  it("give the product page its heading, its second line and its breadcrumb", async ({ skip }) => {
    if (!queries) skip();
    const capsule = cards.find((card) => card.systemId === "dolce-gusto");
    if (!capsule) skip();
    const product = await queries!.getProductBySlug(capsule!.slug);
    expect(product?.title).toBe(capsule!.title);
    expect(product?.detail).toMatch(/^Капсули за Dolce Gusto, \d+ бр\.$/u);
    expect(product?.name).toBe(`${product?.title} — ${product?.detail?.replace(/^К/u, "к")}`);
    expect(product?.formatListingLabel).toBe("Капсули за Dolce Gusto");
    const primary = product?.categories.find((category) => category.isPrimary);
    expect(primary?.parent?.sourceKey).toBe("kafe-kapsuli");
  });
});

describe("product slugs in the catalog", () => {
  it("follow <brand>-<line>-<format>-<qty>, and none is a page's address", ({ skip }) => {
    if (!queries) skip();
    for (const row of stored) {
      expect(row.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-(?:\d+-(?:kg|g|br|ml|l))$/);
      expect(row.slug).not.toMatch(/(?:^|-)dg(?:-|$)|^(?:kapsuli|dozeti|kafe-na-zarna)-/);
      expect(RESERVED_PRODUCT_SLUGS.has(row.slug), row.slug).toBe(false);
    }
  });

  it("each lead from the slug the product had before", async ({ skip }) => {
    if (!queries) skip();
    const moved = stored.filter((row) => row.previousSlugs.length > 0);
    if (moved.length === 0) skip();
    const current = new Set(stored.map((row) => row.slug));
    for (const row of moved) {
      for (const former of row.previousSlugs) {
        // An old address is never a live one, or it could not redirect.
        expect(current.has(former), former).toBe(false);
        expect(await queries!.getCurrentSlugOfFormer(former), former).toBe(row.slug);
      }
    }
    expect(await queries!.getCurrentSlugOfFormer("no-product-was-ever-here")).toBeNull();
  });

  it("are resolved: the current one is the page, a former one a redirect to it", async ({
    skip,
  }) => {
    if (!queries) skip();
    const row = stored.find((candidate) => candidate.previousSlugs.length > 0);
    if (!row) skip();
    const { resolveSlug } = await import("@/lib/catalog/resolve-slug");
    expect((await resolveSlug("bg", row!.slug))?.kind).toBe("product");
    expect(await resolveSlug("bg", row!.previousSlugs[0]!)).toEqual({
      kind: "redirect",
      to: productHref("bg", { slug: row!.slug }),
    });
  });

  it("are all in the list the proxy's existence check needs, old and new", async ({ skip }) => {
    if (!queries) skip();
    const { db } = await import("@/lib/db");
    const { loadRoutableSlugs } = await import("@/lib/catalog/routable-slugs");
    const routable = await loadRoutableSlugs(db);
    for (const row of stored) {
      expect(routable.products.has(row.slug), row.slug).toBe(true);
      for (const former of row.previousSlugs) expect(routable.products.has(former)).toBe(true);
    }
    for (const brand of await queries!.listBrands()) {
      expect(routable.brands.has(brand.slug), brand.slug).toBe(true);
      expect(routable.brands.has(brandSlug("bg", brand)), brand.slug).toBe(true);
    }
  });
});

describe("brand slugs in the catalog", () => {
  it("are the brand's own spelling, for every brand", async ({ skip }) => {
    if (!queries) skip();
    const brands = await queries!.listBrands();
    expect(brands.length).toBeGreaterThan(0);
    for (const brand of brands) {
      for (const locale of LOCALES) {
        // A brand whose stored slug is not how it writes itself needs an entry
        // in `i18n/slugs/<locale>.ts` → `brands`.
        expect(brandSlug(locale, brand), brand.name).toBe(slugify(brand.name));
      }
    }
  });

  it("give every brand one address, and send its other slugs there", async ({ skip }) => {
    if (!queries) skip();
    const brands = await queries!.listBrands();
    expect(new Set(brands.map((brand) => brandSlug("bg", brand))).size).toBe(brands.length);

    const lollo = brands.find((brand) => brand.sourceKey === "lollocafe");
    if (!lollo) skip();
    expect(brandHref("bg", lollo!)).toBe("/bg/marki/lollo-caffe");
    expect(matchBrandSlug("bg", brands, "lollo-caffe")).toEqual({ brand: lollo, published: true });
    expect(matchBrandSlug("bg", brands, lollo!.slug)).toEqual({ brand: lollo, published: false });
    expect(matchBrandSlug("bg", brands, "no-such-brand")).toBeNull();
  });
});

describe("search", () => {
  const find = async (q: string) =>
    (
      await queries!.listProducts({
        query: parseCatalogQuery({ q, pageSize: "48" }),
        includeFacets: false,
      })
    ).items.map((item) => item.name);

  it("finds a product by the name on its page", async ({ skip }) => {
    if (!queries) skip();
    // The supplier's name for these says "Adore …", "DG …" and has no "Expert".
    expect(await find("Bianchi Adore")).toContain(
      "Bianchi Adore Espresso Bar — кафе дози ESE, 100 бр.",
    );
    expect(await find("Crema e Aroma Expert")).toContain(
      "Lavazza Crema e Aroma Expert — кафе на зърна, 1 кг",
    );
    expect(await find("Lollo Caffè Oro")).toContain(
      "Lollo Caffè Oro — капсули за Dolce Gusto, 16 бр.",
    );
  });

  it("still finds it by the supplier's name", async ({ skip }) => {
    if (!queries) skip();
    expect(await find("Дозети Adore Espresso Bar")).toContain(
      "Bianchi Adore Espresso Bar — кафе дози ESE, 100 бр.",
    );
    expect(await find("Капсули DG Lollo caffe Oro")).toContain(
      "Lollo Caffè Oro — капсули за Dolce Gusto, 16 бр.",
    );
  });

  it("suggests by our name, with the heading and the line under it", async ({ skip }) => {
    if (!queries) skip();
    const suggestions = await queries!.suggestCatalog("lavazza super");
    const row = suggestions.products.find((product) => product.title === "Lavazza Super Crema");
    expect(row).toMatchObject({
      name: "Lavazza Super Crema — кафе на зърна, 1 кг",
      detail: "Кафе на зърна, 1 кг",
    });
    const brands = (await queries!.suggestCatalog("lollo")).brands;
    expect(brands.find((brand) => brand.sourceKey === "lollocafe")?.name).toBe("Lollo Caffè");
  });
});
