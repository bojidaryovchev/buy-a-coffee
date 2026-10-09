import { describe, expect, it } from "vitest";
import { decidePackSize, packQuantityLabel } from "../src/pack-size.ts";
import { productName, type ProductNameInput } from "../src/product-name.ts";
import { planProductSlugs } from "../src/product-slug.ts";
import { RESERVED_PRODUCT_SLUGS, productNameOverrides } from "../src/storefront-data.ts";
import fixture from "./fixtures/product-names.json" with { type: "json" };

/**
 * Every product the catalog holds, as the sync stored it, beside the name and
 * the slug this shop gives it. Each expectation was read by a person.
 *
 * The fixture is the guard the parser needs: when the supplier renames a
 * product in a way the parser does not understand, refreshing the fixture
 * shows the bad name in a diff, and until someone reads it this test fails
 * instead of the name shipping.
 */
interface FixtureRecord extends ProductNameInput {
  readonly sourceKey: string;
  readonly wave: string;
  readonly formerSlug: string;
  readonly expected: {
    readonly brand: string | null;
    readonly line: string;
    readonly detail: string | null;
    readonly full: string;
    readonly slug: string;
  };
}

const records = fixture as readonly FixtureRecord[];

describe("productName over the whole catalog", () => {
  it("covers all 187 products", () => {
    expect(records).toHaveLength(187);
    expect(new Set(records.map((record) => record.sourceKey)).size).toBe(187);
  });

  it.each(records.map((record) => [record.sourceName, record.sourceKey, record] as const))(
    "%s (%s)",
    (_name, _key, record) => {
      const name = productName(record);
      expect({
        brand: name.brand,
        line: name.line,
        detail: name.detail,
        full: name.full,
      }).toEqual({
        brand: record.expected.brand,
        line: record.expected.line,
        detail: record.expected.detail,
        full: record.expected.full,
      });
    },
  );

  it("gives every product a different name", () => {
    const names = records.map((record) => productName(record).full);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never prints the supplier's shorthand", () => {
    for (const record of records) {
      const { full } = productName(record);
      expect(full).not.toMatch(/(?:^|\s)DG(?:\s|$)/);
      expect(full).not.toMatch(/дозети/iu);
      expect(full).not.toMatch(/\d(?:бр|кг)/u);
    }
  });

  it("plans the slug each product is expected to have", () => {
    const plan = planProductSlugs(
      records.map((record) => ({
        sourceKey: record.sourceKey,
        base: productName(record).slugBase,
      })),
      RESERVED_PRODUCT_SLUGS,
    );
    for (const record of records) {
      expect(plan.get(record.sourceKey), record.sourceName).toBe(record.expected.slug);
    }
  });

  it("writes every slug as <brand>-<line>-<format>-<qty>", () => {
    for (const record of records) {
      const name = productName(record);
      const { slug } = record.expected;
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      // No discriminator: every real product is alone on its base today.
      expect(slug).toBe(name.slugBase);
      expect(slug.endsWith(`-${name.format?.slug}-${name.quantity?.slug}`), slug).toBe(true);
      expect(slug).not.toMatch(/(?:^|-)dg(?:-|$)/);
      expect(slug).not.toBe(record.formerSlug);
      expect(RESERVED_PRODUCT_SLUGS.has(slug)).toBe(false);
    }
    expect(new Set(records.map((record) => record.expected.slug)).size).toBe(records.length);
  });

  /*
   * No list of known conflicts gates this suite, on purpose. There used to be
   * one, and a product that started to disagree failed here until someone
   * added it. But a conflict is the supplier's mistake and arrives with a
   * sync, which no test runs before: a list in a test cannot stop it being
   * published, it can only fail the next unrelated build. So what is tested is
   * the rule — every conflict, on whichever product, publishes the name's
   * size — and the conflicts themselves are data: the sync stores both sizes
   * on the product, and the admin's sync page shows them to the owner
   * (`pack-size.ts`).
   */
  it("gives every product a size: the name's wherever the pack field states another", () => {
    for (const record of records) {
      const name = productName(record);
      // Every product states its size in its name, and has one to show.
      expect(name.quantity, record.sourceName).not.toBeNull();
      expect(name.quantity?.label).toBe(
        name.packConflict
          ? name.packConflict.inName
          : packQuantityLabel(record.packValue, record.packUnit),
      );
      expect(name.packConflict).toEqual(
        decidePackSize(record.sourceName, { value: record.packValue, unit: record.packUnit })
          .conflict,
      );
    }
  });

  it("finds the one conflict in the catalog as the supplier published it", () => {
    // An 18-pod tin, priced as one (9,20 €, as the 18-pod illy Classico),
    // recorded with a pack size of 100. This describes a frozen fixture: it
    // cannot start failing because the supplier makes another mistake.
    const conflicts = records.flatMap((record) => {
      const { packConflict } = productName(record);
      return packConflict ? [[record.sourceKey, packConflict] as const] : [];
    });
    expect(conflicts).toEqual([
      ["/illy-decaffeinato-18/#100pc", { inName: "18 бр.", inPackField: "100 бр." }],
    ]);
  });

  it("publishes the size in the name where the two disagree", () => {
    const tin = records.find((record) => record.sourceKey === "/illy-decaffeinato-18/#100pc");
    expect(productName(tin!)).toMatchObject({
      quantity: { label: "18 бр.", slug: "18-br" },
      detail: "Кафе дози ESE, 18 бр.",
      full: "illy Decaffeinato — кафе дози ESE, 18 бр.",
      slugBase: "illy-decaffeinato-kafe-dozi-18-br",
    });
  });

  it("has a product behind every override", () => {
    const keys = new Set(records.map((record) => record.sourceKey));
    for (const key of Object.keys(productNameOverrides)) {
      expect(keys.has(key), `override for ${key} matches no product`).toBe(true);
    }
  });
});

describe("the two products the supplier gives one name", () => {
  const pair = records.filter(
    (record) => record.sourceName === "Кафе на зърна Lavazza Crema E Aroma 1кг.",
  );

  it("are two products, told apart by name and by slug", () => {
    expect(pair.map((record) => record.sourceKey).sort()).toEqual([
      "/lavazza-crema-aroma-1/#1000g",
      "/lavazza-crema-aroma-expert-1/#1000g",
    ]);
    const names = Object.fromEntries(
      pair.map((record) => [record.sourceKey, productName(record)] as const),
    );
    expect(names["/lavazza-crema-aroma-1/#1000g"]?.title).toBe("Lavazza Crema e Aroma");
    expect(names["/lavazza-crema-aroma-expert-1/#1000g"]?.title).toBe(
      "Lavazza Crema e Aroma Expert",
    );
    expect(names["/lavazza-crema-aroma-1/#1000g"]?.slugBase).toBe(
      "lavazza-crema-e-aroma-kafe-na-zarna-1-kg",
    );
    expect(names["/lavazza-crema-aroma-expert-1/#1000g"]?.slugBase).toBe(
      "lavazza-crema-e-aroma-expert-kafe-na-zarna-1-kg",
    );
  });

  it("keeps the override when the supplier moves the product", () => {
    const expert = pair.find((record) => record.sourceKey.includes("expert"));
    const moved = productName({
      ...expert!,
      sourceKey: "/lavazza-expert-crema-aroma/#1000g",
      previousSourceKeys: [expert!.sourceKey],
    });
    expect(moved.title).toBe("Lavazza Crema e Aroma Expert");
  });
});

describe("productName", () => {
  const base: ProductNameInput = {
    sourceName: "Капсули DG Rema Caffè Cookies 16 бр.",
    sourceKey: "/dg-rema-caffe-cookies-16/#16pc",
    brand: { sourceKey: "rema-caffe", name: "REMA CAFFE" },
    categoryKeys: ["dolce-gusto"],
    packValue: "16.0000",
    packUnit: "pc",
  };

  it("returns the parts, the heading, the line under it and the slug", () => {
    expect(productName(base)).toEqual({
      brand: "Rema Caffè",
      line: "Cookies",
      format: {
        id: "dolce-gusto",
        label: "Капсули за Dolce Gusto",
        listingLabel: "Капсули за Dolce Gusto",
        slug: "kapsuli-dolce-gusto",
      },
      quantity: { label: "16 бр.", slug: "16-br" },
      packConflict: null,
      title: "Rema Caffè Cookies",
      detail: "Капсули за Dolce Gusto, 16 бр.",
      full: "Rema Caffè Cookies — капсули за Dolce Gusto, 16 бр.",
      slugBase: "rema-caffe-cookies-kapsuli-dolce-gusto-16-br",
    });
  });

  it("matches the examples in the URL plan", () => {
    expect(
      productName({
        sourceName: "Кафе на зърна Lavazza Super Crema 1кг.",
        brand: { sourceKey: "lavazza", name: "LAVAZZA" },
        categoryKeys: ["kafe-na-zyrna"],
        packValue: "1000",
        packUnit: "g",
      }).slugBase,
    ).toBe("lavazza-super-crema-kafe-na-zarna-1-kg");
    expect(
      productName({
        sourceName: "Капсули DG Borbone Crema Classica 16 бр.",
        brand: { sourceKey: "borbone", name: "BORBONE" },
        categoryKeys: ["dolce-gusto"],
        packValue: "16",
        packUnit: "pc",
      }).slugBase,
    ).toBe("borbone-crema-classica-kapsuli-dolce-gusto-16-br");
    expect(
      productName({
        sourceName: "Дозети Lavazza Gran Espresso 150бр.",
        brand: { sourceKey: "lavazza", name: "LAVAZZA" },
        categoryKeys: ["kafe-dozi"],
        packValue: "150",
        packUnit: "pc",
      }).slugBase,
    ).toBe("lavazza-gran-espresso-kafe-dozi-150-br");
  });

  it("takes the format from the category, never from the name", () => {
    // Filed under Nespresso though the name says DG: the category decides,
    // and a token that is not this format's own stays in the line.
    const name = productName({ ...base, categoryKeys: ["nespresso"] });
    expect(name.format?.label).toBe("Капсули за Nespresso");
    expect(name.line).toBe("DG Rema Caffè Cookies");
  });

  it("does not call a system owner's capsule a capsule 'for' its own system", () => {
    const blue = {
      sourceName: "Капсули Blue Lavazza Decaffeinato 100 бр.",
      categoryKeys: ["lavazza-blue"],
      packValue: "100",
      packUnit: "pc",
    };
    expect(productName({ ...blue, brand: { sourceKey: "lavazza", name: "LAVAZZA" } }).detail).toBe(
      "Капсули Lavazza Blue, 100 бр.",
    );
    expect(
      productName({
        ...blue,
        sourceName: "Капсули Blue Lollo caffe Oro 100бр.",
        brand: { sourceKey: "lollocafe", name: "LOLLOCAFE" },
      }).detail,
    ).toBe("Капсули за Lavazza Blue, 100 бр.");
    expect(
      productName({
        sourceName: "Капсули Caffitaly Espresso Cremoso 10 бр.",
        brand: { sourceKey: "caffitaly", name: "CAFFITALY" },
        categoryKeys: ["caffitaly"],
        packValue: "10",
        packUnit: "pc",
      }),
    ).toMatchObject({ title: "Caffitaly Espresso Cremoso", detail: "Капсули Caffitaly, 10 бр." });
  });

  it("never presents a third party's capsule as the system owner's", () => {
    for (const record of records) {
      const name = productName(record);
      if (name.format?.id === "nespresso" || name.format?.id === "dolce-gusto") {
        expect(name.format.label).toMatch(/^Капсули за /u);
      }
      if (name.format?.id === "lavazza-blue" || name.format?.id === "a-modo-mio") {
        expect(name.format.label.startsWith("Капсули за ")).toBe(
          record.brand?.sourceKey !== "lavazza",
        );
      }
    }
  });

  it("removes a system token only from a product of that system", () => {
    expect(
      productName({
        sourceName: "Кафе на зърна Amann Blue Mountain 0.250кг.",
        brand: { sourceKey: "amann", name: "AMANN" },
        categoryKeys: ["kafe-na-zyrna"],
        packValue: "250",
        packUnit: "g",
      }).title,
    ).toBe("Amann Blue Mountain");
  });

  it("drops a Cyrillic gloss and lower-cases a connective", () => {
    expect(
      productName({ ...base, sourceName: "Дозети Rema Caffe Caramel карамел 100бр." }).line,
    ).toBe("Caramel");
    expect(
      productName({
        ...base,
        sourceName: "Кафе на зърна Lavazza Crema E Gusto 1кг.",
        brand: { sourceKey: "lavazza", name: "LAVAZZA" },
      }).line,
    ).toBe("Crema e Gusto");
  });

  it("keeps a range the brand sells under another name in the line", () => {
    expect(
      productName({
        sourceName: "Дозети Adore Espresso Bar 100бр.",
        brand: { sourceKey: "bianchi", name: "BIANCHI" },
        categoryKeys: ["kafe-dozi"],
        packValue: "100",
        packUnit: "pc",
      }).title,
    ).toBe("Bianchi Adore Espresso Bar");
  });

  it("recognises a known brand at the front of a product with no brand row", () => {
    const name = productName({
      sourceName: "Кафе на зърна Tezzoro Espresso Classic 1кг.",
      brand: null,
      categoryKeys: ["kafe-na-zyrna"],
      packValue: "1000",
      packUnit: "g",
    });
    expect(name).toMatchObject({ brand: "Tezzoro", line: "Espresso Classic" });
  });

  it("title-cases a brand nobody has written an entry for", () => {
    const name = productName({
      sourceName: "Кафе на зърна NEW ROAST Scuro 1кг.",
      brand: { sourceKey: "new-roast", name: "NEW ROAST" },
      categoryKeys: ["kafe-na-zyrna"],
      packValue: "1000",
      packUnit: "g",
    });
    expect(name.title).toBe("New Roast Scuro");
    expect(name.slugBase).toBe("new-roast-scuro-kafe-na-zarna-1-kg");
  });

  it("says only what it knows when the category or the size is missing", () => {
    expect(
      productName({ ...base, sourceName: "Rema Caffè Cookies 16 бр.", categoryKeys: [] }),
    ).toMatchObject({
      format: null,
      detail: "16 бр.",
      full: "Rema Caffè Cookies, 16 бр.",
      slugBase: "rema-caffe-cookies-16-br",
    });
    expect(
      productName({
        ...base,
        sourceName: "Капсули DG Rema Caffè Cookies",
        packValue: null,
        packUnit: null,
      }),
    ).toMatchObject({
      quantity: null,
      detail: "Капсули за Dolce Gusto",
      full: "Rema Caffè Cookies — капсули за Dolce Gusto",
      slugBase: "rema-caffe-cookies-kapsuli-dolce-gusto",
    });
  });

  it("calls a capsule filed under two systems a capsule, and nothing more", () => {
    expect(productName({ ...base, categoryKeys: ["dolce-gusto", "nespresso"] }).format?.label).toBe(
      "Кафе капсули",
    );
    expect(productName({ ...base, categoryKeys: ["kafe-kapsuli"] }).format?.slug).toBe(
      "kafe-kapsuli",
    );
    expect(productName({ ...base, categoryKeys: ["dolce-gusto", "kafe-dozi"] }).format).toBeNull();
  });

  it("falls back to the supplier's name rather than to nothing", () => {
    const name = productName({ sourceName: "  Капсули  16 бр. ", categoryKeys: [] });
    expect(name.title).toBe("Капсули 16 бр.");
    expect(name.slugBase).toMatch(/^kapsuli-16-br/);
    expect(productName({ sourceName: "!!!" }).slugBase).toBe("product");
  });

  it("never cuts the format or the size off a long name", () => {
    const name = productName({
      ...base,
      sourceName: `Капсули DG Rema Caffè ${"Molto Lungo ".repeat(12)}16 бр.`,
    });
    expect(name.slugBase.endsWith("-kapsuli-dolce-gusto-16-br")).toBe(true);
    expect(name.slugBase.length).toBeLessThanOrEqual(72 + "-kapsuli-dolce-gusto-16-br".length);
  });

  it("uses the size in the name when the pack field contradicts it, or is empty", () => {
    const beans = {
      sourceName: "Кафе на зърна Lavazza Super Crema 1кг.",
      brand: { sourceKey: "lavazza", name: "LAVAZZA" },
      categoryKeys: ["kafe-na-zyrna"],
    };
    expect(productName({ ...beans, packValue: "500", packUnit: "g" })).toMatchObject({
      quantity: { label: "1 кг", slug: "1-kg" },
      packConflict: { inName: "1 кг", inPackField: "500 г" },
      slugBase: "lavazza-super-crema-kafe-na-zarna-1-kg",
    });
    expect(productName({ ...beans, packValue: null, packUnit: null })).toMatchObject({
      quantity: { label: "1 кг", slug: "1-kg" },
      packConflict: null,
    });
    // "0.500кг." and 500 g are one size written two ways, not a conflict.
    expect(
      productName({
        ...beans,
        sourceName: "Кафе на зърна Lavazza Super Crema 0.500кг.",
        packValue: "500.0000",
        packUnit: "g",
      }),
    ).toMatchObject({ quantity: { label: "500 г" }, packConflict: null });
  });

  it("is deterministic", () => {
    expect(productName(base)).toEqual(productName({ ...base }));
  });
});

describe("packQuantityLabel", () => {
  it("writes weights, volumes and counts the way the shop does", () => {
    expect(packQuantityLabel("1000.0000", "g")).toBe("1 кг");
    expect(packQuantityLabel("500", "g")).toBe("500 г");
    expect(packQuantityLabel(1500, "g")).toBe("1,5 кг");
    expect(packQuantityLabel("250", "ml")).toBe("250 мл");
    expect(packQuantityLabel("16.0000", "pc")).toBe("16 бр.");
  });

  it("says nothing for a size it cannot state", () => {
    expect(packQuantityLabel(null, "g")).toBeNull();
    expect(packQuantityLabel("0", "g")).toBeNull();
    expect(packQuantityLabel("7.5", "pc")).toBeNull();
    expect(packQuantityLabel("10", "box")).toBeNull();
  });
});
