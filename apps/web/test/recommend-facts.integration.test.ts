import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { categories, productCategories, products, sourceSites } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { listRecommendationCandidates as ListCandidates } from "@/lib/catalog/queries";
import { getBrewingSystem } from "@/lib/recommend/systems";
import { scoreRecommendations } from "@/lib/recommend/score";
import { parseWizardAnswers } from "@/lib/recommend/answers";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * The three stated facts travel from the `products` row to the scorer intact:
 * a value comes through as stored, an unset column comes through as null (never
 * as 0 or as an empty string), and the ranking over what the query returns
 * reads them. Skipped when no PostgreSQL server is reachable.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

suite("recommendation candidates carry the stated facts (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let list: typeof ListCandidates;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("recommend_facts"));
    ({ listRecommendationCandidates: list } = await import("@/lib/catalog/queries"));

    await db.execute(
      sql`truncate table product_categories, products, categories, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    const [category] = await db
      .insert(categories)
      .values({
        sourceSiteId: site!.id,
        sourceKey: "nespresso",
        name: "Nespresso",
        slug: "nespresso",
      })
      .returning({ id: categories.id });

    const rows = [
      { slug: "stated", arabicaPercent: 100, origin: "Бразилия", roast: "светло" },
      { slug: "partly", arabicaPercent: 0, origin: null, roast: null },
      { slug: "unstated", arabicaPercent: null, origin: null, roast: null },
    ];
    for (const row of rows) {
      const [product] = await db
        .insert(products)
        .values({
          sourceSiteId: site!.id,
          sourceKey: `/${row.slug}/`,
          sourceUrl: `https://example.test/${row.slug}/`,
          sourcePath: `/${row.slug}/`,
          name: row.slug,
          slug: row.slug,
          semanticHash: `hash-${row.slug}`,
          attributes: { strength: "weak", decaf: "no", aromas: "no" },
          arabicaPercent: row.arabicaPercent,
          origin: row.origin,
          roast: row.roast,
        })
        .returning({ id: products.id });
      await db
        .insert(productCategories)
        .values({ productId: product!.id, categoryId: category!.id });
    }
  });

  afterAll(async () => {
    await close?.();
  });

  it("returns each product's stored facts, and null where nothing is stored", async () => {
    const system = getBrewingSystem("nespresso-original")!;
    const candidates = await list(system);
    const bySlug = Object.fromEntries(candidates.map((c) => [c.slug, c]));

    expect(bySlug.stated).toMatchObject({
      arabicaPercent: 100,
      origin: "Бразилия",
      roast: "светло",
    });
    // 0 is a stated figure, not an absent one; it must not collapse into null.
    expect(bySlug.partly).toMatchObject({ arabicaPercent: 0, origin: null, roast: null });
    expect(bySlug.unstated).toMatchObject({ arabicaPercent: null, origin: null, roast: null });
  });

  it("ranks on them end to end, and says so", async () => {
    const system = getBrewingSystem("nespresso-original")!;
    const candidates = await list(system);
    const answers = parseWizardAnswers({ system: system.id, taste: "mild" });
    const result = scoreRecommendations(answers, candidates);

    expect(result.picks.map((entry) => entry.product.slug)).toEqual([
      "stated",
      "unstated",
      "partly",
    ]);
    expect(result.picks[0]?.reasons).toEqual(
      expect.arrayContaining([
        "изцяло арабика — арабиката е по-мека от робустата",
        "светло изпичане — по-малко горчиво от тъмното",
      ]),
    );
    expect(result.picks[1]?.reasons.join(" ")).not.toMatch(/арабика|изпичане/);
  });
});
