/**
 * Which flavoured products hold no coffee, and the evidence for each.
 *
 * The flavoured listing (`/bg/aromatizirano-kafe`) is headed „Ароматизирано
 * кафе“, and it lists what the record flags as flavoured (`aromas: yes`). The
 * flag is also on drinks with no coffee in them. On 20 October 2026 the owner
 * decided to keep those products off the page **without changing their flags**:
 * the flags are the supplier's, the listings' „Ароматизирано“ filter reads
 * them, and a matcha latte is flavoured. Two things keep them off
 * (`src/lib/catalog/no-coffee.ts`):
 *
 *  - `NO_COFFEE`, below: products that hold no coffee, each with what says so;
 *  - a guard for the products added after it: one whose stored description,
 *    the supplier's or ours, says that it holds no coffee („без кафе“, „не
 *    съдържа кафе“, „вместо кафе“…). „Без кофеин“ is not one of them: decaf is
 *    coffee.
 *
 * **Keyed by the storefront slug**, as `product-copy.ts` is and for its
 * reason. The slug is ours: allocated the first time the sync sees a product
 * and never changed by it. A source key is built from the supplier's URL and
 * follows the supplier's renames, so an entry keyed by one would be orphaned,
 * silently, by the first rename. A slug changes only when we run
 * `catalog:reslug`, which keeps the old one in `previous_slugs`; the match
 * reads those too, so not even that drops an entry.
 *
 * **The audit.** On 20 October 2026 every product then flagged flavoured —
 * twenty — was read: the supplier's description as the snapshot holds it, our
 * own copy (`product-copy.ts`, the same words the override columns hold) and
 * the recorded characteristics (none of the twenty has any). Three hold no
 * coffee (`NO_COFFEE`); seventeen do (`FLAVOURED_COFFEE`), with the words that
 * say so. Nothing was assumed from a name: a cappuccino, a chocolate and a
 * ginseng blend are coffee because their descriptions say coffee.
 * `test/landings.db.test.ts` fails on a flagged product in neither list, so
 * the next one is read before anyone relies on the page.
 */

export interface CoffeeEvidence {
  /** The storefront slug. */
  readonly slug: string;
  /** What says so, quoted from the supplier's description or our own copy. */
  readonly evidence: string;
}

/** Flagged flavoured, and no coffee in them. */
export const NO_COFFEE: readonly CoffeeEvidence[] = [
  {
    slug: "rema-caffe-matcha-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „Matcha Latte … от внимателно подбран натурален зелен чай и нежна млечна пяна“, no coffee named. Our copy: „натурален зелен чай с нежна млечна пяна вместо кафе“; „основата е натурален зелен чай мача, а не еспресо“.",
  },
  {
    slug: "foodness-mermaid-latte-kapsuli-dolce-gusto-10-br",
    evidence:
      "Supplier: „цветна, безкофеинова напитка“. Our copy: „без кафе и без кофеин“; „Съставът не включва кафе. Напитката е от растителни екстракти, кокосово мляко и драконов плод“.",
  },
  {
    slug: "rema-caffe-creme-brulee-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „любим френски десерт … напитка с деликатен карамелен вкус и кремообразна текстура“: a drink of a dessert. The supplier calls sixteen of the seventeen coffees in this audit „кафе“, „еспресо“ or a blend, and the seventeenth has a recorded intensity; nothing in this one's record names coffee, espresso, arabica or an intensity, and our copy describes the dessert and the decaf flag only. Classed the same way on 9 October 2026 (docs/seo.md §18, the decaf note). Indirect: no ingredient list was available; confirm on the pack.",
  },
];

/** Flagged flavoured, and coffee: the other seventeen of the audit. */
export const FLAVOURED_COFFEE: readonly CoffeeEvidence[] = [
  {
    slug: "bianchi-chocolate-aroma-espresso-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „Съблазнително кафе с нежен шоколадов аромат“. Our copy: „вкусът в чашата остава на кафе“.",
  },
  {
    slug: "bianchi-hazelnut-aroma-espresso-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „Изискано кафе с неустоим аромат на лешник“. Our copy: „ароматизирано кафе в капсули“.",
  },
  {
    slug: "bianchi-irish-cream-aroma-espresso-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „комбинация от кафе и нежен аромат на Irish Cream“. Our copy: „Кафе за спокойния край на деня“.",
  },
  {
    slug: "borbone-baileys-cappuccino-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „кафе с уникален вкус, вдъхновен от известния ликьор“. Our copy: „събира кафе, мляко и ароматния профил“; „умерена кафеена сила“.",
  },
  {
    slug: "caffitaly-espresso-nocciola-kapsuli-caffitaly-10-br",
    evidence:
      "Supplier: „еспресо, което съчетава висококачествена 100% арабика с деликатния аромат на печени лешници“.",
  },
  {
    slug: "caffitaly-espresso-panettone-kapsuli-caffitaly-10-br",
    evidence:
      "Supplier: „съчетава 70% арабика и 30% робуста“. Our copy: „кафето отдолу остава кафе“.",
  },
  {
    slug: "lollo-caffe-amaretto-kafe-dozi-18-br",
    evidence:
      "Supplier: „съчетава богатия аромат на кафе с нежни бадемови … нюанси“. Our copy: „Това е ароматизирано кафе“.",
  },
  {
    slug: "lollo-caffe-ginseng-kafe-dozi-18-br",
    evidence:
      "Supplier: „съчетава характерния вкус на кафе с нежни нотки на женшен“. Our copy: „съчетава кафе с женшен“.",
  },
  {
    slug: "rema-caffe-caramel-kafe-dozi-100-br",
    evidence: "Supplier: „съчетава 100% арабика с кремообразен карамел“.",
  },
  {
    slug: "rema-caffe-caramel-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „баланс между ароматно еспресо и сладки нотки на карамел“. Our copy: „сладките нотки стоят върху ароматно еспресо“.",
  },
  {
    slug: "rema-caffe-caramel-kapsuli-nespresso-10-br",
    evidence:
      "Supplier names no coffee („сладост на карамела“); intensity 8 от 12 recorded. Our copy: „кафеената основа остава достатъчно силна, за да носи сладостта“.",
  },
  {
    slug: "rema-caffe-cookies-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „уникалното кафе … комбинация от богат аромат на еспресо и сладки нотки на бисквитка“.",
  },
  {
    slug: "rema-caffe-cookies-kapsuli-nespresso-10-br",
    evidence: "Supplier: „100% арабика бленд съчетава нежното тяло на бразилското кафе“.",
  },
  {
    slug: "rema-caffe-hazelnut-kafe-dozi-100-br",
    evidence:
      "Supplier: „ароматно кафе с богат профил на печени лешници“. Our copy: „аромат, добавен към арабика“.",
  },
  {
    slug: "rema-caffe-hazelnut-kapsuli-dolce-gusto-16-br",
    evidence: "Supplier: „ароматно еспресо с леко сладък и наситен вкус на печени лешници“.",
  },
  {
    slug: "rema-caffe-hazelnut-kapsuli-nespresso-10-br",
    evidence: "Supplier: „кафе с вкус на лешник в капсула“.",
  },
  {
    slug: "rema-caffe-irish-cream-kapsuli-dolce-gusto-16-br",
    evidence:
      "Supplier: „комбинация от кафе и нежен аромат на Irish Cream“. Our copy: „положен върху кафе с умерена сила“.",
  },
];
