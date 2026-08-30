#!/usr/bin/env tsx
/**
 * Deterministic development seed.
 *
 * The normal way to get data is `pnpm sync:catalog`, which mirrors the real
 * source. This script exists for the cases where that is not possible or not
 * wanted:
 *
 *   - CI with no outbound network access,
 *   - working on the storefront without touching the source site at all,
 *   - reproducing a bug against a fixed, known catalog.
 *
 * It is additive and idempotent: it never deletes synchronised data, and every
 * row it writes is namespaced with a `seed-` source key so it is obvious where
 * it came from and easy to remove.
 */
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@catalog/db";
import {
  brands,
  categories,
  productCategories,
  products,
  sourceSites,
} from "@catalog/db/schema";

const SOURCE_KEY = "seed-dev";

const SEED_BRANDS = [
  { key: "northlight", name: "NORTHLIGHT", tagline: "Малки партиди от 2014 г." },
  { key: "harborside", name: "HARBORSIDE", tagline: null },
];

const SEED_CATEGORIES = [
  { key: "beans", name: "Кафе на зърна", parent: null },
  { key: "capsules", name: "Капсули", parent: null },
  { key: "capsules-espresso", name: "Еспресо капсули", parent: "capsules" },
];

const SEED_PRODUCTS = [
  { slug: "northlight-house-blend-1kg", name: "Кафе на зърна Northlight House Blend 1 кг", price: "24.00", old: null, brand: "northlight", category: "beans", weight: "1 кг", strength: "medium", decaf: "no", aromas: "no" },
  { slug: "northlight-decaf-500g", name: "Кафе на зърна Northlight Decaf 500 г", price: "18.50", old: null, brand: "northlight", category: "beans", weight: "500 г", strength: "weak", decaf: "yes", aromas: "no" },
  { slug: "harborside-dark-1kg", name: "Кафе на зърна Harborside Dark Roast 1 кг", price: "21.00", old: "26.00", brand: "harborside", category: "beans", weight: "1 кг", strength: "strong", decaf: "no", aromas: "no" },
  { slug: "harborside-espresso-caps-10", name: "Капсули Harborside Espresso 10 бр.", price: "4.20", old: null, brand: "harborside", category: "capsules-espresso", weight: "10 бр.", strength: "strong", decaf: "no", aromas: "no" },
  { slug: "northlight-hazelnut-caps-10", name: "Капсули Northlight Hazelnut 10 бр.", price: "4.60", old: null, brand: "northlight", category: "capsules-espresso", weight: "10 бр.", strength: "medium", decaf: "no", aromas: "yes" },
  // A product with no price at all: the real catalog has these, and the
  // storefront must render them without inventing a zero.
  { slug: "harborside-reserve-lot", name: "Кафе на зърна Harborside Reserve Lot", price: null, old: null, brand: "harborside", category: "beans", weight: null, strength: "medium", decaf: "no", aromas: "no" },
];

async function main(): Promise<void> {
  const { db, close } = createDatabase({ max: 1 });

  try {
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: SOURCE_KEY,
        name: "Development seed",
        baseUrl: "https://seed.invalid/",
        canonicalHost: "seed.invalid",
      })
      .onConflictDoUpdate({ target: sourceSites.key, set: { updatedAt: sql`now()` } })
      .returning({ id: sourceSites.id });
    if (!site) throw new Error("failed to create the seed source site");

    const brandIds = new Map<string, string>();
    for (const brand of SEED_BRANDS) {
      const [row] = await db
        .insert(brands)
        .values({
          sourceSiteId: site.id,
          sourceKey: brand.key,
          name: brand.name,
          slug: brand.key,
          tagline: brand.tagline,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [brands.sourceSiteId, brands.sourceKey],
          set: { name: brand.name, tagline: brand.tagline, status: "active" },
        })
        .returning({ id: brands.id });
      if (row) brandIds.set(brand.key, row.id);
    }

    const categoryIds = new Map<string, string>();
    for (const category of SEED_CATEGORIES) {
      const [row] = await db
        .insert(categories)
        .values({
          sourceSiteId: site.id,
          sourceKey: category.key,
          name: category.name,
          slug: category.key,
          status: "active",
        })
        .onConflictDoUpdate({
          target: [categories.sourceSiteId, categories.sourceKey],
          set: { name: category.name, status: "active" },
        })
        .returning({ id: categories.id });
      if (row) categoryIds.set(category.key, row.id);
    }
    // Parents are linked once every category has an id.
    for (const category of SEED_CATEGORIES) {
      if (!category.parent) continue;
      const childId = categoryIds.get(category.key);
      const parentId = categoryIds.get(category.parent);
      if (childId && parentId) {
        await db.update(categories).set({ parentId }).where(eq(categories.id, childId));
      }
    }

    for (const product of SEED_PRODUCTS) {
      const [row] = await db
        .insert(products)
        .values({
          sourceSiteId: site.id,
          sourceKey: `/${product.slug}/`,
          sourceUrl: `https://seed.invalid/${product.slug}/`,
          sourcePath: `/${product.slug}/`,
          name: product.name,
          slug: product.slug,
          currentPrice: product.price,
          oldPrice: product.old,
          currency: "EUR",
          availability: "in_stock",
          brandId: brandIds.get(product.brand) ?? null,
          descriptionText: `${product.name} — тестов продукт за разработка.`,
          weight: product.weight,
          attributes: { strength: product.strength, decaf: product.decaf, aromas: product.aromas },
          sourceData: { seeded: true },
          semanticHash: `seed-${product.slug}`.padEnd(64, "0").slice(0, 64),
          status: "active",
        })
        .onConflictDoUpdate({
          target: [products.sourceSiteId, products.sourceKey],
          set: {
            name: product.name,
            currentPrice: product.price,
            oldPrice: product.old,
            status: "active",
            lastSeenAt: sql`now()`,
          },
        })
        .returning({ id: products.id });

      if (!row) continue;
      const categoryId = categoryIds.get(product.category);
      if (categoryId) {
        await db
          .insert(productCategories)
          .values({ productId: row.id, categoryId, isPrimary: true })
          .onConflictDoNothing();
      }
    }

    console.log(
      `Seeded ${SEED_PRODUCTS.length} products, ${SEED_BRANDS.length} brands and ${SEED_CATEGORIES.length} categories ` +
        `under source key "${SOURCE_KEY}".`,
    );
    console.log("Note: seed products have no mirrored images, so cards show the placeholder.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
