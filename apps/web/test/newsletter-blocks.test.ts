import { afterEach, describe, expect, it, vi } from "vitest";
import { newsletterProductsFixture } from "@/emails/fixtures";
import { parseMarkdown } from "@/emails/markdown";
import { composeNewsletterEmail, type NewsletterContent } from "@/emails/newsletter";
import { imageHeight, productTextLines, productUrl } from "@/emails/product-cards";
import type { ProductCardView } from "@/lib/catalog/types";
import { composeCampaign } from "@/lib/newsletter/batch";
import { unsubscribeUrl } from "@/lib/newsletter/links";
import {
  NEW_PRODUCTS_DAYS,
  blockProblems,
  describeBlockProblems,
  planBlocks,
  campaignFiles,
  campaignSnapshot,
  campaignTag,
  hasProductBlocks,
  pairBlocks,
  productBlocksOf,
  resolveProductBlocks,
  toNewsletterProduct,
  withSnapshot,
  type ProductBlocksSnapshot,
  type ProductSource,
} from "@/lib/newsletter/product-blocks";
import {
  DEFAULT_BLOCK_PRODUCTS,
  MAX_BLOCK_PRODUCTS,
  parseProductToken,
  productTokenLine,
} from "@/lib/newsletter/tokens";

/**
 * Products in a newsletter, short of a database: the line that asks for them,
 * how a body's blocks are resolved against a catalog (a stand-in here; the
 * real reads are `newsletter-blocks.integration.test.ts`), how the cards and
 * their text twin are drawn, and that a send's snapshot draws the same letter
 * every time it is drawn — whatever the catalog does in between.
 */

const recipient = { unsubscribeUrl: unsubscribeUrl("a".repeat(64)) };

afterEach(() => {
  vi.unstubAllEnvs();
});

/* -- the line --------------------------------------------------------------- */

describe("the block line", () => {
  it("reads hand-picked products in the order typed, from slugs or pasted URLs", () => {
    const token = parseProductToken(
      "[[продукти: kafe-a, https://buy-a-coffee.com/bg/Kapsuli-B?utm_source=x, kafe-a; kafe-c]]",
    );
    expect(token).toEqual({
      source:
        "[[продукти: kafe-a, https://buy-a-coffee.com/bg/Kapsuli-B?utm_source=x, kafe-a; kafe-c]]",
      spec: { kind: "picked", slugs: ["kafe-a", "kapsuli-b", "kafe-c"] },
      problem: null,
      notes: [],
      invalid: [],
    });
  });

  it("keeps the first six products and says so", () => {
    const slugs = Array.from({ length: 8 }, (_, index) => `kafe-${index + 1}`);
    const token = parseProductToken(`[[продукти: ${slugs.join(", ")}]]`)!;
    expect(token.spec).toEqual({ kind: "picked", slugs: slugs.slice(0, MAX_BLOCK_PRODUCTS) });
    expect(token.notes).toEqual(["Показват се първите 6."]);
  });

  it("names an address it cannot read, and refuses a block with none", () => {
    const token = parseProductToken("[[продукти: kafe-a, Кафе Лаваца]]")!;
    expect(token.spec).toEqual({ kind: "picked", slugs: ["kafe-a"] });
    expect(token.invalid).toEqual(["Кафе", "Лаваца"]);
    expect(token.notes).toEqual([]);

    for (const line of ["[[продукти]]", "[[продукти: ]]", "[[продукти: Лаваца]]"]) {
      const refused = parseProductToken(line)!;
      expect(refused.spec, line).toBeNull();
      expect(refused.problem, line).toMatch(/Посочете продуктите/);
    }
  });

  it("reads the newest products and the reductions, four unless told, six at most", () => {
    expect(parseProductToken("[[нови-продукти]]")!.spec).toEqual({
      kind: "new",
      limit: DEFAULT_BLOCK_PRODUCTS,
    });
    expect(parseProductToken("[[нови-продукти: 2]]")!.spec).toEqual({ kind: "new", limit: 2 });
    expect(parseProductToken("  [[Нови продукти:3]]  ")!.spec).toEqual({ kind: "new", limit: 3 });
    expect(parseProductToken("[[промоции]]")!.spec).toEqual({ kind: "sale", limit: 4 });
    expect(parseProductToken("[[ПРОМОЦИЯ: 6]]")!.spec).toEqual({ kind: "sale", limit: 6 });

    const many = parseProductToken("[[промоции: 10]]")!;
    expect(many.spec).toEqual({ kind: "sale", limit: 6 });
    expect(many.notes).toEqual(["Показват се най-много 6."]);

    for (const line of ["[[промоции: 0]]", "[[промоции: пет]]", "[[нови-продукти: 2.5]]"]) {
      expect(parseProductToken(line)!.problem, line).toMatch(/от 1 до 6/);
    }
  });

  it("is a block it cannot read when the name is wrong, and not a block when not a whole line", () => {
    const typo = parseProductToken("[[промоций]]")!;
    expect(typo.spec).toBeNull();
    expect(typo.problem).toMatch(/Непознат блок/);

    for (const line of ["Вижте [[промоции]] по-долу", "[промоции]", "[[промоции]] днес", ""]) {
      expect(parseProductToken(line), line).toBeNull();
    }
  });

  it("is written back the way it is read", () => {
    for (const spec of [
      { kind: "picked", slugs: ["kafe-a", "kafe-b"] },
      { kind: "new", limit: DEFAULT_BLOCK_PRODUCTS },
      { kind: "sale", limit: 6 },
    ] as const) {
      expect(parseProductToken(productTokenLine(spec))!.spec).toEqual(spec);
    }
    expect(productTokenLine({ kind: "new", limit: 4 })).toBe("[[нови-продукти]]");
    expect(productTokenLine({ kind: "sale", limit: 4 })).toBe("[[промоции]]");
  });
});

describe("a block in the body", () => {
  it("is a block of its own, between the paragraphs around it", () => {
    const blocks = parseMarkdown("Ето ги:\n[[промоции]]\nИ още текст.");
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "products", "paragraph"]);
    expect(productBlocksOf("Текст\n\n[[промоции]]\n\n[[нещо]]")).toHaveLength(2);
    expect(hasProductBlocks("Текст\n\n[[нещо]]")).toBe(false);
    expect(hasProductBlocks("Текст\n\n[[промоции]]")).toBe(true);
  });

  it("never prints its brackets, readable or not, resolved or not", async () => {
    const { html, text } = await composeNewsletterEmail(
      {
        subject: "Тема",
        preheader: "",
        body: "Здравейте,\n\n[[промоции]]\n\n[[промоций]]\n\nДо скоро.",
        attachments: [],
      },
      recipient,
    );
    expect(html).not.toContain("[[");
    expect(text).not.toContain("[[");
    expect(html).toContain("До скоро.");
  });
});

/* -- resolving -------------------------------------------------------------- */

const price = (formatted: string, amount = "1.00") => ({ amount, currency: "EUR", formatted });

function card(slug: string, extra: Partial<ProductCardView> = {}): ProductCardView {
  return {
    id: `id-${slug}`,
    slug,
    name: `Марка ${slug} — кафе на зърна, 1 кг`,
    title: `Марка ${slug}`,
    detail: "Кафе на зърна, 1 кг",
    price: price("15,85 €"),
    oldPrice: null,
    discountPercent: null,
    availability: "in_stock",
    weight: "1 кг",
    intensity: null,
    systemId: null,
    kind: "roasted",
    servingPrice: { formatted: "≈ 0,11 € на чаша", estimated: true },
    brand: null,
    image: { url: `/media/catalog/${slug}.jpg`, alt: `Марка ${slug}`, width: 800, height: 800 },
    shortDescription: null,
    ...extra,
  };
}

/**
 * A catalog that answers the way the real reads do — on-sale products only;
 * newest and reduced in their order — and records what it was asked. Its
 * contents can change between two draws, as the real catalog's can.
 */
class FakeCatalog implements ProductSource {
  calls: { method: string; args: unknown }[] = [];
  /** While set, every read waits for it: to see which reads are out at once. */
  gate: Promise<void> | null = null;
  constructor(
    public onSale: ProductCardView[],
    public newOnes: ProductCardView[] = [],
    public reductions: ProductCardView[] = [],
  ) {}

  private async answer<T>(value: () => T): Promise<T> {
    if (this.gate) await this.gate;
    return value();
  }

  async bySlugs(slugs: readonly string[]) {
    this.calls.push({ method: "bySlugs", args: [...slugs] });
    return this.answer(
      () =>
        new Map(
          this.onSale
            .filter((item) => slugs.includes(item.slug))
            .map((item) => [item.slug, item] as const),
        ),
    );
  }

  async newest(options: { since: Date; limit: number }) {
    this.calls.push({ method: "newest", args: options });
    return this.answer(() => this.newOnes.slice(0, options.limit));
  }

  async reduced(options: { limit: number }) {
    this.calls.push({ method: "reduced", args: options });
    return this.answer(() => this.reductions.slice(0, options.limit));
  }
}

const NOW = new Date("2026-10-19T09:30:00Z");
const reduced = (slug: string, now: string, old: string, percent: number) =>
  card(slug, { price: price(now), oldPrice: price(old), discountPercent: percent });

describe("resolving a body against the catalog", () => {
  it("shows hand-picked products in the order typed, and lists what is not on sale", async () => {
    const catalog = new FakeCatalog([card("kafe-a"), card("kafe-b"), card("kafe-c")]);
    const snapshot = await resolveProductBlocks(
      "[[продукти: kafe-c, spryano, kafe-a]]\n\n[[продукти: kafe-b]]",
      catalog,
      { subject: "Тема", now: NOW },
    );
    expect(snapshot.blocks.map((block) => block.products.map((product) => product.slug))).toEqual([
      ["kafe-c", "kafe-a"],
      ["kafe-b"],
    ]);
    expect(snapshot.blocks[0]!.missing).toEqual(["spryano"]);
    // One read for every hand-picked slug in the letter.
    expect(catalog.calls).toEqual([
      { method: "bySlugs", args: ["kafe-c", "spryano", "kafe-a", "kafe-b"] },
    ]);
  });

  it("asks for the newest of the last 30 days and the biggest reductions, as many as the line says", async () => {
    const catalog = new FakeCatalog(
      [],
      [card("nov-1"), card("nov-2"), card("nov-3")],
      [reduced("sale-1", "8,00 €", "10,00 €", 20), reduced("sale-2", "9,00 €", "10,00 €", 10)],
    );
    const snapshot = await resolveProductBlocks("[[нови-продукти: 2]]\n\n[[промоции]]", catalog, {
      subject: "Тема",
      now: NOW,
    });
    expect(snapshot.blocks.map((block) => block.products.map((product) => product.slug))).toEqual([
      ["nov-1", "nov-2"],
      ["sale-1", "sale-2"],
    ]);
    const newest = catalog.calls.find((call) => call.method === "newest")!.args as {
      since: Date;
      limit: number;
    };
    expect(newest.limit).toBe(2);
    expect(NOW.getTime() - newest.since.getTime()).toBe(NEW_PRODUCTS_DAYS * 24 * 60 * 60 * 1000);
    // Its own four, and the two the block above may take from the same products.
    expect(catalog.calls.find((call) => call.method === "reduced")!.args).toMatchObject({
      limit: DEFAULT_BLOCK_PRODUCTS + 2,
    });
  });

  it("shows a product once a letter: hand-picked first, then each automatic block in order", async () => {
    const both = reduced("both", "8,00 €", "10,00 €", 20);
    const catalog = new FakeCatalog(
      [both],
      [both, card("nov-1")],
      [both, reduced("s", "1", "2", 50)],
    );
    const snapshot = await resolveProductBlocks(
      "[[нови-продукти]]\n\n[[промоции]]\n\n[[продукти: both]]",
      catalog,
      { subject: "Тема", now: NOW },
    );
    expect(snapshot.blocks.map((block) => block.products.map((product) => product.slug))).toEqual([
      ["nov-1"],
      ["s"],
      ["both"],
    ]);
  });

  it("asks every read at once, each automatic block for enough to fill it after the ones above", async () => {
    let open!: () => void;
    const catalog = new FakeCatalog(
      [card("a"), card("b")],
      [card("a"), card("nov-1"), card("nov-2")],
      [card("a"), card("nov-1"), reduced("s-1", "1", "2", 50), reduced("s-2", "1", "2", 50)],
    );
    catalog.gate = new Promise((resolve) => (open = resolve));
    const pending = resolveProductBlocks(
      "[[продукти: a, b]]\n\n[[нови-продукти: 2]]\n\n[[промоции: 2]]",
      catalog,
      { subject: "Тема", now: NOW },
    );
    // Before any answer has come back, all three reads are already out.
    await Promise.resolve();
    expect(catalog.calls.map((call) => call.method).sort()).toEqual([
      "bySlugs",
      "newest",
      "reduced",
    ]);
    // The newest: its 2, plus the 2 picked above it. The reductions: 2 + 2 + 2.
    expect(catalog.calls.find((call) => call.method === "newest")!.args).toMatchObject({
      limit: 4,
    });
    expect(catalog.calls.find((call) => call.method === "reduced")!.args).toMatchObject({
      limit: 6,
    });
    open();
    const snapshot = await pending;
    expect(snapshot.blocks.map((block) => block.products.map((product) => product.slug))).toEqual([
      ["a", "b"],
      ["nov-1", "nov-2"],
      ["s-1", "s-2"],
    ]);
  });

  it("offers nothing sold out, or not reduced, in an automatic block — whatever the source hands back", async () => {
    const catalog = new FakeCatalog(
      [],
      [card("gone", { availability: "out_of_stock" }), card("here")],
      [card("full-price"), reduced("cheaper", "8,00 €", "10,00 €", 20)],
    );
    const snapshot = await resolveProductBlocks("[[нови-продукти]]\n\n[[промоции]]", catalog, {
      subject: "Тема",
      now: NOW,
    });
    expect(snapshot.blocks.map((block) => block.products.map((product) => product.slug))).toEqual([
      ["here"],
      ["cheaper"],
    ]);
  });

  it("keeps a hand-picked product that is sold out: the owner chose it, and the card says so", async () => {
    const catalog = new FakeCatalog([card("gone", { availability: "out_of_stock" })]);
    const snapshot = await resolveProductBlocks("[[продукти: gone]]", catalog, {
      subject: "Тема",
      now: NOW,
    });
    expect(snapshot.blocks[0]!.products[0]!.availability).toBe("out_of_stock");
  });

  it("records an empty block as empty, and leaves out a line it cannot read", async () => {
    const catalog = new FakeCatalog([]);
    const snapshot = await resolveProductBlocks(
      "[[промоции]]\n\n[[промоций]]\n\n[[продукти: nyama-go]]",
      catalog,
      { subject: "Тема", now: NOW },
    );
    expect(snapshot.blocks).toEqual([
      expect.objectContaining({ token: "[[промоции]]", products: [], missing: [] }),
      expect.objectContaining({
        token: "[[продукти: nyama-go]]",
        products: [],
        missing: ["nyama-go"],
      }),
    ]);
  });

  it("copies the storefront card's own strings, and drops a placeholder photograph", () => {
    const product = toNewsletterProduct(reduced("eurocaf-crema", "11,04 €", "13,80 €", 20));
    expect(product).toEqual({
      id: "id-eurocaf-crema",
      slug: "eurocaf-crema",
      path: "/bg/eurocaf-crema",
      name: "Марка eurocaf-crema — кафе на зърна, 1 кг",
      title: "Марка eurocaf-crema",
      detail: "Кафе на зърна, 1 кг",
      price: "11,04 €",
      oldPrice: "13,80 €",
      discountPercent: 20,
      perCup: "≈ 0,11 € на чаша",
      availability: "in_stock",
      image: {
        url: "/media/catalog/eurocaf-crema.jpg",
        alt: "Марка eurocaf-crema",
        width: 800,
        height: 800,
      },
    });
    // A photograph with no stored text or size still has an alternative, and no made-up size.
    expect(
      toNewsletterProduct(
        card("y", { image: { url: "/media/catalog/y.jpg", alt: " ", width: null, height: null } }),
      ).image,
    ).toEqual({
      url: "/media/catalog/y.jpg",
      alt: "Марка y — кафе на зърна, 1 кг",
      width: null,
      height: null,
    });
    expect(
      toNewsletterProduct(
        card("x", { image: { url: "/placeholder-product.svg", alt: "", width: 1, height: 1 } }),
      ).image,
    ).toBeNull();
  });

  it("draws at most twelve products a letter: the line that would pass them, and all after it, are not drawn", async () => {
    const many = Array.from({ length: 20 }, (_, index) => card(`p-${index}`));
    const catalog = new FakeCatalog(many, many, []);
    const body = [
      "[[продукти: p-0, p-1, p-2, p-3, p-4, p-5]]",
      "[[нови-продукти: 4]]",
      "[[нови-продукти: 3]]",
      "[[продукти: p-19]]",
    ].join("\n\n");
    const lines = productBlocksOf(body);
    expect(planBlocks(lines).map((entry) => entry.state)).toEqual([
      "shown",
      "shown",
      "over-cap",
      "over-cap",
    ]);
    const snapshot = await resolveProductBlocks(body, catalog, { subject: "Тема", now: NOW });
    expect(snapshot.blocks.map((block) => block.token)).toEqual([
      "[[продукти: p-0, p-1, p-2, p-3, p-4, p-5]]",
      "[[нови-продукти: 4]]",
    ]);
    // Twelve exactly is fine.
    expect(
      planBlocks(productBlocksOf("[[нови-продукти: 6]]\n\n[[промоции: 6]]")).map(
        (entry) => entry.state,
      ),
    ).toEqual(["shown", "shown"]);

    const { html } = await composeNewsletterEmail(
      { subject: "Тема", preheader: "", body, attachments: [], products: snapshot },
      recipient,
    );
    expect((html.match(/Виж продукта/g) ?? []).length).toBe(6 + 4);
    expect(html).not.toContain("[[");
  });

  it("names the campaign by month and subject, in Latin", () => {
    expect(campaignTag("Новите кафета на октомври!", NOW)).toBe(
      "2026-10-novite-kafeta-na-oktomvri",
    );
    expect(campaignTag("!!!", NOW)).toBe("2026-10-byuletin");
  });
});

/* -- the letter ------------------------------------------------------------- */

describe("product cards in the letter", () => {
  const letter = composeNewsletterEmail(newsletterProductsFixture, recipient);

  it("draw the name, what it is, the price, the reduction and the price per cup", async () => {
    const html = (await letter).html.replace(/<!-- -->/g, "");
    expect(html).toContain(">Eurocaf Crema Vivace</a>");
    expect(html).toContain("Кафе на зърна, 1 кг");
    expect(html).toMatch(/>11,04 €<\/span> <del[^>]*>13,80 €<\/del> <span[^>]*>−20%<\/span>/);
    expect(html).toContain("≈ 0,08 € на чаша");
    expect(html).toContain("Виж продукта");
    expect(html).toContain("Изчерпан");
    expect(html).toContain("Цена при запитване");
  });

  it("link each product to its page on the site, with the newsletter's campaign", async () => {
    const { html } = await letter;
    const href = productUrl(
      { path: "/bg/kafe-na-zarna-eurocaf-crema-vivace-1kg" },
      "2026-10-novite-kafeta-na-oktomvri",
    );
    expect(href).toMatch(
      /^https?:\/\/[^/]+\/bg\/kafe-na-zarna-eurocaf-crema-vivace-1kg\?utm_source=newsletter&utm_medium=email&utm_campaign=2026-10-novite-kafeta-na-oktomvri$/,
    );
    // Photograph, name and button: the same address.
    expect(html.split(`href="${href.replace(/&/g, "&amp;")}"`)).toHaveLength(4);
  });

  it("draw no reduction badge under one percent, as the site does not", async () => {
    const snapshot = structuredClone(newsletterProductsFixture.products!);
    const sale = snapshot.blocks[2]!.products[1]!;
    sale.discountPercent = 0;
    const { html } = await composeNewsletterEmail(
      { ...newsletterProductsFixture, products: snapshot },
      recipient,
    );
    expect(html).toContain("5,90 €</del>");
    expect(html).not.toContain("−0%");
  });

  it("are lines of their own in the text part: name — price (per cup) — address", async () => {
    const { text } = await letter;
    const campaign = newsletterProductsFixture.products!.campaign;
    expect(text).toContain(
      `- Vandino Espresso Aroma — кафе на зърна, 1 кг — 15,85 € (≈ 0,11 € на чаша) — ${productUrl({ path: "/bg/kafe-na-zarna-vandino-espresso-aroma-1kg" }, campaign)}`,
    );
    expect(text).toContain(
      "- Eurocaf Crema Vivace — кафе на зърна, 1 кг — 11,04 € вместо 13,80 € (≈ 0,08 € на чаша) — ",
    );
    expect(text).toContain(
      "- Rema Caffè Cortado — капсули за Dolce Gusto, 16 бр. — 5,90 € (0,37 € на чаша) — Изчерпан — ",
    );
    expect(text).toContain("- Biancaffe Arabica — кафе на зърна, 500 г — Цена при запитване — ");
    expect(productTextLines([], campaign)).toBe("");
  });

  it("reserve each photograph's height from its proportions, for a client that blocks images", async () => {
    const { html } = await letter;
    // Vandino's photograph is 800 × 1200: drawn 112 wide, it is 168 high.
    expect(html).toMatch(/<img alt="Vandino Espresso Aroma"[^>]*height="168"[^>]*width="112"/);
    expect(html).toMatch(/<img alt="Molini Torino"[^>]*height="112"[^>]*width="112"/);
    expect(imageHeight({ width: null, height: 600 })).toBeUndefined();
  });

  it("carry none of React's image preloads, which a mail client never uses", async () => {
    const { html } = await letter;
    expect(html).toContain("<img");
    expect(html).not.toMatch(/<link[^>]*rel="preload"/);
  });

  it("keep the inbox preview line to the words", async () => {
    const { html } = await composeNewsletterEmail(
      { ...newsletterProductsFixture, preheader: "" },
      recipient,
    );
    const preview = /<div[^>]*display:none[^>]*>([^<]*)/.exec(html)?.[1] ?? "";
    expect(preview).toContain("Здравейте");
    expect(preview).not.toContain("utm_source");
  });
});

/* -- one letter, however often it is drawn ---------------------------------- */

describe("a send's snapshot", () => {
  const body = "Здравейте,\n\n[[продукти: kafe-a]]\n\n[[промоции]]";
  const content = (products: ProductBlocksSnapshot): NewsletterContent => ({
    subject: "Тема",
    preheader: "Въведение",
    body,
    attachments: [],
    products,
  });

  it("draws the same letter on every request and every resume, whatever the catalog does after", async () => {
    const catalog = new FakeCatalog(
      [card("kafe-a")],
      [],
      [reduced("sale-1", "8,00 €", "10,00 €", 20)],
    );
    const snapshot = await resolveProductBlocks(body, catalog, { subject: "Тема", now: NOW });
    const first = await composeCampaign(content(snapshot));

    // The sync changes the price, the reduction ends, a new reduction starts.
    catalog.onSale = [card("kafe-a", { price: price("99,00 €") })];
    catalog.reductions = [reduced("sale-2", "1,00 €", "9,00 €", 88)];
    const calls = catalog.calls.length;

    // The snapshot as the campaign row stores and returns it: through JSON.
    const stored = JSON.parse(JSON.stringify(withSnapshot([], snapshot)));
    const resumed = await composeCampaign(content(campaignSnapshot(stored)!));

    expect(resumed).toEqual(first);
    expect(resumed.html).toContain("15,85 €");
    expect(resumed.html).not.toContain("99,00 €");
    expect(resumed.html).toContain("Марка sale-1");
    expect(resumed.html).not.toContain("Марка sale-2");
    expect(catalog.calls.length).toBe(calls);
  });

  it("is kept beside the files, which stay the template's files alone", () => {
    const file = {
      url: "https://abc.public.blob.vercel-storage.com/newsletter/c/a.pdf",
      name: "a.pdf",
      contentType: "application/pdf",
      size: 10,
      kind: "file" as const,
    };
    const stored = withSnapshot([file], newsletterProductsFixture.products!);
    expect(campaignFiles(stored)).toEqual([file]);
    expect(campaignSnapshot(stored)).toEqual(newsletterProductsFixture.products);
    // Taking it again replaces it rather than adding a second.
    expect(withSnapshot(stored, newsletterProductsFixture.products!)).toHaveLength(2);
  });

  it("reads as none when it is not one, rather than drawing something half-read", () => {
    expect(campaignSnapshot([])).toBeNull();
    expect(campaignSnapshot([{ kind: "product-blocks", version: 2, blocks: "?" }])).toBeNull();
  });

  it("names every block a send must not start with, and is quiet for a sound letter", async () => {
    const catalog = new FakeCatalog([card("ima")], [], []);
    const body = [
      "[[продукти: ima]]",
      "[[промоции]]",
      "[[продукти: ima, nyama]]",
      "[[продукти: ima, Лаваца]]",
      "[[промоций]]",
      "[[нови-продукти: 6]]",
    ].join("\n\n");
    const snapshot = await resolveProductBlocks(body, catalog, { subject: "Тема", now: NOW });
    expect(blockProblems(body, snapshot)).toEqual([
      { token: "[[промоции]]", reason: "няма продукти за показване" },
      { token: "[[продукти: ima, nyama]]", reason: "не са сред продаваните: „nyama“" },
      { token: "[[продукти: ima, Лаваца]]", reason: "не е адрес на продукт: „Лаваца“" },
      { token: "[[промоций]]", reason: "блокът не е разпознат" },
      { token: "[[нови-продукти: 6]]", reason: "писмото вече има 12 продукта" },
    ]);
    // Without its snapshot every drawn block is a problem; without blocks, nothing is.
    expect(blockProblems("[[продукти: ima]]", null)).toEqual([
      { token: "[[продукти: ima]]", reason: "продуктите му не могат да бъдат прочетени" },
    ]);
    expect(blockProblems("Само текст.", null)).toEqual([]);
    expect(blockProblems("[[продукти: ima]]", snapshot)).toEqual([]);
    expect(describeBlockProblems(blockProblems(body, snapshot).slice(0, 2))).toBe(
      "[[промоции]] — няма продукти за показване; [[продукти: ima, nyama]] — не са сред продаваните: „nyama“",
    );
  });

  it("pairs each line with its own entry, and a line that does not match draws nothing", () => {
    const snapshot = newsletterProductsFixture.products!;
    const lines = productBlocksOf(newsletterProductsFixture.body);
    const pairs = pairBlocks(lines, snapshot);
    expect(lines.map((line) => pairs.get(line)?.token)).toEqual(
      snapshot.blocks.map((block) => block.token),
    );

    const changed = productBlocksOf("[[промоции: 6]]\n\n[[нещо]]");
    const unmatched = pairBlocks(changed, { ...snapshot, blocks: [snapshot.blocks[2]!] });
    expect([...unmatched.values()]).toEqual([null, null]);
  });
});
