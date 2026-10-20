import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  brands,
  newsletterCampaigns,
  newsletterSubscribers,
  productImages,
  products,
  sourceSites,
  syncChanges,
  syncRuns,
} from "@catalog/db/schema";
import type { Database } from "@catalog/db";
// Types only: the modules are imported in `beforeAll`, once the test database is chosen.
import type * as Actions from "@/lib/newsletter/actions";
import type * as Campaigns from "@/lib/newsletter/campaigns";
import type * as Queries from "@/lib/catalog/queries";
import type * as Send from "@/lib/newsletter/send";
import type * as Source from "@/lib/newsletter/product-source";
import type * as ProductsRoute from "@/app/api/admin/newsletter/products/route";
import type { BatchClient, BatchEmail, BatchResponse } from "@/lib/newsletter/batch";
import { emptySnapshot, type ProductBlocksSnapshot } from "@/lib/newsletter/product-blocks";
import type { PickerProduct } from "@/lib/newsletter/picker";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * Products in a newsletter against a real catalog: the three blocks resolved
 * from real rows by the storefront's own queries — and named and priced
 * exactly as the product page names and prices them — the composer's product
 * search, and a send that is interrupted, sees the catalog change, and is
 * resumed, and still sends every subscriber the same letter.
 *
 * Nothing reaches Resend: the sender is handed a stand-in client.
 */

const harness = vi.hoisted(() => ({ signedIn: true }));

vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/auth", () => ({ isSignedIn: async () => harness.signedIn }));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;
const STORE = "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com";

/** Delivers every copy, or refuses with a rate limit from the `refuseFrom`-th request on. */
class Inbox implements BatchClient {
  delivered: BatchEmail[] = [];
  requests = 0;
  constructor(private readonly refuseFrom = Number.POSITIVE_INFINITY) {}
  async send(emails: BatchEmail[]): Promise<BatchResponse> {
    this.requests += 1;
    if (this.requests >= this.refuseFrom) {
      return {
        data: null,
        error: { name: "rate_limit_exceeded", message: "slow down", statusCode: 429 },
      };
    }
    this.delivered.push(...emails);
    return {
      data: emails.map((_, index) => ({ id: `re_${this.requests}_${index}` })),
      error: null,
    };
  }
}

suite("newsletter product blocks (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let actions: typeof Actions;
  let campaigns: typeof Campaigns;
  let queries: typeof Queries;
  let send: typeof Send;
  let source: typeof Source;
  let productsRoute: typeof ProductsRoute;
  let siteId: string;
  let brandId: string;

  beforeAll(async () => {
    process.env.RESEND_API_KEY = "re_test_not_a_real_key";
    process.env.NEXT_PUBLIC_IMAGE_BASE_URL = STORE;
    ({ db, close } = await useTestDatabase("newsletter_blocks"));
    actions = await import("@/lib/newsletter/actions");
    campaigns = await import("@/lib/newsletter/campaigns");
    queries = await import("@/lib/catalog/queries");
    send = await import("@/lib/newsletter/send");
    source = await import("@/lib/newsletter/product-source");
    productsRoute = await import("@/app/api/admin/newsletter/products/route");
  });

  afterAll(async () => {
    delete process.env.NEXT_PUBLIC_IMAGE_BASE_URL;
    await close?.();
  });

  beforeEach(async () => {
    harness.signedIn = true;
    await db.execute(
      sql`truncate table newsletter_deliveries, newsletter_campaigns, newsletter_subscribers, product_images, sync_changes, sync_runs, products, brands, source_sites restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "blocks-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
    const [brand] = await db
      .insert(brands)
      .values({ sourceSiteId: siteId, sourceKey: "lavazza", name: "Lavazza", slug: "lavazza" })
      .returning({ id: brands.id });
    brandId = brand!.id;
  });

  const add = async (input: {
    slug: string;
    name?: string;
    price?: string | null;
    oldPrice?: string | null;
    retailPrice?: string | null;
    retailOldPrice?: string | null;
    status?: "active" | "removed" | "missing";
    availability?: "in_stock" | "out_of_stock" | "preorder" | "unknown";
    daysOld?: number;
    brand?: boolean;
    image?: boolean | { width: number; height: number };
    /** A researched pack size, as the facts research writes it. */
    pack?: { value: string; unit: string; overridden: boolean };
  }) => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${input.slug}/`,
        sourceUrl: `https://example.test/${input.slug}/`,
        sourcePath: `/${input.slug}/`,
        semanticHash: input.slug,
        slug: input.slug,
        name: input.name ?? `Кафе на зърна Lavazza ${input.slug} 1кг.`,
        brandId: input.brand === false ? null : brandId,
        currentPrice: input.price === undefined ? "20.00" : input.price,
        oldPrice: input.oldPrice ?? null,
        retailPriceOverride: input.retailPrice ?? null,
        retailOldPriceOverride: input.retailOldPrice ?? null,
        currency: "EUR",
        weightValue: input.pack?.value ?? "1000",
        weightUnit: input.pack?.unit ?? "g",
        packOverrideValue: input.pack?.overridden ? input.pack.value : null,
        packOverrideUnit: input.pack?.overridden ? input.pack.unit : null,
        status: input.status ?? "active",
        availability: input.availability ?? "in_stock",
        firstSeenAt: new Date(Date.now() - (input.daysOld ?? 90) * DAY),
      })
      .returning({ id: products.id });
    if (input.image !== false) {
      await db.insert(productImages).values({
        productId: row!.id,
        sourceUrl: `https://example.test/img/${input.slug}.jpg`,
        objectKey: `catalog/ab/cd/${input.slug}.jpg`,
        width: typeof input.image === "object" ? input.image.width : 800,
        height: typeof input.image === "object" ? input.image.height : 800,
      });
    }
    return row!.id;
  };

  /**
   * Record these products as created by one sync run, as the sync does — the
   * only way a product is new (`isNewArrival`). `runSize` pads the run with
   * other creations, to make it an import of the catalog rather than arrivals.
   */
  const arrive = async (ids: readonly string[], runSize = ids.length) => {
    const [run] = await db
      .insert(syncRuns)
      .values({ sourceSiteId: siteId, status: "succeeded" })
      .returning({ id: syncRuns.id });
    await db.insert(syncChanges).values(
      Array.from({ length: Math.max(runSize, ids.length) }, (_, index) => ({
        syncRunId: run!.id,
        productId: ids[index] ?? null,
        sourceKey: `/created-${index}/`,
        changeType: "created" as const,
      })),
    );
  };

  const shown = (snapshot: Awaited<ReturnType<typeof source.resolveLetterProducts>>) =>
    snapshot.blocks.map((block) => block.products.map((product) => product.slug));

  describe("resolving from the catalog", () => {
    it("shows the newest of the last 30 days, newest first, only what is on sale and can be ordered", async () => {
      await arrive([
        await add({ slug: "nov-2", daysOld: 5 }),
        await add({ slug: "nov-1", daysOld: 1 }),
        await add({ slug: "nov-3", daysOld: 20 }),
        await add({ slug: "staro", daysOld: 40 }),
        await add({ slug: "izcherpan", daysOld: 1, availability: "out_of_stock" }),
        await add({ slug: "spryan", daysOld: 1, status: "removed" }),
        await add({ slug: "lipsva", daysOld: 1, status: "missing" }),
      ]);

      const snapshot = await source.resolveLetterProducts({
        subject: "Ново",
        body: "[[нови-продукти]]\n\n[[нови-продукти: 2]]",
      });
      // The second block leaves out what the first already shows.
      expect(shown(snapshot)).toEqual([["nov-1", "nov-2", "nov-3"], []]);
    });

    it("counts as new only what arrived, not what came with an import of the catalog", async () => {
      await arrive([await add({ slug: "pristigna", daysOld: 3 })]);
      // The first catalog, or a whole new part of it, taken in at once.
      await arrive([await add({ slug: "vnos", daysOld: 2 })], 26);
      // First seen, but never recorded as created by a sync: a seed.
      await add({ slug: "bez-zapis", daysOld: 1 });
      const snapshot = await source.resolveLetterProducts({
        subject: "Ново",
        body: "[[нови-продукти: 6]]",
      });
      expect(shown(snapshot)).toEqual([["pristigna"]]);
    });

    it("shows genuine reductions, biggest first, through the retail layer the storefront reads", async () => {
      await add({ slug: "minus-20", price: "8.00", oldPrice: "10.00" });
      // Pinned by the owner: 6,00 instead of 10,00 — the biggest.
      await add({ slug: "minus-40", price: "10.00", retailPrice: "6.00", retailOldPrice: "10.00" });
      await add({ slug: "minus-10", price: "18.00", oldPrice: "20.00" });
      // An "old price" below the price is not a reduction.
      await add({ slug: "fake", price: "10.00", oldPrice: "9.00" });
      // Reduced at the source, but the owner pinned the full price.
      await add({ slug: "pinned", price: "8.00", oldPrice: "10.00", retailPrice: "10.00" });
      await add({ slug: "gone", price: "1.00", oldPrice: "10.00", availability: "out_of_stock" });
      await add({ slug: "removed", price: "1.00", oldPrice: "10.00", status: "removed" });

      const snapshot = await source.resolveLetterProducts({
        subject: "Намаления",
        body: "[[промоции: 6]]",
      });
      expect(shown(snapshot)).toEqual([["minus-40", "minus-20", "minus-10"]]);
      expect(snapshot.blocks[0]!.products.map((product) => product.discountPercent)).toEqual([
        40, 20, 10,
      ]);
      expect(await queries.countPromotions()).toBeGreaterThanOrEqual(3);
    });

    it("shows hand-picked products in the order typed, telling apart why one is left out", async () => {
      await add({ slug: "a" });
      await add({ slug: "b", availability: "out_of_stock" });
      await add({ slug: "c", status: "removed" });
      await add({ slug: "d" });
      const snapshot = await source.resolveLetterProducts({
        subject: "Избор",
        body: "[[продукти: b, nyama, c, d, a]]",
      });
      expect(shown(snapshot)).toEqual([["d", "a"]]);
      // Sold out since: left out, by name. Withdrawn: left out. Never a product: an error.
      expect(snapshot.blocks[0]).toMatchObject({
        soldOut: [{ slug: "b", title: "Lavazza b" }],
        gone: ["c"],
        missing: ["nyama"],
      });
    });

    it("names, prices and pictures each product exactly as its product page does", async () => {
      await arrive([
        await add({
          slug: "kafe-na-zarna-lavazza-crema-e-aroma-1kg",
          name: "Кафе на зърна Lavazza Crema e Aroma 1кг.",
          price: "19.90",
          oldPrice: "24.90",
          daysOld: 2,
        }),
      ]);
      await add({
        slug: "bez-marka",
        name: "Капсули DG Rema Caffè Cortado 16 бр.",
        brand: false,
        image: false,
      });
      const snapshot = await source.resolveLetterProducts({
        subject: "Тема",
        body: "[[нови-продукти]]\n\n[[продукти: bez-marka]]",
      });
      const all = snapshot.blocks.flatMap((block) => block.products);
      expect(all).toHaveLength(2);
      for (const product of all) {
        const page = (await queries.getProductBySlug(product.slug))!;
        expect(product.name).toBe(page.name);
        expect(product.title).toBe(page.title ?? page.name);
        expect(product.detail).toBe(page.detail ?? null);
        expect(product.price).toBe(page.price?.formatted ?? null);
        expect(product.oldPrice).toBe(page.oldPrice?.formatted ?? null);
        expect(product.discountPercent).toBe(page.oldPrice ? page.discountPercent : null);
        expect(product.perCup).toBe(page.servingPrice?.formatted ?? null);
        expect(product.image?.url ?? null).toBe(page.image?.url ?? null);
        expect(product.path).toBe(`/bg/${page.slug}`);
      }
      const lavazza = all.find((product) => product.slug.startsWith("kafe-na-zarna"))!;
      expect(lavazza.title).toBe("Lavazza Crema e Aroma");
      expect(lavazza.price).toMatch(/^19,90\s€$/);
      expect(lavazza.oldPrice).toMatch(/^24,90\s€$/);
      expect(lavazza.image?.url).toBe(
        `${STORE}/catalog/ab/cd/kafe-na-zarna-lavazza-crema-e-aroma-1kg.jpg`,
      );
      expect(all.find((product) => product.slug === "bez-marka")!.image).toBeNull();
    });

    it("follows the owner's overrides exactly as the product page does: a researched pack, pinned prices", async () => {
      /* The supplier's name says 1 kg; research found 500 g and pinned it; the
         owner pinned a reduced price over the source's. The page names and
         prices the product by the overrides, and so must the letter. */
      await add({
        slug: "kafe-na-zarna-lavazza-crema-e-aroma-500g",
        name: "Кафе на зърна Lavazza Crema e Aroma 1кг.",
        price: "20.00",
        oldPrice: null,
        retailPrice: "12.40",
        retailOldPrice: "15.50",
        pack: { value: "500", unit: "g", overridden: true },
        image: { width: 800, height: 1200 },
      });
      const snapshot = await source.resolveLetterProducts({
        subject: "Тема",
        body: "[[продукти: kafe-na-zarna-lavazza-crema-e-aroma-500g]]\n\n[[промоции]]",
      });
      // Hand-picked, so the reductions block has nothing new to show.
      expect(snapshot.blocks[0]!.products).toHaveLength(1);
      const product = snapshot.blocks[0]!.products[0]!;
      const page = (await queries.getProductBySlug(product.slug))!;
      expect(product).toMatchObject({
        name: page.name,
        title: page.title,
        detail: page.detail,
        price: page.price?.formatted,
        oldPrice: page.oldPrice?.formatted,
        discountPercent: page.discountPercent,
        perCup: page.servingPrice?.formatted,
      });
      // The researched size, not the "1кг." in the supplier's name.
      expect(product.detail).toBe("500 г");
      expect(product.name).not.toMatch(/1\s?кг/);
      expect(product.price).toMatch(/^12,40\s€$/);
      expect(product.oldPrice).toMatch(/^15,50\s€$/);
      expect(product.discountPercent).toBe(20);
      // And the photograph keeps its proportions for a client that blocks it.
      expect(product.image).toMatchObject({ width: 800, height: 1200 });
      const { composeNewsletterEmail } = await import("@/emails/newsletter");
      const { html } = await composeNewsletterEmail(
        {
          subject: "Тема",
          preheader: "",
          body: "[[продукти: kafe-na-zarna-lavazza-crema-e-aroma-500g]]",
          attachments: [],
          products: { ...snapshot, blocks: [snapshot.blocks[0]!] },
        },
        { unsubscribeUrl: "https://buy-a-coffee.com/bg/byuletin/otpisvane?token=x" },
      );
      expect(html).toMatch(
        /<img[^>]*height="168"[^>]*width="112"|<img[^>]*width="112"[^>]*height="168"/,
      );
    });
  });

  describe("the composer's product search", () => {
    const search = async (term: string) => {
      const response = await productsRoute.GET(
        new Request(`http://localhost/api/admin/newsletter/products?q=${encodeURIComponent(term)}`),
      );
      return {
        status: response.status,
        cache: response.headers.get("cache-control"),
        ...((await response.json()) as { products?: PickerProduct[]; error?: string }),
      };
    };

    it("finds products on sale by name, brand or address", async () => {
      await add({
        slug: "kafe-na-zarna-lavazza-oro-1kg",
        name: "Кафе на зърна Lavazza Qualità Oro 1кг.",
      });
      await add({
        slug: "kapsuli-dg-rema-cortado-16-br",
        name: "Капсули DG Rema Caffè Cortado 16 бр.",
        brand: false,
      });
      await add({
        slug: "kafe-spryano",
        name: "Кафе на зърна Lavazza Старо 1кг.",
        status: "removed",
      });

      const byBrand = await search("lavazza");
      expect(byBrand.status).toBe(200);
      expect(byBrand.cache).toContain("no-store");
      expect(byBrand.products?.map((product) => product.slug)).toEqual([
        "kafe-na-zarna-lavazza-oro-1kg",
      ]);
      expect(byBrand.products?.[0]).toMatchObject({
        title: "Lavazza Qualità Oro",
        price: expect.stringMatching(/^20,00\s€$/),
        image: `${STORE}/catalog/ab/cd/kafe-na-zarna-lavazza-oro-1kg.jpg`,
        soldOut: false,
      });
      expect((await search("cortado")).products?.map((p) => p.slug)).toEqual([
        "kapsuli-dg-rema-cortado-16-br",
      ]);
      expect((await search("dg-rema-cort")).products?.map((p) => p.slug)).toEqual([
        "kapsuli-dg-rema-cortado-16-br",
      ]);
      expect((await search("л")).products).toEqual([]);
    });

    it("answers nobody without a session", async () => {
      await add({ slug: "kafe-na-zarna-lavazza-oro-1kg" });
      harness.signedIn = false;
      const answer = await search("lavazza");
      expect(answer.status).toBe(401);
      expect(answer.products).toBeUndefined();
      expect(answer.error).toMatch(/Сесията е изтекла/);
    });
  });

  describe("a send", () => {
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    };

    const subscribe = async (count: number) => {
      await db.insert(newsletterSubscribers).values(
        Array.from({ length: count }, (_, index) => ({
          email: `reader${String(index).padStart(3, "0")}@example.test`,
        })),
      );
    };

    it("takes its products once, at the start, and every request and resume draws them", async () => {
      await add({ slug: "izbrano", price: "15.85", daysOld: 120 });
      await add({ slug: "namaleno", price: "8.00", oldPrice: "10.00", daysOld: 120 });
      await subscribe(150);

      const id = await campaigns.createDraft();
      const version = campaigns.draftVersion((await campaigns.getCampaign(id))!);
      await expect(
        actions.submitNewsletter(
          {},
          form({
            id,
            version,
            intent: "send",
            subject: "Новите кафета",
            preheader: "Две предложения.",
            body: "Здравейте,\n\n[[продукти: izbrano]]\n\n[[промоции]]",
            attachments: "[]",
            confirmCount: "150",
          }),
        ),
      ).rejects.toThrow(`REDIRECT /admin/byuletin/${id}`);

      // Stored with the campaign, in the same breath as the start.
      const started = (await campaigns.getCampaign(id))!;
      expect(started.status).toBe("sending");
      const snapshot = started.attachments.find((entry) => entry.kind === "product-blocks");
      expect(snapshot).toMatchObject({
        campaign: expect.stringMatching(/^\d{4}-\d{2}-novite-kafeta$/),
        blocks: [
          { token: "[[продукти: izbrano]]", products: [{ slug: "izbrano" }] },
          { token: "[[промоции]]", products: [{ slug: "namaleno" }] },
        ],
      });

      // The first request goes; the second meets a rate limit and the run stops.
      const first = new Inbox(2);
      const stopped = await send.runCampaign(id, { client: first, sleep: async () => {} });
      expect(stopped.status).toBe("stopped");
      expect(first.delivered).toHaveLength(100);
      expect((await campaigns.getCampaign(id))!.status).toBe("partial");

      // Overnight the sync moves both prices, and the reduction ends.
      await db.update(products).set({ currentPrice: "99.00" }).where(eq(products.slug, "izbrano"));
      await db
        .update(products)
        .set({ currentPrice: "10.00", oldPrice: null })
        .where(eq(products.slug, "namaleno"));

      expect(await campaigns.claimResume(id)).toBe(true);
      const second = new Inbox();
      const done = await send.runCampaign(id, { client: second, sleep: async () => {} });
      expect(done.status).toBe("done");
      expect(second.delivered).toHaveLength(50);

      const all = [...first.delivered, ...second.delivered];
      const tokenless = (email: BatchEmail) => email.html.replace(/token=[0-9a-f]{64}/g, "token=…");
      expect(new Set(all.map(tokenless)).size).toBe(1);
      const letter = all[0]!.html;
      expect(letter).toMatch(/15,85\s€/);
      expect(letter).not.toMatch(/99,00\s€/);
      expect(letter).toMatch(/8,00\s€/);
      expect(letter).toContain("−20%");
      expect(letter).toContain("https://buy-a-coffee.com/media/catalog/ab/cd/izbrano.jpg");
      expect(letter).not.toContain("blob.vercel-storage.com");
      expect(all[0]!.text).toMatch(
        /- .+ — 15,85\s€ \(.+\) — https?:\/\/\S+\/bg\/izbrano\?utm_source=newsletter&utm_medium=email&utm_campaign=\d{4}-\d{2}-novite-kafeta/,
      );

      // The record page draws the same snapshot: the row still holds it, and the files.
      const finished = (await campaigns.getCampaign(id))!;
      expect(finished.status).toBe("sent");
      expect(finished.attachments.filter((entry) => entry.kind === "product-blocks")).toHaveLength(
        1,
      );
    });

    it("takes the products at its first run when it was started without them", async () => {
      await add({ slug: "namaleno", price: "8.00", oldPrice: "10.00" });
      await subscribe(2);
      const id = await campaigns.createDraft();
      await campaigns.saveDraft(id, {
        subject: "Тема",
        preheader: "",
        body: "Текст\n\n[[промоции]]",
        attachments: [],
      });
      expect(await campaigns.startCampaign(id, 2)).toEqual({ ok: true, recipients: 2 });
      expect((await campaigns.getCampaign(id))!.attachments).toEqual([]);

      const inbox = new Inbox();
      await send.runCampaign(id, { client: inbox, sleep: async () => {} });
      expect(inbox.delivered).toHaveLength(2);
      expect(inbox.delivered[0]!.html).toContain("−20%");
      const [row] = await db
        .select({ attachments: newsletterCampaigns.attachments })
        .from(newsletterCampaigns)
        .where(eq(newsletterCampaigns.id, id));
      expect(row!.attachments).toEqual([
        expect.objectContaining({
          kind: "product-blocks",
          blocks: [expect.objectContaining({ token: "[[промоции]]" })],
        }),
      ]);
    });

    const sendForm = async (body: string, subscribers: number) => {
      const id = await campaigns.createDraft();
      const version = campaigns.draftVersion((await campaigns.getCampaign(id))!);
      const answer = await actions.submitNewsletter(
        {},
        form({
          id,
          version,
          intent: "send",
          subject: "Новите кафета",
          preheader: "Въведение.",
          body,
          attachments: "[]",
          confirmCount: String(subscribers),
        }),
      );
      return { id, answer };
    };

    it("does not start with a line that is not the letter meant, and names each one", async () => {
      await add({ slug: "ima", daysOld: 120 });
      await subscribe(1);
      const { id, answer } = await sendForm(
        [
          "Здравейте,",
          "",
          "## Намалени",
          "",
          "[[промоции]]",
          "",
          "[[продукти: ima, nyama]]",
          "",
          "[[продукти: ima, Лаваца]]",
          "",
          "[[промоций]]",
        ].join("\n"),
        1,
      );
      expect(answer.error).toContain("Изпращането не започна");
      // An empty section is the letter going out shorter: not among the reasons.
      expect(answer.error).not.toContain("[[промоции]]");
      expect(answer.error).toContain(
        "[[продукти: ima, nyama]] — не е адрес на продукт в магазина: „nyama“",
      );
      expect(answer.error).toContain("[[продукти: ima, Лаваца]] — не е адрес на продукт: „Лаваца“");
      expect(answer.error).toContain("[[промоций]] — блокът не е разпознат");
      // Saved, as every press saves, and still a draft: nothing went anywhere.
      const draft = (await campaigns.getCampaign(id))!;
      expect(draft.status).toBe("draft");
      expect(draft.attachments).toEqual([]);
    });

    it("goes without what sold out since and a section left empty, and the letter reads whole", async () => {
      await add({ slug: "ima", daysOld: 120 });
      await add({ slug: "svarshi", daysOld: 120, availability: "out_of_stock" });
      await subscribe(1);
      const { id, answer } = await sendForm(
        [
          "Здравейте,",
          "",
          "## Ново в магазина",
          "",
          "[[нови-продукти]]",
          "",
          "## Избрано",
          "",
          "[[продукти: ima, svarshi]]",
        ].join("\n"),
        1,
      ).then(
        (result) => result,
        (error: Error) => ({ id: error.message.split("/").at(-1)!, answer: null }),
      );
      // Started: the action redirected to the campaign.
      expect(answer).toBeNull();
      const started = (await campaigns.getCampaign(id))!;
      expect(started.status).toBe("sending");

      const inbox = new Inbox();
      expect((await send.runCampaign(id, { client: inbox, sleep: async () => {} })).status).toBe(
        "done",
      );
      const letter = inbox.delivered[0]!;
      expect(letter.html).toContain("Избрано");
      expect(letter.html).toContain("Lavazza ima");
      expect(letter.html).not.toContain("Lavazza svarshi");
      // Nothing new: the section and its heading are not drawn at all.
      expect(letter.html).not.toContain("Ново в магазина");
      expect(letter.text).not.toContain("Ново в магазина");
    });

    it("does not start a letter that would say nothing", async () => {
      await subscribe(1);
      const { id, answer } = await sendForm("## Промоции\n\n[[промоции]]", 1);
      expect(answer.error).toContain("Писмото — няма нито текст, нито продукти за показване");
      expect((await campaigns.getCampaign(id))!.status).toBe("draft");
    });

    it("does not start a letter Gmail would cut off, and says by how much", async () => {
      await subscribe(1);
      /* Inside the body's 20 000 characters: a link is short to type and long
         in mail HTML, so a thousand of them make a letter over the limit. */
      const links = Array.from({ length: 1050 }, () => "[к](https://e.bg)").join(" ");
      expect(links.length).toBeLessThan(20_000);
      const { id, answer } = await sendForm(`Здравейте,\n\n${links}`, 1);
      expect(answer.error).toMatch(/Писмото е около \d+ KB.*102 KB.*Изпращането не започна/);
      expect((await campaigns.getCampaign(id))!.status).toBe("draft");
    });

    it("stops the run, sending nothing, when its products cannot be read", async () => {
      await add({ slug: "namaleno", price: "8.00", oldPrice: "10.00" });
      await subscribe(2);
      const id = await campaigns.createDraft();
      await campaigns.saveDraft(id, {
        subject: "Тема",
        preheader: "",
        body: "Текст\n\n[[промоции]]",
        attachments: [],
      });
      await campaigns.startCampaign(id, 2);
      // A row edited by hand: the entry is there, and is no snapshot.
      await db
        .update(newsletterCampaigns)
        .set({ attachments: [{ kind: "product-blocks", version: 99 }] })
        .where(eq(newsletterCampaigns.id, id));

      const inbox = new Inbox();
      const report = await send.runCampaign(id, { client: inbox, sleep: async () => {} });
      expect(report).toMatchObject({ status: "stopped", requests: 0 });
      expect(inbox.requests).toBe(0);
      const stopped = (await campaigns.getCampaign(id))!;
      expect(stopped.status).toBe("partial");
      expect(stopped.lastError).toContain(
        "[[промоции]] — продуктите му не могат да бъдат прочетени",
      );
    });

    it("keeps the first snapshot written when two runs take one at once", async () => {
      await subscribe(1);
      const id = await campaigns.createDraft();
      await campaigns.saveDraft(id, {
        subject: "Тема",
        preheader: "",
        body: "Текст",
        attachments: [],
      });
      await campaigns.startCampaign(id, 1);
      // Both runs read the row before either wrote a snapshot.
      const row = (await campaigns.getCampaign(id))!;
      const first: ProductBlocksSnapshot = { ...emptySnapshot("Тема"), campaign: "first" };
      const second: ProductBlocksSnapshot = { ...emptySnapshot("Тема"), campaign: "second" };

      expect(await campaigns.ensureProductSnapshot(row, async () => first)).toEqual(first);
      const late = vi.fn(async () => second);
      // The second run resolves its own, finds one stored, and draws that one.
      expect(await campaigns.ensureProductSnapshot(row, late)).toEqual(first);
      expect(late).toHaveBeenCalledOnce();

      const stored = (await campaigns.getCampaign(id))!.attachments.filter(
        (entry) => entry.kind === "product-blocks",
      );
      expect(stored).toEqual([expect.objectContaining({ campaign: "first" })]);
    });
  });
});
