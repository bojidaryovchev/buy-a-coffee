import { z } from "zod";
import type {
  NewsletterAttachment,
  NewsletterCampaignAttachment,
  NewsletterProductBlocks,
} from "@catalog/db/schema";
import { slugify } from "@catalog/shared";
import { parseMarkdown, type ProductsBlock } from "@/emails/markdown";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { isPlaceholderImage } from "@/lib/catalog/images";
import type { Availability, ProductCardView } from "@/lib/catalog/types";
import { productHref } from "@/lib/routes";
import {
  MAX_LETTER_PRODUCTS,
  NEW_PRODUCTS_DAYS,
  planTokens,
  type BlockState,
  type ProductBlockSpec,
} from "./tokens";

/**
 * What a newsletter's product blocks show: resolved from the catalog, once,
 * into data the template draws.
 *
 * WHERE THE FACTS COME FROM. A card in a letter is the storefront's card:
 * `ProductCardView`, built by `toCard` in `lib/catalog/queries.ts` — the same
 * `productName`, the same price layer (`retail_price_override ?? current_price`
 * and its old price), the same `discountPercent`, price per cup and
 * photograph as the product page. This file chooses nothing about how a
 * product is named or priced; it copies the card's finished strings.
 *
 * WHEN. The composer's preview and the test copy resolve the blocks as the
 * catalog stands. A send resolves them ONCE, when it starts, and stores the
 * result with the campaign (`ProductBlocksSnapshot`, an entry of its
 * `attachments`): every request of the send and every resume draws from that
 * snapshot, so a price the sync changes at minute three of a send, or the day
 * before a resume, cannot make two subscribers' letters disagree.
 *
 * HOW MANY. A letter draws at most `MAX_LETTER_PRODUCTS` cards, counted from
 * what its lines ask for, in the order they appear (`planBlocks`): the first
 * line that would go past the cap, and every line after it, is not drawn.
 *
 * WHAT IS SKIPPED. A slug that names nothing on sale; in the two automatic
 * blocks, anything that cannot be ordered, and anything the letter already
 * shows higher up (hand-picked products first, then each automatic block in
 * the order it appears) — the same coffee twice in one letter looks like a
 * mistake. A block left with nothing is not drawn; the composer says so, and
 * a send with such a block does not start (`blockProblems`).
 *
 * The catalog is reached through `ProductSource`, so the rules here are unit
 * tests with a stand-in (`test/newsletter-blocks.test.ts`) and the real reads
 * are `product-source.ts`.
 */

export { NEW_PRODUCTS_DAYS, type BlockState };

/** The catalog, as far as the blocks need it. Every product returned is on sale. */
export interface ProductSource {
  /** Products these slugs name, any order; absent when not on sale. */
  bySlugs(slugs: readonly string[]): Promise<ReadonlyMap<string, ProductCardView>>;
  /** First seen since `since`, newest first, orderable. */
  newest(options: { since: Date; limit: number }): Promise<readonly ProductCardView[]>;
  /** Genuinely reduced, biggest first, orderable. */
  reduced(options: { limit: number }): Promise<readonly ProductCardView[]>;
}

/* -- the snapshot ----------------------------------------------------------- */

const AVAILABILITIES = ["in_stock", "out_of_stock", "preorder", "unknown"] as const;

/** A pixel size as the catalog stores it; absent in a snapshot from before it was kept. */
const dimension = z.number().int().positive().nullable().default(null);

/**
 * One product, as a letter draws it: the card's finished strings, and where
 * it lives on the site. Strings rather than amounts on purpose — the snapshot
 * is a record of what the letter said.
 */
const newsletterProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** The product page's path in the shop's language (`productHref`). */
  path: z.string().startsWith("/"),
  /** The whole name: "Lavazza Super Crema — кафе на зърна, 1 кг". */
  name: z.string(),
  /** Brand and line, the card's heading: "Lavazza Super Crema". */
  title: z.string(),
  /** Format and pack, the line under it: "Кафе на зърна, 1 кг". */
  detail: z.string().nullable(),
  price: z.string().nullable(),
  /** Only when it is a genuine reduction, as on the card. */
  oldPrice: z.string().nullable(),
  discountPercent: z.number().int().nullable(),
  /** "0,31 € на чаша", or "≈ 0,31 € на чаша" when the cups are estimated. */
  perCup: z.string().nullable(),
  availability: z.enum(AVAILABILITIES),
  /**
   * As the storefront resolved it; `emails/media.ts` decides the address mail
   * uses. The photograph's own size, so the card can reserve its height in a
   * client that blocks images (Outlook does, until the reader allows them).
   */
  image: z
    .object({ url: z.string(), alt: z.string(), width: dimension, height: dimension })
    .nullable(),
});

export type NewsletterProduct = z.infer<typeof newsletterProductSchema>;

const specSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("picked"), slugs: z.array(z.string()) }),
  z.object({ kind: z.literal("new"), limit: z.number().int() }),
  z.object({ kind: z.literal("sale"), limit: z.number().int() }),
]);

const resolvedBlockSchema = z.object({
  /** The line as typed: what the block is matched to in the body, and named by. */
  token: z.string(),
  spec: specSchema,
  products: z.array(newsletterProductSchema),
  /** Hand-picked slugs that named nothing on sale. */
  missing: z.array(z.string()),
});

export type ResolvedBlock = z.infer<typeof resolvedBlockSchema>;

export const productBlocksSnapshotSchema = z.object({
  kind: z.literal("product-blocks"),
  version: z.literal(1),
  /** When the catalog was read (ISO 8601). */
  resolvedAt: z.string(),
  /** `utm_campaign` on every product link of this letter. */
  campaign: z.string(),
  /** One per block the letter draws (`planBlocks`), in the order they appear. */
  blocks: z.array(resolvedBlockSchema),
});

export type ProductBlocksSnapshot = z.infer<typeof productBlocksSnapshotSchema>;

/* -- reading a body --------------------------------------------------------- */

/** The block lines of a body, readable or not, in the order they appear. */
export function productBlocksOf(body: string): ProductsBlock[] {
  return parseMarkdown(body).filter((block): block is ProductsBlock => block.type === "products");
}

/** Does this body ask for any products? The cheap test before reaching the catalog. */
export function hasProductBlocks(body: string): boolean {
  return productBlocksOf(body).some((block) => block.token.spec !== null);
}

/** Each block line with what becomes of it (`planTokens`). */
export function planBlocks(
  blocks: readonly ProductsBlock[],
): { block: ProductsBlock; state: BlockState }[] {
  const states = planTokens(blocks.map((block) => block.token));
  return blocks.map((block, index) => ({ block, state: states[index]! }));
}

/**
 * `utm_campaign` for a letter: its month and its subject, in Latin —
 * "2026-10-novite-kafeta-na-oktomvri" — which reads in the analytics as the
 * letter it was. Fixed in the snapshot when a send starts.
 */
export function campaignTag(subject: string, at: Date): string {
  const month = at.toISOString().slice(0, 7);
  const words = slugify(subject, { maxLength: 60 });
  return words ? `${month}-${words}` : `${month}-byuletin`;
}

/* -- resolving -------------------------------------------------------------- */

/** A storefront card as a letter draws it. */
export function toNewsletterProduct(card: ProductCardView): NewsletterProduct {
  const reduced = card.price !== null && card.oldPrice !== null;
  const size = (value: number | null | undefined) =>
    typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  return {
    id: card.id,
    slug: card.slug,
    path: productHref(DEFAULT_LOCALE, card),
    name: card.name,
    title: card.title ?? card.name,
    detail: card.detail ?? null,
    price: card.price?.formatted ?? null,
    oldPrice: reduced ? card.oldPrice!.formatted : null,
    discountPercent: reduced ? card.discountPercent : null,
    perCup: card.servingPrice?.formatted ?? null,
    availability: card.availability as Availability,
    image:
      card.image && !isPlaceholderImage(card.image.url)
        ? {
            url: card.image.url,
            alt: card.image.alt.trim() || card.name,
            width: size(card.image.width),
            height: size(card.image.height),
          }
        : null,
  };
}

/**
 * Every block `body` draws, resolved against the catalog.
 *
 * All the reads at once: one for every hand-picked slug, one per automatic
 * block. An automatic block cannot know before its read what the blocks
 * above it will show, so it asks for its own count plus as many as could be
 * taken above it (never more than the letter's twelve), and the products are
 * then dealt out in memory — hand-picked blocks first, then each automatic
 * block in order, each leaving out what is already shown.
 */
export async function resolveProductBlocks(
  body: string,
  source: ProductSource,
  options: { readonly subject: string; readonly now?: Date },
): Promise<ProductBlocksSnapshot> {
  const now = options.now ?? new Date();
  const shownBlocks = planBlocks(productBlocksOf(body)).flatMap(({ block, state }) =>
    state === "shown" && block.token.spec
      ? [{ token: block.token.source, spec: block.token.spec }]
      : [],
  );

  const picked = shownBlocks.flatMap((block) =>
    block.spec.kind === "picked" ? [...block.spec.slugs] : [],
  );
  const since = new Date(now.getTime() - NEW_PRODUCTS_DAYS * 24 * 60 * 60 * 1000);
  let above = picked.length;
  const automatic = shownBlocks.map((block) => {
    if (block.spec.kind === "picked") return null;
    const limit = block.spec.limit + above;
    above += block.spec.limit;
    return block.spec.kind === "new" ? source.newest({ since, limit }) : source.reduced({ limit });
  });
  const [bySlug, found] = await Promise.all([
    picked.length > 0
      ? source.bySlugs([...new Set(picked)])
      : Promise.resolve(new Map<string, ProductCardView>()),
    Promise.all(automatic.map((read) => read ?? Promise.resolve(null))),
  ]);

  const resolved: (ResolvedBlock | null)[] = shownBlocks.map(() => null);
  const shown = new Set<string>();

  shownBlocks.forEach((block, index) => {
    if (block.spec.kind !== "picked") return;
    const cards = block.spec.slugs.flatMap((slug) => {
      const card = bySlug.get(slug);
      return card ? [card] : [];
    });
    for (const card of cards) shown.add(card.id);
    resolved[index] = {
      token: block.token,
      spec: specOut(block.spec),
      products: cards.map(toNewsletterProduct),
      missing: block.spec.slugs.filter((slug) => !bySlug.has(slug)),
    };
  });

  shownBlocks.forEach((block, index) => {
    if (block.spec.kind === "picked") return;
    /* Held to the rule here as well as in the query, so a source cannot hand
       a letter something sold out, shown twice, or more than it asked for. */
    const cards = (found[index] ?? [])
      .filter((card) => card.availability !== "out_of_stock" && !shown.has(card.id))
      .filter((card) => block.spec.kind !== "sale" || (card.price && card.oldPrice))
      .slice(0, block.spec.limit);
    for (const card of cards) shown.add(card.id);
    resolved[index] = {
      token: block.token,
      spec: specOut(block.spec),
      products: cards.map(toNewsletterProduct),
      missing: [],
    };
  });

  return {
    kind: "product-blocks",
    version: 1,
    resolvedAt: now.toISOString(),
    campaign: campaignTag(options.subject, now),
    blocks: resolved.filter((block): block is ResolvedBlock => block !== null),
  };
}

/**
 * The snapshot with a size for every photograph that has none, as `measure`
 * finds it (`image-size.ts`; the catalog stores none). One call per address,
 * all at once; a photograph `measure` cannot size keeps none, and its card
 * simply takes the text's height.
 */
export async function withImageSizes(
  snapshot: ProductBlocksSnapshot,
  measure: (url: string) => Promise<{ width: number; height: number } | null>,
): Promise<ProductBlocksSnapshot> {
  const unsized = [
    ...new Set(
      snapshot.blocks.flatMap((block) =>
        block.products.flatMap((product) =>
          product.image && (!product.image.width || !product.image.height)
            ? [product.image.url]
            : [],
        ),
      ),
    ),
  ];
  if (unsized.length === 0) return snapshot;
  const sizes = new Map(
    await Promise.all(
      unsized.map(async (url) => [url, await measure(url).catch(() => null)] as const),
    ),
  );
  return {
    ...snapshot,
    blocks: snapshot.blocks.map((block) => ({
      ...block,
      products: block.products.map((product) => {
        const size = product.image ? sizes.get(product.image.url) : null;
        return product.image && size
          ? { ...product, image: { ...product.image, width: size.width, height: size.height } }
          : product;
      }),
    })),
  };
}

function specOut(spec: ProductBlockSpec): ResolvedBlock["spec"] {
  return spec.kind === "picked"
    ? { kind: "picked", slugs: [...spec.slugs] }
    : { kind: spec.kind, limit: spec.limit };
}

/** A snapshot for a body that asks for nothing: no catalog read at all. */
export function emptySnapshot(subject: string, now = new Date()): ProductBlocksSnapshot {
  return {
    kind: "product-blocks",
    version: 1,
    resolvedAt: now.toISOString(),
    campaign: campaignTag(subject, now),
    blocks: [],
  };
}

/**
 * Each block line of a parsed body, paired with what it resolved to.
 *
 * The snapshot holds one entry per line the letter draws (`planBlocks`), in
 * order, so the n-th drawn line is the n-th entry — a campaign's body cannot
 * change once its snapshot is taken. The token is compared all the same, and
 * a line whose entry does not match draws nothing rather than another block's
 * products. A line that is not drawn is paired with nothing.
 */
export function pairBlocks(
  blocks: readonly ProductsBlock[],
  snapshot: ProductBlocksSnapshot | null | undefined,
): Map<ProductsBlock, ResolvedBlock | null> {
  const pairs = new Map<ProductsBlock, ResolvedBlock | null>();
  let drawn = 0;
  for (const { block, state } of planBlocks(blocks)) {
    if (state !== "shown" || !snapshot) {
      pairs.set(block, null);
      continue;
    }
    const entry = snapshot.blocks[drawn];
    drawn += 1;
    pairs.set(block, entry?.token === block.token.source ? entry : null);
  }
  return pairs;
}

/* -- before a send ---------------------------------------------------------- */

export interface BlockProblem {
  /** The line as typed. */
  readonly token: string;
  /** What is wrong with it, in a few words. */
  readonly reason: string;
}

const quoted = (items: readonly string[]) => items.map((item) => `„${item}“`).join(", ");

/**
 * The block lines that would leave a heading with nothing under it, or a
 * different list than the owner asked for: what a send refuses to start
 * with, and a run refuses to go on with. Every line is accounted for —
 * unreadable, over the cap, with an address that is no product's, without
 * its products in the snapshot, empty, or missing some of what it named.
 */
export function blockProblems(
  body: string,
  snapshot: ProductBlocksSnapshot | null | undefined,
): BlockProblem[] {
  const blocks = productBlocksOf(body);
  const pairs = pairBlocks(blocks, snapshot);
  return planBlocks(blocks).flatMap(({ block, state }): BlockProblem[] => {
    const token = block.token.source;
    if (state === "unreadable") return [{ token, reason: "блокът не е разпознат" }];
    if (state === "over-cap") {
      return [{ token, reason: `писмото вече има ${MAX_LETTER_PRODUCTS} продукта` }];
    }
    if (block.token.invalid.length > 0) {
      return [{ token, reason: `не е адрес на продукт: ${quoted(block.token.invalid)}` }];
    }
    const entry = pairs.get(block);
    if (!entry) return [{ token, reason: "продуктите му не могат да бъдат прочетени" }];
    if (entry.products.length === 0) return [{ token, reason: "няма продукти за показване" }];
    if (entry.missing.length > 0) {
      return [{ token, reason: `не са сред продаваните: ${quoted(entry.missing)}` }];
    }
    return [];
  });
}

/** The problems in one sentence: "[[промоции]] — няма продукти за показване; …". */
export function describeBlockProblems(problems: readonly BlockProblem[]): string {
  return problems.map((problem) => `${problem.token} — ${problem.reason}`).join("; ");
}

/* -- the campaign row ------------------------------------------------------- */

/** The files among a campaign's attachments: what the template draws as files. */
export function campaignFiles(
  entries: readonly NewsletterCampaignAttachment[],
): NewsletterAttachment[] {
  return entries.filter(
    (entry): entry is NewsletterAttachment => entry.kind === "image" || entry.kind === "file",
  );
}

/**
 * The snapshot a campaign's send took, if it took one and it reads as one.
 * Validated on the way out of the database: a row edited by hand must cost
 * the products, not the send — and a send whose products cannot be read is
 * stopped (`blockProblems`) rather than sent without them.
 */
export function campaignSnapshot(
  entries: readonly NewsletterCampaignAttachment[],
): ProductBlocksSnapshot | null {
  const entry = entries.find((item) => item.kind === "product-blocks");
  if (!entry) return null;
  const parsed = productBlocksSnapshotSchema.safeParse(entry);
  return parsed.success ? parsed.data : null;
}

/** The attachments with this snapshot in place of any earlier one. */
export function withSnapshot(
  entries: readonly NewsletterCampaignAttachment[],
  snapshot: ProductBlocksSnapshot,
): NewsletterCampaignAttachment[] {
  const stored: NewsletterProductBlocks = { ...snapshot };
  return [...campaignFiles(entries), stored];
}

/* -- what the composer is told ---------------------------------------------- */

/** One block as the preview reports it, for the checks under the composer. */
export interface BlockReport {
  readonly token: string;
  readonly kind: ProductBlockSpec["kind"];
  /** What each card says, as the reader reads it. */
  readonly products: readonly {
    readonly title: string;
    readonly detail: string | null;
    readonly price?: string | null;
    readonly perCup?: string | null;
  }[];
  readonly missing: readonly string[];
}

/** What the preview route answers: the letter, and what its blocks resolved to. */
export interface PreviewResponse {
  readonly html: string;
  readonly blocks: readonly BlockReport[];
}

export function blockReports(snapshot: ProductBlocksSnapshot): BlockReport[] {
  return snapshot.blocks.map((block) => ({
    token: block.token,
    kind: block.spec.kind,
    products: block.products.map((product) => ({
      title: product.title,
      detail: product.detail,
      price: product.price,
      perCup: product.perCup,
    })),
    missing: block.missing,
  }));
}
