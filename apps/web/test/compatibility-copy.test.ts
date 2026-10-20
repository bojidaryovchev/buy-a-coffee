import { describe, expect, it } from "vitest";
import { categoryCopy } from "../content/category-copy";
import { productCopy } from "../content/product-copy";

/*
 * A compatibility sentence in our copy is a promise that a box goes in a
 * machine. Two of them promised too much: „машини Dolce Gusto“ includes the
 * NEO machines, which take paper pods and no classic capsule, and „домашни
 * машини Nespresso“ includes Vertuo, which takes only Vertuo capsules
 * (research 08 §1.1, §1.5). Each must name the classic system.
 */

const sentences = (copy: { summary: string; body: readonly string[] }) => [
  copy.summary,
  ...copy.body,
];

const everyProductSentence = Object.entries(productCopy).flatMap(([slug, copy]) =>
  sentences(copy).map((text) => ({ slug, text })),
);

describe("product copy on compatibility", () => {
  it("never says Dolce Gusto machines without excluding NEO", () => {
    const loose = everyProductSentence.filter(
      ({ text }) =>
        /машин\S* Dolce Gusto/.test(text) &&
        !/класическите машини Dolce Gusto \(не NEO\)/.test(text),
    );
    expect(loose).toEqual([]);
  });

  it("never says home Nespresso machines, which includes Vertuo", () => {
    const loose = everyProductSentence.filter(({ text }) =>
      /домашн\S* машини Nespresso/.test(text),
    );
    expect(loose).toEqual([]);
  });

  it("names the Original system wherever it says Nespresso machines", () => {
    const loose = everyProductSentence.filter(
      ({ text }) =>
        /машин\S* Nespresso/.test(text) &&
        !/машини Nespresso \(Original\)|машини Nespresso Original/.test(text),
    );
    expect(loose).toEqual([]);
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
    expect(caffitaly).not.toMatch(/Tchibo Cafissimo и K-fee/);
    expect(caffitaly).toMatch(/K-fee[^.]*други системи/);
    expect(caffitaly).toMatch(/Tchibo да препоръчва собствените си капсули/);
  });

  it("does not say Lavazza has two systems", () => {
    for (const slug of ["lavazza-blue", "a-modo-mio"]) {
      expect(text(slug), slug).not.toMatch(/двете системи|коя от двете/);
    }
  });
});
