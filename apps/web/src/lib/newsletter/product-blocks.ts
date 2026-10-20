import { z } from "zod";
import type {
  NewsletterAttachment,
  NewsletterCampaignAttachment,
  NewsletterProductBlocks,
} from "@catalog/db/schema";
import { slugify } from "@catalog/shared";
import { parseMarkdown, type Block, type ProductsBlock } from "@/emails/markdown";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { isPlaceholderImage } from "@/lib/catalog/images";
import type { Availability, ProductCardView } from "@/lib/catalog/types";
import { productHref } from "@/lib/routes";
import { drawnBlocks } from "./sections";
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
 * WHAT IS SKIPPED. Anything that cannot be ordered: a hand-picked product
 * that has sold out since it was picked (`soldOut`) or left the shop
 * (`gone`), and in the two automatic blocks anything sold out; and anything
 * the letter already shows higher up (hand-picked products first, then each
 * automatic block in the order it appears) — the same coffee twice in one
 * letter looks like a mistake. A block left with nothing is not drawn, nor is
 * a heading over nothing but such blocks (`sections.ts`).
 *
 * WHAT STOPS A SEND, and what only warns (`blockIssues`). A letter goes out
 * only when it is the letter the owner meant: a line the grammar cannot read,
 * an address that is no product's, a block past the letter's twelve, a block
 * whose products cannot be read, a product listed as reduced that no longer
 * is (`[[промоции: адрес, …]]`), or a letter that would say nothing at all
 * are errors. What the catalog did since the owner looked — a product sold
 * out or withdrawn, nothing new this month — leaves the rest of the letter as
 * meant, and is a warning: the monthly draft is prepared days before it is
 * sent, and a coffee that sold out on the 3rd must not hold up the 5th.
 *
 * The catalog is reached through `ProductSource`, so the rules here are unit
 * tests with a stand-in (`test/newsletter-blocks.test.ts`) and the real reads
 * are `product-source.ts`.
 */

export { NEW_PRODUCTS_DAYS, type BlockState };

/** The catalog, as far as the blocks need it. */
export interface ProductSource {
  /** Products on sale that these slugs name, any order, sold out or not; absent otherwise. */
  bySlugs(slugs: readonly string[]): Promise<ReadonlyMap<string, ProductCardView>>;
  /** New arrivals since `since` (`isNewArrival`), newest first, orderable. */
  newest(options: { since: Date; limit: number }): Promise<readonly ProductCardView[]>;
  /** Genuinely reduced, biggest first, orderable. */
  reduced(options: { limit: number }): Promise<readonly ProductCardView[]>;
  /**
   * Which of these slugs name a product at all, on sale or not: tells a
   * product that has left the shop (a warning) from an address that never
   * named one (an error). Without it, every slug not on sale is the latter.
   */
  known?(slugs: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * The current slug of each of these that is a product's former one — a
   * product renamed after it was picked (the same lookup the site's 308s
   * use). Asked only for slugs no product has as its current one.
   */
  renamed?(slugs: readonly string[]): Promise<ReadonlyMap<string, string>>;
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
  /** The shop's promotion pricing it when the letter was drawn, if one did (`claims.ts`). */
  promotionId: z.string().nullable().optional(),
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
  z.object({ kind: z.literal("reduced"), slugs: z.array(z.string()) }),
]);

const resolvedBlockSchema = z.object({
  /** The line as typed: what the block is matched to in the body, and named by. */
  token: z.string(),
  spec: specSchema,
  products: z.array(newsletterProductSchema),
  /** Hand-picked slugs that name no product at all: a typo, or an address from elsewhere. */
  missing: z.array(z.string()),
  /**
   * Hand-picked products left out because they have sold out, with the name
   * the owner knows them by. Optional, like `gone`: a snapshot from before
   * either was kept has none.
   */
  soldOut: z.array(z.object({ slug: z.string(), title: z.string() })).optional(),
  /** Hand-picked slugs of products that are in the catalog but no longer on sale. */
  gone: z.array(z.string()).optional(),
  /** Picked slugs that were a product's former address, with its current one. */
  renamed: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
  /**
   * Products listed as reduced (`reduced`) that no longer are: left out of
   * the block, and the send does not start while there are any — the letter
   * would announce a reduction the shop no longer gives.
   */
  notReduced: z.array(z.object({ slug: z.string(), title: z.string() })).optional(),
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
    promotionId: card.promotion?.id ?? null,
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
    block.spec.kind === "picked" || block.spec.kind === "reduced" ? [...block.spec.slugs] : [],
  );
  const since = new Date(now.getTime() - NEW_PRODUCTS_DAYS * 24 * 60 * 60 * 1000);
  let above = picked.length;
  const automatic = shownBlocks.map((block) => {
    if (block.spec.kind === "picked" || block.spec.kind === "reduced") return null;
    const limit = block.spec.limit + above;
    above += block.spec.limit;
    return block.spec.kind === "new" ? source.newest({ since, limit }) : source.reduced({ limit });
  });
  const wanted = [...new Set(picked)];
  const [current, knownNow, found] = await Promise.all([
    wanted.length > 0
      ? source.bySlugs(wanted)
      : Promise.resolve(new Map<string, ProductCardView>()),
    wanted.length > 0 && source.known
      ? source.known(wanted)
      : Promise.resolve(new Set<string>() as ReadonlySet<string>),
    Promise.all(automatic.map((read) => read ?? Promise.resolve(null))),
  ]);
  /* An address no product has now may be a renamed product's old one: the
     letter shows the product, under its new address, rather than call the
     address unknown. One more pair of reads, only when there is one. */
  const bySlug = new Map(current);
  const known = new Set(knownNow);
  const renamedTo = new Map<string, string>();
  const unknown = wanted.filter((slug) => !current.has(slug) && !knownNow.has(slug));
  if (unknown.length > 0 && source.renamed) {
    const renamed = await source.renamed(unknown);
    if (renamed.size > 0) {
      const now = await source.bySlugs([...new Set(renamed.values())]);
      for (const [from, to] of renamed) {
        renamedTo.set(from, to);
        known.add(from);
        const card = now.get(to);
        if (card) bySlug.set(from, card);
      }
    }
  }

  const resolved: (ResolvedBlock | null)[] = shownBlocks.map(() => null);
  const shown = new Set<string>();

  shownBlocks.forEach((block, index) => {
    const spec = block.spec;
    if (spec.kind !== "picked" && spec.kind !== "reduced") return;
    const onSale = spec.slugs.flatMap((slug) => {
      const card = bySlug.get(slug);
      return card ? [card] : [];
    });
    /* The owner picked it when it could be ordered; a letter that offers it
       now that it cannot is advertising what is not there. Left out, and the
       composer says so. */
    const orderable = onSale.filter((card) => card.availability !== "out_of_stock");
    const soldOut = onSale.filter((card) => card.availability === "out_of_stock");
    /* Listed as reduced: only while the card shows a reduction, struck price
       and all (`toNewsletterProduct` keeps one only when it is genuine). */
    const reduced = (card: ProductCardView) => toNewsletterProduct(card).oldPrice !== null;
    const cards = spec.kind === "reduced" ? orderable.filter(reduced) : orderable;
    const notReduced = spec.kind === "reduced" ? orderable.filter((card) => !reduced(card)) : [];
    const absent = spec.slugs.filter((slug) => !bySlug.has(slug));
    const named = (card: ProductCardView) => ({ slug: card.slug, title: card.title ?? card.name });
    const renamed = spec.slugs.flatMap((slug) =>
      renamedTo.has(slug) ? [{ from: slug, to: renamedTo.get(slug)! }] : [],
    );
    for (const card of cards) shown.add(card.id);
    resolved[index] = {
      token: block.token,
      spec: specOut(spec),
      products: cards.map(toNewsletterProduct),
      missing: absent.filter((slug) => !known.has(slug)),
      ...(soldOut.length > 0 ? { soldOut: soldOut.map(named) } : {}),
      ...(absent.some((slug) => known.has(slug))
        ? { gone: absent.filter((slug) => known.has(slug)) }
        : {}),
      ...(notReduced.length > 0 ? { notReduced: notReduced.map(named) } : {}),
      ...(renamed.length > 0 ? { renamed } : {}),
    };
  });

  shownBlocks.forEach((block, index) => {
    if (block.spec.kind === "picked" || block.spec.kind === "reduced") return;
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
  return spec.kind === "picked" || spec.kind === "reduced"
    ? { kind: spec.kind, slugs: [...spec.slugs] }
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
  /** The line as typed, or "Писмото" for the letter as a whole. */
  readonly token: string;
  /** What is wrong with it, in a few words. */
  readonly reason: string;
  /** An error stops a send; a warning is the letter going out a little shorter. */
  readonly severity: "error" | "warning";
}

const quoted = (items: readonly string[]) => items.map((item) => `„${item}“`).join(", ");

/** The name a letter's problem as a whole goes by in `describeBlockProblems`. */
export const WHOLE_LETTER = "Писмото";

/**
 * The body as the letter draws it from this snapshot: the blocks with
 * products, the text, and no heading over nothing (`sections.ts`).
 */
export function letterBlocks(
  body: string,
  snapshot: ProductBlocksSnapshot | null | undefined,
): { blocks: Block[]; pairs: Map<ProductsBlock, ResolvedBlock | null> } {
  const parsed = parseMarkdown(body);
  const pairs = pairBlocks(
    parsed.filter((block): block is ProductsBlock => block.type === "products"),
    snapshot,
  );
  return {
    blocks: drawnBlocks(parsed, (block) => (pairs.get(block)?.products.length ?? 0) === 0),
    pairs,
  };
}

/**
 * Every block line, and the letter, as they would go out with this snapshot:
 * what is wrong, and whether it stops the send (see "WHAT STOPS A SEND"
 * above). Errors: unreadable, over the cap, an address that is no product's,
 * products that cannot be read, a hand-picked slug that names no product, and
 * a letter with neither a word nor a product in it. Warnings: a block left
 * empty, a hand-picked product sold out or withdrawn since.
 */
export function blockIssues(
  body: string,
  snapshot: ProductBlocksSnapshot | null | undefined,
): BlockProblem[] {
  const blocks = productBlocksOf(body);
  const pairs = pairBlocks(blocks, snapshot);
  const error = (token: string, reason: string): BlockProblem => ({
    token,
    reason,
    severity: "error",
  });
  const warning = (token: string, reason: string): BlockProblem => ({
    token,
    reason,
    severity: "warning",
  });
  const issues = planBlocks(blocks).flatMap(({ block, state }): BlockProblem[] => {
    const token = block.token.source;
    if (state === "unreadable") return [error(token, "блокът не е разпознат")];
    if (state === "over-cap") {
      return [error(token, `писмото вече има ${MAX_LETTER_PRODUCTS} продукта`)];
    }
    if (block.token.invalid.length > 0) {
      return [error(token, `не е адрес на продукт: ${quoted(block.token.invalid)}`)];
    }
    const entry = pairs.get(block);
    if (!entry) return [error(token, "продуктите му не могат да бъдат прочетени")];
    const found: BlockProblem[] = [];
    if (entry.missing.length > 0) {
      found.push(error(token, `не е адрес на продукт в магазина: ${quoted(entry.missing)}`));
    }
    if (entry.soldOut && entry.soldOut.length > 0) {
      found.push(
        warning(token, `изчерпани, пропускат се: ${quoted(entry.soldOut.map((p) => p.title))}`),
      );
    }
    if (entry.gone && entry.gone.length > 0) {
      found.push(warning(token, `вече не се продават, пропускат се: ${quoted(entry.gone)}`));
    }
    if (entry.notReduced && entry.notReduced.length > 0) {
      found.push(
        error(token, `вече не са намалени: ${quoted(entry.notReduced.map((p) => p.title))}`),
      );
    }
    if (entry.products.length === 0) found.push(warning(token, "празен е и няма да се покаже"));
    return found;
  });
  /* Text, or at least one product: a letter of nothing but empty blocks is a
     subject over an empty sheet. Only once the products are known. */
  if (snapshot && letterBlocks(body, snapshot).blocks.length === 0) {
    issues.push(error(WHOLE_LETTER, "няма нито текст, нито продукти за показване"));
  }
  return issues;
}

/**
 * What a send refuses to start with, and a run refuses to go on with: the
 * errors of `blockIssues`. The warnings are the composer's to show.
 */
export function blockProblems(
  body: string,
  snapshot: ProductBlocksSnapshot | null | undefined,
): BlockProblem[] {
  return blockIssues(body, snapshot).filter((issue) => issue.severity === "error");
}

/** The problems in one sentence: "[[промоции]] — блокът не е разпознат; …". */
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

/** The attachments with this snapshot in place of any earlier one, and everything else kept. */
export function withSnapshot(
  entries: readonly NewsletterCampaignAttachment[],
  snapshot: ProductBlocksSnapshot,
): NewsletterCampaignAttachment[] {
  const stored: NewsletterProductBlocks = { ...snapshot };
  return [...entries.filter((entry) => entry.kind !== "product-blocks"), stored];
}

/* -- what the composer is told ---------------------------------------------- */

/**
 * One product as the composer draws it in its block: what the owner
 * recognises it by — photograph, name, pack, price — and its address.
 */
export interface ReportedProduct {
  readonly slug: string;
  readonly title: string;
  readonly detail: string | null;
  readonly price?: string | null;
  readonly oldPrice?: string | null;
  /** The reduction its badge claims, or null when it shows none. */
  readonly discountPercent?: number | null;
  /** The shop's promotion pricing it, if one does. */
  readonly promotionId?: string | null;
  readonly perCup?: string | null;
  /** The photograph's address on the store, for the panel; null without one. */
  readonly image?: string | null;
}

/**
 * One block as the preview reports it: for the checks under the composer, and
 * for the composer's own drawing of the block (its products, and what it left
 * out and why). The optional fields are absent from a report built by hand.
 */
export interface BlockReport {
  readonly token: string;
  readonly kind: ProductBlockSpec["kind"];
  /** What each card says, as the reader reads it. */
  readonly products: readonly ReportedProduct[];
  /** Hand-picked slugs that name no product. */
  readonly missing: readonly string[];
  /** Hand-picked products left out because they sold out. */
  readonly soldOut?: readonly { readonly slug: string; readonly title: string }[];
  /** Hand-picked slugs of products no longer on sale. */
  readonly gone?: readonly string[];
  /** Products listed as reduced that no longer are. */
  readonly notReduced?: readonly { readonly slug: string; readonly title: string }[];
  /** Picked addresses that were a renamed product's, with its current one. */
  readonly renamed?: readonly { readonly from: string; readonly to: string }[];
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
      slug: product.slug,
      title: product.title,
      detail: product.detail,
      price: product.price,
      oldPrice: product.oldPrice,
      discountPercent: product.discountPercent,
      promotionId: product.promotionId ?? null,
      perCup: product.perCup,
      image: product.image?.url ?? null,
    })),
    missing: block.missing,
    soldOut: block.soldOut ?? [],
    gone: block.gone ?? [],
    notReduced: block.notReduced ?? [],
    renamed: block.renamed ?? [],
  }));
}
