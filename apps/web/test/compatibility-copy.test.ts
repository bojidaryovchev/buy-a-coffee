import { describe, expect, it } from "vitest";
import { COMPATIBILITY_WORDING, compatibilityProblems } from "@catalog/shared/compatibility-copy";
import { categoryCopy } from "../content/category-copy";
import { productCopy } from "../content/product-copy";
import { generatedSentenceFor, loadReferenceSnapshot } from "../scripts/copy-audit";

/*
 * A compatibility sentence in our copy is a promise that a box goes in a
 * machine. Some of ours promised too much: „машини Dolce Gusto“ includes the
 * NEO machines, which take paper pods and no classic capsule; „домашни машини
 * Nespresso“ includes Vertuo, which takes only Vertuo capsules; and six
 * Caffitaly entries said the capsules go in a Tchibo Cafissimo without
 * Tchibo's word that only its own capsules should (research 08 §1.1, §1.3,
 * §1.5).
 *
 * The rules are not written here. They live in `@catalog/shared`
 * (`compatibility-copy.ts`), where the catalog copywriter's audit applies the
 * very same ones to machine-written copy before it may be published, so a
 * sentence this file may not carry cannot reach a product page the other way
 * either. Their own tests hold them to the corrected sentences and to the
 * wording they replaced.
 */

describe("product copy on compatibility", () => {
  it("makes no compatibility promise the machine makers contradict", () => {
    const broken = Object.entries(productCopy).flatMap(([slug, copy]) =>
      compatibilityProblems([copy.summary, ...copy.body]).map(({ rule, sentence }) => ({
        slug,
        rule,
        sentence,
      })),
    );
    expect(broken).toEqual([]);
  });

  it("states the Dolce Gusto and Nespresso fit in the corrected words", () => {
    const text = Object.values(productCopy)
      .flatMap((copy) => [copy.summary, ...copy.body])
      .join(" ");
    // The words the rules steer towards are the ones the file actually uses.
    expect(text).toContain(COMPATIBILITY_WORDING.dolceGusto);
    expect(text).toContain(COMPATIBILITY_WORDING.nespresso);
  });

  it("generates no broken promise for a product without copy of its own", async () => {
    // The third way a description reaches a page: the sentence built from facts.
    const snapshot = await loadReferenceSnapshot();
    expect(snapshot?.products.length ?? 0).toBeGreaterThanOrEqual(100);
    const broken = (snapshot?.products ?? []).flatMap((product) => {
      const sentence = generatedSentenceFor(product, snapshot?.brandNames);
      return sentence && compatibilityProblems(sentence).length > 0 ? [sentence] : [];
    });
    expect(broken).toEqual([]);
  });
});

describe("category copy on compatibility", () => {
  const text = (slug: string) => {
    const copy = categoryCopy[slug];
    expect(copy, slug).toBeDefined();
    return [copy!.description, ...copy!.paragraphs].join(" ");
  };

  it("tells a Dolce Gusto NEO owner the classic capsule does not fit", () => {
    expect(text("dolce-gusto")).toMatch(/NEO/);
  });

  it("states the Caffitaly format without K-fee and with Tchibo's caveat", () => {
    const caffitaly = text("caffitaly");
    expect(compatibilityProblems(caffitaly)).toEqual([]);
    expect(caffitaly).toMatch(/K-fee[^.]*други системи/);
    expect(caffitaly).toMatch(
      /Tchibo да посочва, че в тях трябва да се използват само нейните капсули/,
    );
  });

  it("does not say Lavazza has two systems", () => {
    for (const slug of ["lavazza-blue", "a-modo-mio"]) {
      expect(text(slug), slug).not.toMatch(/двете системи|коя от двете/);
    }
  });
});
