import { describe, expect, it } from "vitest";
import { claimNotes, plannedFrom, type NamedPromotion } from "@/lib/newsletter/claims";
import { checkDeliverability } from "@/lib/newsletter/deliverability";
import { blockProblems, emptySnapshot } from "@/lib/newsletter/product-blocks";
import { promotionLetter, promotionLine } from "@/lib/newsletter/templates";

/**
 * What a letter may claim about the shop's promotions (`claims.ts`), short of
 * a database: a promotion's letter over no product of the promotion, a
 * promotion changed since its letter was written, and a monthly letter's
 * named promotions — answered for only while the body still holds the line
 * written for them, or one of their reductions.
 */

const now = new Date("2026-11-05T10:00:00Z");
const promo = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Vending",
  label: "Есенни дни",
  percentOff: 20,
  startsAt: new Date("2026-10-31T22:00:00Z"),
  endsAt: new Date("2026-11-15T22:00:00Z"),
  stoppedAt: null,
};
const stops = (notes: ReturnType<typeof claimNotes>) =>
  notes.filter((note) => note.blocksSend).map((note) => note.id);

describe("a promotion's letter", () => {
  it("does not go claiming −20% over no products (the reviewer's scenario)", () => {
    const letter = promotionLetter({ now, promotion: promo, members: [] });
    expect(letter.subject).toBe("Есенни дни: −20% до 15 ноември");
    // Nothing in its blocks to object to …
    expect(blockProblems(letter.body, emptySnapshot(letter.subject, now))).toEqual([]);
    // … but the claim itself stops it, in the composer and at the send.
    expect(stops(claimNotes({ announced: promo, products: [], now }))).toEqual(["promotion-empty"]);
    const composer = checkDeliverability({
      subject: letter.subject,
      preheader: letter.preheader,
      body: letter.body,
      images: 0,
      files: 0,
      blocks: [],
      announced: promo,
      now,
    }).filter((note) => note.blocksSend);
    expect(composer.map((note) => note.title)).toEqual(["В писмото няма продукт от промоцията"]);
  });

  it("does not go over products the promotion does not price, whatever their own reduction", () => {
    const products = [{ title: "Друго", discountPercent: 25, promotionId: "другa" }];
    expect(stops(claimNotes({ announced: promo, products, now }))).toEqual(["promotion-empty"]);
    const ours = [{ title: "Наше", discountPercent: 20, promotionId: promo.id }];
    expect(stops(claimNotes({ announced: promo, products: ours, now }))).toEqual([]);
  });

  it("stops once the promotion is no longer the one it was written about, and says what changed", () => {
    const announcedPlan = plannedFrom(promo, null, ["a"]);
    const products = [{ title: "Наше", discountPercent: 20, promotionId: promo.id }];
    expect(stops(claimNotes({ announced: promo, announcedPlan, products, now }))).toEqual([]);

    const extended = {
      ...promo,
      label: "Зимни дни",
      percentOff: 15,
      endsAt: new Date("2026-11-30T22:00:00Z"),
    };
    const changed = claimNotes({ announced: extended, announcedPlan, products, now }).find(
      (note) => note.id === "promotion-changed",
    );
    expect(changed?.blocksSend).toBe(true);
    expect(changed?.detail).toContain("последният ѝ ден е 30 ноември, а не 15 ноември");
    expect(changed?.detail).toContain("за клиентите се казва „Зимни дни“, а не „Есенни дни“");
    expect(changed?.detail).toContain("намалението е −15%, а не −20%");
  });
});

describe("a monthly letter's named promotions", () => {
  const line = promotionLine({ ...promo, label: "Есенни дни" });
  const planned = plannedFrom(promo, line, ["minus-1"]);
  const ended = { ...promo, endsAt: new Date("2026-11-04T22:00:00Z") };
  const named = (current: typeof promo | null): NamedPromotion[] => [{ planned, current }];

  it("answers for one only while the body still holds its line or one of its reductions", () => {
    const withLine = `Здравейте,\n\n## Промоции\n\n${line}\n\n[[промоции: minus-1]]`;
    expect(stops(claimNotes({ named: named(ended), body: withLine, now }))).toEqual([
      "promotion-ended",
    ]);
    // Only its reduction left: still the letter's to answer for.
    expect(
      stops(claimNotes({ named: named(ended), body: "Текст\n\n[[промоции: minus-1]]", now })),
    ).toEqual(["promotion-ended"]);
    // The line and its products taken out, as the note says: cleared.
    expect(stops(claimNotes({ named: named(ended), body: "Здравейте,\n\nТекст.", now }))).toEqual(
      [],
    );
    // Gone altogether, but still named.
    expect(stops(claimNotes({ named: named(null), body: withLine, now }))).toEqual([
      "promotion-ended",
    ]);
  });

  it("stops over a line whose promotion changed, and not once the line is written again", () => {
    const later = { ...promo, endsAt: new Date("2026-11-22T22:00:00Z") };
    const body = `Здравейте,\n\n${line}\n\n[[промоции: minus-1]]`;
    const changed = claimNotes({ named: named(later), body, now }).find(
      (note) => note.id === "promotion-changed",
    );
    expect(changed).toMatchObject({ blocksSend: true });
    expect(changed?.detail).toContain(`Редът „${line}“ вече не е верен`);
    const rewritten = body.replace(line, promotionLine(later));
    expect(stops(claimNotes({ named: named(later), body: rewritten, now }))).toEqual([]);
    // Its reductions alone are checked on their own (each still reduced), not by the line.
    expect(
      stops(claimNotes({ named: named(later), body: "Текст\n\n[[промоции: minus-1]]", now })),
    ).toEqual([]);
  });
});
