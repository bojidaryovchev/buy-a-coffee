import { describe, expect, it } from "vitest";
import { newsletterFixture, newsletterProductsFixture } from "@/emails/fixtures";
import { parseMarkdown } from "@/emails/markdown";
import { composeNewsletterEmail } from "@/emails/newsletter";
import {
  blockId,
  insertBlock,
  moveBlock,
  parseBody,
  removeBlock,
  replaceBlock,
  serializeBody,
  type BodyModel,
} from "@/lib/newsletter/body-blocks";
import { unsubscribeUrl } from "@/lib/newsletter/links";
import { letterBlocks, type ProductBlocksSnapshot } from "@/lib/newsletter/product-blocks";
import { monthlyLetter, promotionLetter } from "@/lib/newsletter/templates";

/**
 * The composer's blocks are a way of looking at the body, never a second
 * copy of it: read into blocks and written back, every body comes back
 * character for character — blank lines, a trailing newline, Windows line
 * ends, two product lines on neighbouring lines — and a line is a product
 * block here exactly when it is one in the letter. Moving, adding and taking
 * out blocks keeps texts apart and product lines on lines of their own, and
 * touches nothing else.
 *
 * And what the letter draws of a body once its blocks are known: a block with
 * nothing to show is left out, and so is a heading over nothing but such
 * blocks (`sections.ts`).
 */

const NOW = new Date("2026-11-01T07:00:00Z");
const promotion = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Есенни дни",
  percentOff: 10,
  startsAt: new Date("2026-10-26T22:00:00Z"),
  endsAt: new Date("2026-11-15T22:00:00Z"),
};

const BODIES: Record<string, string> = {
  empty: "",
  "a newline": "\n",
  "blank lines only": "\n\n  \n",
  "text only": "Здравейте,\n\nНови кафета.",
  "a trailing newline": "Здравейте,\n\n[[промоции]]\n",
  "adjacent product lines": "[[промоции]]\n[[нови-продукти]]",
  "adjacent with text on both sides": "Горе\n[[промоции]]\n[[нови-продукти: 2]]\nДолу",
  "product lines only": "[[продукти: a, b]]\n\n[[промоции: 6]]",
  "a padded product line": "Текст\n   [[промоции]]  \n\nОще",
  "Windows line ends": "Здравейте,\r\n\r\n[[промоции]]\r\nДо скоро.\r\n",
  "an old Mac line end": "Горе\r[[промоции]]\rДолу",
  "blank lines with spaces and tabs": "Горе\n  \n[[промоции]]\n\t\n\nДолу",
  "an unreadable line": "Текст\n\n[[промоций]]\n\nОще",
  "a block inside a sentence is text": "Вижте [[промоции]] по-долу.",
  "leading blank lines": "\n\n\nЗдравейте,\n\n[[нови-продукти]]",
  "a list and a heading": "## Ново\n\n- едно\n- две\n[[продукти: a]]\n### Още\nтекст",
  "fixture: the letter": newsletterFixture.body,
  "fixture: the letter with products": newsletterProductsFixture.body,
  "template: monthly": monthlyLetter({
    now: NOW,
    newArrivals: ["a", "b"],
    reduced: ["c"],
    promotions: [promotion],
  }).body,
  "template: promotion": promotionLetter({ now: NOW, promotion, members: ["c", "d"] }).body,
};

describe("the body as blocks", () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`comes back character for character: ${name}`, () => {
      expect(serializeBody(parseBody(body))).toBe(body);
    });

    it(`has a product block exactly where the letter does: ${name}`, () => {
      const lines = parseBody(body)
        .blocks.filter((block) => block.kind === "products")
        .map((block) => (block.kind === "products" ? block.line : ""));
      const letter = parseMarkdown(body).flatMap((block) =>
        block.type === "products" ? [block.token.source] : [],
      );
      expect(lines).toEqual(letter);
    });
  }

  it("keeps the text between product lines as one block, and nothing blank as a block", () => {
    const model = parseBody("\n\nПърво.\n\nВторо.\n\n[[промоции]]\n\n\n[[нови-продукти]]\n");
    expect(model.blocks.map((block) => block.kind)).toEqual(["text", "products", "products"]);
    expect(model.blocks[0]).toMatchObject({ text: "Първо.\n\nВторо." });
    expect(model.seps).toEqual(["\n\n", "\n\n", "\n\n\n", "\n"]);
  });
});

const kinds = (model: BodyModel) => model.blocks.map((block) => block.kind);

describe("changing the blocks", () => {
  it("changes one block and leaves every other character where it was", () => {
    const body = "Горе,\r\n\r\n[[промоции]]\r\n\r\n\r\nДолу.\r\n";
    const model = parseBody(body);
    const edited = replaceBlock(model, 2, {
      id: model.blocks[2]!.id,
      kind: "text",
      text: "Долу, и още.",
    });
    expect(serializeBody(edited)).toBe("Горе,\r\n\r\n[[промоции]]\r\n\r\n\r\nДолу, и още.\r\n");
  });

  it("keeps two texts apart when a move or a removal brings them together", () => {
    const model = parseBody("Първо.\n[[промоции]]\nВторо.");
    // Taken out: the line breaks around it become a blank line between the texts.
    const removed = removeBlock(model, 1);
    expect(serializeBody(removed)).toBe("Първо.\n\nВторо.");
    expect(parseMarkdown(serializeBody(removed)).map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    // Moved: the product line goes first and the texts meet; they stay two paragraphs.
    const moved = moveBlock(model, 1, -1);
    expect(serializeBody(moved)).toBe("[[промоции]]\nПърво.\n\nВторо.");
  });

  it("keeps a product line on a line of its own", () => {
    const model = parseBody("[[промоции]]");
    const added = insertBlock(model, 0, { id: blockId(), kind: "text", text: "Здравейте," });
    expect(serializeBody(added)).toBe("Здравейте,\n\n[[промоции]]");
    expect(kinds(parseBody(serializeBody(added)))).toEqual(["text", "products"]);
  });

  it("adds at the end, before a trailing newline, and into an empty body", () => {
    const line = { id: blockId(), kind: "products" as const, line: "[[промоции]]" };
    expect(serializeBody(insertBlock(parseBody("Текст\n"), 1, line))).toBe(
      "Текст\n\n[[промоции]]\n",
    );
    expect(serializeBody(insertBlock(parseBody(""), 0, line))).toBe("[[промоции]]");
  });

  it("takes out the first or the last block without leaving its gap behind", () => {
    const model = parseBody("[[промоции]]\n\nТекст\n\n[[нови-продукти]]\n");
    expect(serializeBody(removeBlock(model, 0))).toBe("Текст\n\n[[нови-продукти]]\n");
    expect(serializeBody(removeBlock(model, 2))).toBe("[[промоции]]\n\nТекст\n");
  });

  it("does not move a block past either end", () => {
    const model = parseBody("Текст\n\n[[промоции]]");
    expect(moveBlock(model, 0, -1)).toBe(model);
    expect(moveBlock(model, 1, 1)).toBe(model);
  });
});

/* -- what the letter draws -------------------------------------------------- */

const product = (slug: string) => ({
  id: `id-${slug}`,
  slug,
  path: `/bg/${slug}`,
  name: `Марка ${slug} — кафе на зърна, 1 кг`,
  title: `Марка ${slug}`,
  detail: "Кафе на зърна, 1 кг",
  price: "15,85 €",
  oldPrice: null,
  discountPercent: null,
  perCup: null,
  availability: "in_stock" as const,
  image: null,
});

function snapshot(blocks: { token: string; slugs: string[] }[]): ProductBlocksSnapshot {
  return {
    kind: "product-blocks",
    version: 1,
    resolvedAt: NOW.toISOString(),
    campaign: "2026-11-test",
    blocks: blocks.map(({ token, slugs }) => ({
      token,
      spec: token.startsWith("[[промоции")
        ? { kind: "sale", limit: 4 }
        : token.startsWith("[[нови")
          ? { kind: "new", limit: 4 }
          : { kind: "picked", slugs },
      products: slugs.map(product),
      missing: [],
    })),
  };
}

describe("what the letter draws", () => {
  const body = [
    "Здравейте,",
    "## Ново в магазина",
    "[[нови-продукти]]",
    "## Промоции",
    "До 15 ноември.",
    "[[промоции]]",
    "## Избрано",
    "[[продукти: a]]",
  ].join("\n\n");

  it("leaves out an empty block, and a heading with nothing else under it", () => {
    const empty = snapshot([
      { token: "[[нови-продукти]]", slugs: [] },
      { token: "[[промоции]]", slugs: [] },
      { token: "[[продукти: a]]", slugs: ["a"] },
    ]);
    const drawn = letterBlocks(body, empty).blocks.map((block) =>
      block.type === "heading" || block.type === "paragraph"
        ? `${block.type}:${block.children.map((child) => (child.type === "text" ? child.value : "")).join("")}`
        : block.type,
    );
    // "Ново в магазина" goes with its empty block; "Промоции" stays over its sentence.
    expect(drawn).toEqual([
      "paragraph:Здравейте,",
      "heading:Промоции",
      "paragraph:До 15 ноември.",
      "heading:Избрано",
      "products",
    ]);
  });

  it("draws it so in the mail, in both parts", async () => {
    const empty = snapshot([
      { token: "[[нови-продукти]]", slugs: [] },
      { token: "[[промоции]]", slugs: [] },
      { token: "[[продукти: a]]", slugs: ["a"] },
    ]);
    const { html, text } = await composeNewsletterEmail(
      { subject: "Ноември", preheader: "", body, attachments: [], products: empty },
      { unsubscribeUrl: unsubscribeUrl("a".repeat(64)) },
    );
    expect(html).not.toContain("Ново в магазина");
    expect(text).not.toContain("Ново в магазина");
    expect(html).toContain("Промоции");
    expect(html).toContain("Марка a");
  });

  it("keeps the heading of a section whose subsection has text", () => {
    const nested = "## Промоции\n\n### Кафе\n\nТекст.\n\n[[промоции]]";
    const drawn = letterBlocks(nested, snapshot([{ token: "[[промоции]]", slugs: [] }])).blocks;
    expect(drawn.map((block) => block.type)).toEqual(["heading", "heading", "paragraph"]);
  });
});
