import { describe, expect, it } from "vitest";
import {
  type ExistingEntity,
  type IncomingEntity,
  planEntities,
  summarisePlan,
} from "../src/catalog/taxonomy.ts";
import { type CatalogFixtureEntity, loadCatalogFixture } from "./helpers/catalogFixture.ts";

function row(
  sourceKey: string,
  sourceId: string | null,
  extra: Partial<ExistingEntity> = {},
): ExistingEntity {
  return {
    id: `row-${sourceKey}`,
    sourceKey,
    sourceId,
    slug: sourceKey,
    status: "active",
    ...extra,
  };
}

function listed(sourceKey: string, sourceId: string | null, name = sourceKey): IncomingEntity {
  return { sourceKey, sourceId, name };
}

describe("planEntities", () => {
  it("follows the capsule category the source renamed (source id 611)", () => {
    const plan = planEntities(
      [row("kapsuli", "611"), row("nespresso", "614")],
      [listed("kafe-kapsuli", "611", "Кафе капсули"), listed("nespresso", "614", "Nespresso")],
    );

    const [parent, child] = plan.assignments;
    expect(parent).toMatchObject({
      matchedBy: "source_id",
      renamedFrom: "kapsuli",
      // The storefront URL does not follow the source's rename.
      slug: "kapsuli",
    });
    expect(parent?.existing?.id).toBe("row-kapsuli");
    expect(child).toMatchObject({ matchedBy: "source_id", renamedFrom: null });
    expect(plan.absent).toEqual([]);
    expect(summarisePlan(plan, { markAbsent: true })).toMatchObject({
      created: [],
      renamed: [{ from: "kapsuli", to: "kafe-kapsuli", slug: "kapsuli" }],
      markedMissing: [],
    });
  });

  it("follows the brand the source respelled (source id 634)", () => {
    const plan = planEntities(
      [row("biancafe", "634", { slug: "biancaffe" })],
      [listed("biancaffe", "634", "BIANCAFFE")],
    );

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]).toMatchObject({
      matchedBy: "source_id",
      renamedFrom: "biancafe",
      slug: "biancaffe",
    });
    expect(plan.assignments[0]?.existing?.id).toBe("row-biancafe");
  });

  it("matches on the key when the listing carries no id", () => {
    // The HTML fallback knows slugs only.
    const plan = planEntities([row("lavazza", "605")], [listed("lavazza", null, "lavazza")]);
    expect(plan.assignments[0]).toMatchObject({ matchedBy: "source_key", renamedFrom: null });
  });

  it("matches on the key when the stored row has no id yet", () => {
    const plan = planEntities([row("lavazza", null)], [listed("lavazza", "605", "LAVAZZA")]);
    expect(plan.assignments[0]?.existing?.id).toBe("row-lavazza");
  });

  it("inserts what it has never seen, with a slug of its own", () => {
    const plan = planEntities([row("lavazza", "605")], [listed("kimbo", "637", "KIMBO")]);
    expect(plan.assignments[0]).toMatchObject({ existing: null, matchedBy: null, slug: "kimbo" });
  });

  it("never gives a new row a slug another row holds, listed or not", () => {
    // `capsules` belongs to a row this listing does not mention at all.
    const plan = planEntities(
      [row("old-capsules", "1", { slug: "capsules", status: "missing" })],
      [listed("capsules-a", "2", "Capsules"), listed("capsules-b", "3", "Capsules")],
    );
    expect(plan.assignments.map((assignment) => assignment.slug)).toEqual([
      "capsules-2",
      "capsules-3",
    ]);
  });

  it("does not let a rename change or suffix an existing slug", () => {
    // The new name would slugify to `kafe-kapsuli`, and to a slug another row
    // already has. Neither matters: an existing row keeps what it has.
    const plan = planEntities(
      [row("kapsuli", "611"), row("other", "700", { slug: "kafe-kapsuli" })],
      [listed("kafe-kapsuli", "611", "Кафе капсули"), listed("other", "700", "Other")],
    );
    expect(plan.assignments.map((assignment) => assignment.slug)).toEqual([
      "kapsuli",
      "kafe-kapsuli",
    ]);
  });

  it("reports live rows the listing does not account for", () => {
    const plan = planEntities(
      [row("lavazza", "605"), row("gone", "999"), row("hidden", "998", { status: "missing" })],
      [listed("lavazza", "605")],
    );
    // Already-hidden rows are not reported again.
    expect(plan.absent.map((entity) => entity.sourceKey)).toEqual(["gone"]);
    expect(summarisePlan(plan, { markAbsent: true }).markedMissing).toEqual(["gone"]);
    // An untrusted run reports nothing to hide.
    expect(summarisePlan(plan, { markAbsent: false }).markedMissing).toEqual([]);
  });

  it("brings a hidden row back when the source lists it again", () => {
    const plan = planEntities([row("illy", "754", { status: "missing" })], [listed("illy", "754")]);
    expect(plan.assignments[0]?.existing?.id).toBe("row-illy");
    expect(summarisePlan(plan, { markAbsent: true }).restored).toEqual(["illy"]);
  });

  it("collapses a slug the listing repeats", () => {
    const plan = planEntities([], [listed("lavazza", "605"), listed("lavazza", "605")]);
    expect(plan.assignments).toHaveLength(1);
  });

  it("keeps the key's holder when a rename would collide with another row", () => {
    // An earlier, unaware sync already inserted the twin under the new key.
    const plan = planEntities(
      [row("kapsuli", "611"), row("kafe-kapsuli", "611")],
      [listed("kafe-kapsuli", "611", "Кафе капсули")],
    );
    // Both carry the id; the one that already has the key is the exact match.
    expect(plan.assignments[0]?.existing?.id).toBe("row-kafe-kapsuli");
    expect(plan.absent.map((entity) => entity.sourceKey)).toEqual(["kapsuli"]);

    const blocked = planEntities(
      [row("kapsuli", "611"), row("kafe-kapsuli", null)],
      [listed("kafe-kapsuli", "611", "Кафе капсули")],
    );
    expect(blocked.conflicts).toEqual([
      {
        sourceId: "611",
        sourceKey: "kafe-kapsuli",
        passedOverSlug: "kapsuli",
        keptSlug: "kafe-kapsuli",
      },
    ]);
    expect(blocked.assignments[0]?.existing?.id).toBe("row-kafe-kapsuli");
  });
});

describe("taxonomy: the August to October rename", () => {
  const before = loadCatalogFixture("source-catalog-2026-08-21.json");
  const after = loadCatalogFixture("source-catalog-2026-10-08.json");

  const asRows = (entities: readonly CatalogFixtureEntity[]): ExistingEntity[] =>
    entities.map((entity) => ({
      id: `row-${entity.sourceId}`,
      sourceKey: entity.sourceKey,
      sourceId: entity.sourceId,
      slug: `slug-of-${entity.sourceKey}`,
      status: "active",
    }));

  /** The table as it stands once a plan is written. */
  const apply = (
    rows: ExistingEntity[],
    plan: ReturnType<typeof planEntities<CatalogFixtureEntity>>,
  ) => {
    const hidden = new Set(plan.absent.map((entity) => entity.id));
    const kept = rows.map((entity) => {
      const assignment = plan.assignments.find((a) => a.existing?.id === entity.id);
      if (!assignment)
        return { ...entity, status: hidden.has(entity.id) ? "missing" : entity.status };
      return { ...entity, sourceKey: assignment.incoming.sourceKey };
    });
    const inserted = plan.assignments
      .filter((assignment) => assignment.existing === null)
      .map((assignment) => ({
        id: `row-${assignment.incoming.sourceId}`,
        sourceKey: assignment.incoming.sourceKey,
        sourceId: assignment.incoming.sourceId,
        slug: assignment.slug,
        status: "active",
      }));
    return [...kept, ...inserted];
  };

  it("keeps exactly 8 categories, with the capsule parent on its own row", () => {
    const rows = asRows(before.categories);
    const plan = planEntities(rows, after.categories);
    const result = apply(rows, plan);

    expect(result).toHaveLength(8);
    expect(result.filter((entity) => entity.status === "active")).toHaveLength(8);
    expect(summarisePlan(plan, { markAbsent: true })).toEqual({
      created: [],
      renamed: [{ from: "kapsuli", to: "kafe-kapsuli", slug: "slug-of-kapsuli" }],
      markedMissing: [],
      restored: [],
      conflicts: [],
    });

    // Same row before and after: id and slug untouched, key renamed.
    const parentBefore = rows.find((entity) => entity.sourceKey === "kapsuli");
    const parentAfter = result.find((entity) => entity.sourceKey === "kafe-kapsuli");
    expect(parentAfter?.id).toBe(parentBefore?.id);
    expect(parentAfter?.slug).toBe("slug-of-kapsuli");
    expect(result.some((entity) => entity.sourceKey === "kapsuli")).toBe(false);

    // The five capsule systems still hang off it.
    const children = after.categories.filter((category) => category.parentKey === "kafe-kapsuli");
    expect(children.map((category) => category.sourceKey).sort()).toEqual([
      "a-modo-mio",
      "caffitaly",
      "dolce-gusto",
      "lavazza-blue",
      "nespresso",
    ]);
    expect(before.categories.filter((category) => category.parentKey === "kapsuli")).toHaveLength(
      5,
    );
  });

  it("grows 15 brands to 20 without duplicating the respelled one", () => {
    const rows = asRows(before.brands);
    const plan = planEntities(rows, after.brands);
    const result = apply(rows, plan);

    expect(rows).toHaveLength(15);
    expect(result).toHaveLength(20);
    expect(result.filter((entity) => entity.status === "active")).toHaveLength(20);
    expect(new Set(result.map((entity) => entity.sourceId)).size).toBe(20);

    const changes = summarisePlan(plan, { markAbsent: true });
    expect(changes.created.sort()).toEqual([
      "3-bourbons",
      "foodness",
      "kimbo",
      "lollocafe",
      "vandino",
    ]);
    expect(changes.renamed).toEqual([
      { from: "biancafe", to: "biancaffe", slug: "slug-of-biancafe" },
    ]);
    expect(changes.markedMissing).toEqual([]);

    expect(result.find((entity) => entity.sourceKey === "biancaffe")?.id).toBe("row-634");
    expect(result.filter((entity) => entity.sourceId === "634")).toHaveLength(1);
  });

  it("is a no-op the second time", () => {
    for (const kind of ["brands", "categories"] as const) {
      const rows = asRows(before[kind]);
      const settled = apply(rows, planEntities(rows, after[kind])) as ExistingEntity[];
      const second = summarisePlan(planEntities(settled, after[kind]), { markAbsent: true });
      expect(second).toEqual({
        created: [],
        renamed: [],
        markedMissing: [],
        restored: [],
        conflicts: [],
      });
    }
  });
});
