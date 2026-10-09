import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@catalog/db";
import { products, sourceSites } from "@catalog/db/schema";
import { packServings, pricePerServing } from "@catalog/shared";
import { applyPackSizes, planPackSizes } from "../scripts/catalog-pack-size-lib";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * `catalog:pack-size` against a real database: the plan it reads from stored
 * rows, the write, and the second run that must find nothing to do.
 *
 * The rule is unit-tested where it lives (`packages/shared/test/pack-size.test.ts`)
 * and the sync's use of it in `packages/scraper-core/test/sync.integration.test.ts`.
 * This is the part only a database can show: where a stored row keeps the
 * supplier's pack field, which columns are written, and what is left alone.
 */

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

/** The tin as the sync stored it before the rule existed: 100 in every column. */
const TIN = {
  sourceKey: "/illy-decaffeinato-18/#100pc",
  name: "Дозети Illy Decaffeinato 18бр.",
  slug: "illy-decaffeinato-kafe-dozi-18-br",
  currentPrice: "9.20",
  weight: "100 бр.",
  weightValue: "100",
  weightUnit: "pc",
  servings: "100",
  servingsEstimated: false,
  sourceData: {
    // The listing record, spread in by the sync, pack field and all.
    h1: "Дозети Illy Decaffeinato 18бр.",
    weight: "100 бр.",
    price: "€9.20",
    brandKey: "illy",
    categoryKeys: ["kafe-dozi"],
    weightCanonical: "100pc",
    identityStrategy: "path_and_size",
  },
} as const;

suite("catalog:pack-size (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("catalog_pack_size"));
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table source_sites restart identity cascade`);
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "pack-size-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  async function add(input: {
    sourceKey: string;
    name: string;
    slug: string;
    currentPrice?: string;
    weight: string | null;
    weightValue: string | null;
    weightUnit: string | null;
    servings: string | null;
    servingsEstimated: boolean | null;
    sourceData: Record<string, unknown>;
    status?: "active" | "removed";
  }): Promise<string> {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceUrl: `https://example.test${input.sourceKey}`,
        sourcePath: input.sourceKey.split("#")[0] as string,
        semanticHash: `hash-of-${input.sourceKey}`,
        ...input,
      })
      .returning({ id: products.id });
    return row!.id;
  }

  const read = async (id: string) => {
    const [row] = await db.select().from(products).where(eq(products.id, id));
    return { ...row!, sourceData: row!.sourceData as Record<string, unknown> };
  };

  const agreeing = () =>
    add({
      sourceKey: "/lavazza-super-crema/#1000g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
      currentPrice: "30.00",
      weight: "1 кг.",
      weightValue: "1000",
      weightUnit: "g",
      servings: "142.8571",
      servingsEstimated: true,
      sourceData: { weight: "1 кг.", weightCanonical: "1000g" },
    });

  it("plans the correction and writes nothing", async () => {
    const tin = await add(TIN);
    await agreeing();
    const before = await read(tin);

    const plan = await planPackSizes(db);

    expect(plan.products).toBe(2);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      id: tin,
      sourceKey: TIN.sourceKey,
      name: TIN.name,
      packField: "100 бр.",
      stored: { weight: "100 бр.", weightUnit: "pc", weightCanonical: "100pc", conflict: null },
      planned: {
        weight: "18 бр.",
        weightValue: "18",
        weightUnit: "pc",
        servings: "18",
        servingsEstimated: false,
        weightCanonical: "18pc",
        conflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
      pricePerCup: { stored: "0.0920", planned: "0.5111" },
    });
    expect(plan.conflicts).toEqual([
      {
        sourceKey: TIN.sourceKey,
        name: TIN.name,
        conflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
    ]);
    expect(await read(tin)).toEqual(before);
  });

  it("applies the rule to the pack columns and to nothing else", async () => {
    const tin = await add(TIN);
    const other = await agreeing();
    const [tinBefore, otherBefore] = [await read(tin), await read(other)];

    expect(await applyPackSizes(db, await planPackSizes(db))).toBe(1);

    const after = await read(tin);
    expect(after).toMatchObject({
      weight: "18 бр.",
      weightValue: "18.0000",
      weightUnit: "pc",
      servings: "18.0000",
      servingsEstimated: false,
    });
    expect(
      pricePerServing(after.currentPrice, packServings(after.weightValue, after.weightUnit)),
    ).toBe("0.5111");
    expect(after.sourceData).toEqual({
      ...TIN.sourceData,
      // The supplier's statement stays, verbatim, beside what was decided.
      weight: "100 бр.",
      packField: "100 бр.",
      weightCanonical: "18pc",
      packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
    });
    // Identity, address, the sync's hash and its clock are not this script's.
    expect(after).toMatchObject({
      sourceKey: tinBefore.sourceKey,
      sourceVariantKey: tinBefore.sourceVariantKey,
      slug: tinBefore.slug,
      previousSlugs: tinBefore.previousSlugs,
      semanticHash: tinBefore.semanticHash,
      lastChangedAt: tinBefore.lastChangedAt,
      currentPrice: "9.20",
    });
    // A product whose two sizes agree is not touched at all.
    expect(await read(other)).toEqual(otherBefore);
  });

  it("finds nothing to do on a second run, and still names the conflict", async () => {
    const tin = await add(TIN);
    await applyPackSizes(db, await planPackSizes(db));
    const settled = await read(tin);

    const again = await planPackSizes(db);
    expect(again.changes).toEqual([]);
    expect(again.conflicts).toHaveLength(1);
    expect(await applyPackSizes(db, again)).toBe(0);
    expect(await read(tin)).toEqual(settled);
  });

  it("is settled twice over for a row that never held the listing record", async () => {
    // A seeded row, or one read from the HTML fallback: `source_data` has no
    // pack field, so the column is the only place the supplier's is kept. Once
    // corrected the column holds the decided size, and the second run must not
    // mistake that for the supplier's statement and withdraw the conflict.
    const tin = await add({ ...TIN, sourceData: { weightCanonical: "100pc" } });

    expect(await applyPackSizes(db, await planPackSizes(db))).toBe(1);
    const settled = await read(tin);
    expect(settled).toMatchObject({ weight: "18 бр.", weightValue: "18.0000" });
    expect(settled.sourceData).toEqual({
      weightCanonical: "18pc",
      packField: "100 бр.",
      packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
    });

    const again = await planPackSizes(db);
    expect(again.changes).toEqual([]);
    expect(again.conflicts).toHaveLength(1);
  });

  it("leaves a row the sync has already written by the rule", async () => {
    await add({
      ...TIN,
      weight: "18 бр.",
      weightValue: "18",
      servings: "18",
      sourceData: {
        ...TIN.sourceData,
        weightCanonical: "18pc",
        packField: "100 бр.",
        packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
    });
    const plan = await planPackSizes(db);
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
  });

  it("corrects a pack sold by weight, and a product that has been removed", async () => {
    const beans = await add({
      sourceKey: "/lavazza-super-crema/#500g",
      name: "Кафе на зърна Lavazza Super Crema 1кг.",
      slug: "lavazza-super-crema-kafe-na-zarna-1-kg",
      currentPrice: "30.00",
      weight: "0.500кг.",
      weightValue: "500",
      weightUnit: "g",
      servings: "71.4286",
      servingsEstimated: true,
      sourceData: { weight: "0.500кг.", weightCanonical: "500g" },
      status: "removed",
    });

    const plan = await planPackSizes(db, { sourceSiteId: siteId });
    expect(plan.changes[0]?.pricePerCup).toEqual({ stored: "0.4200", planned: "0.2100" });
    await applyPackSizes(db, plan);

    expect(await read(beans)).toMatchObject({
      status: "removed",
      weight: "1 кг",
      weightValue: "1000.0000",
      weightUnit: "g",
      servings: "142.8571",
      servingsEstimated: true,
    });
    expect((await planPackSizes(db)).changes).toEqual([]);
  });

  it("clears a recorded conflict the supplier has since corrected", async () => {
    // The sync writes the corrected pack field on its next run; until then a
    // row can hold a conflict its own pack field no longer supports.
    const tin = await add({
      ...TIN,
      weight: "18 бр.",
      weightValue: "18",
      servings: "18",
      sourceData: {
        weightCanonical: "18pc",
        packField: "18 бр.",
        packSizeConflict: { inName: "18 бр.", inPackField: "100 бр." },
      },
    });
    await applyPackSizes(db, await planPackSizes(db));
    expect((await read(tin)).sourceData).toEqual({
      weightCanonical: "18pc",
      packField: "18 бр.",
      packSizeConflict: null,
    });
  });
});
