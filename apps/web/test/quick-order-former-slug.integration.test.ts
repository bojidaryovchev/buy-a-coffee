import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { orderInquiries, products, sourceSites } from "@catalog/db/schema";
import type { Database } from "@catalog/db";
import type { Notification } from "@/lib/notifications";
// Types only: the module is imported in `beforeAll`, once the test database
// has been chosen.
import type * as Actions from "@/lib/forms/actions";
import { isDatabaseAvailable, useTestDatabase } from "./helpers/test-db";

/**
 * A quick order posted with a slug the product no longer has.
 *
 * The order form carries the product's slug as it was when the page was
 * rendered. After products move to new slugs (`catalog:reslug --apply`), pages
 * cached before the move go on posting the old one for some minutes. The old
 * address still leads to the product, so the order must too.
 */

let requestCounter = 0;
vi.mock("next/headers", () => ({
  // A different caller for every request, so the form limiter never gets in the way.
  headers: async () =>
    new Headers({
      "x-forwarded-for": `10.1.${Math.floor(requestCounter / 250)}.${requestCounter++ % 250}`,
    }),
}));

const available = await isDatabaseAvailable();
const suite = available ? describe : describe.skip;

const IDLE = { status: "idle" } as const;

const FORMER = "kapsuli-dg-borbone-crema-classica-16-br";
const CURRENT = "borbone-crema-classica-kapsuli-dolce-gusto-16-br";

suite("a quick order from a page that still has an old address (integration)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let siteId: string;
  let sent: Notification[];
  let actions: typeof Actions;

  beforeAll(async () => {
    ({ db, close } = await useTestDatabase("order_former_slug"));
    const { setNotificationSink } = await import("@/lib/notifications");
    setNotificationSink({
      name: "capture",
      async send(notification) {
        sent.push(notification);
      },
    });
    actions = await import("@/lib/forms/actions");
  });

  afterAll(async () => {
    await close?.();
  });

  beforeEach(async () => {
    sent = [];
    await db.execute(
      sql`truncate table source_sites, order_inquiries, rate_limit_buckets restart identity cascade`,
    );
    const [site] = await db
      .insert(sourceSites)
      .values({
        key: "former-slug-test",
        name: "Test",
        baseUrl: "https://example.test",
        canonicalHost: "example.test",
      })
      .returning({ id: sourceSites.id });
    siteId = site!.id;
  });

  const add = async (input: {
    slug: string;
    name: string;
    previousSlugs?: string[];
    status?: "active" | "removed";
  }): Promise<string> => {
    const [row] = await db
      .insert(products)
      .values({
        sourceSiteId: siteId,
        sourceKey: `/${input.slug}/`,
        sourceUrl: `https://example.test/${input.slug}/`,
        sourcePath: `/${input.slug}/`,
        semanticHash: input.slug,
        status: input.status ?? "active",
        ...input,
      })
      .returning({ id: products.id });
    return row!.id;
  };

  const order = (productSlug: string, phone = "0888 123 456") => {
    const data = new FormData();
    for (const [key, value] of Object.entries({ productSlug, phone, website: "" })) {
      data.set(key, value);
    }
    return actions.submitOrderInquiry(IDLE, data);
  };

  it("finds the product that used to have the posted slug", async () => {
    const id = await add({
      slug: CURRENT,
      name: "Капсули DG Borbone Crema Classica 16 бр.",
      previousSlugs: [FORMER],
    });

    const result = await order(FORMER);

    expect(result.status).toBe("success");
    const [inquiry] = await db.select().from(orderInquiries);
    expect(inquiry).toMatchObject({
      productId: id,
      productName: "Капсули DG Borbone Crema Classica 16 бр.",
      // Recorded under the address the product has now, so the operator's
      // link opens without a redirect.
      productSlug: CURRENT,
      sourcePage: `/bg/${CURRENT}`,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "order_inquiry", recordId: inquiry!.id });
  });

  it("still finds a product by its current slug, as before", async () => {
    const id = await add({ slug: CURRENT, name: "Borbone", previousSlugs: [FORMER] });

    expect((await order(CURRENT)).status).toBe("success");

    const [inquiry] = await db.select().from(orderInquiries);
    expect(inquiry).toMatchObject({ productId: id, productSlug: CURRENT });
  });

  it("takes the old page and the new page for one order from one customer", async () => {
    await add({ slug: CURRENT, name: "Borbone", previousSlugs: [FORMER] });

    expect((await order(FORMER)).status).toBe("success");
    const again = await order(CURRENT);

    expect(again).toMatchObject({ status: "success" });
    expect(again.message).toMatch(/^Вече получихме заявката ви\./);
    expect(await db.select().from(orderInquiries)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("prefers the product that has the slug now over one that used to", async () => {
    // A slug one product left and another was later given.
    await add({ slug: "moved-on", name: "Moved on", previousSlugs: ["shared-address"] });
    const holder = await add({ slug: "shared-address", name: "Holder" });

    expect((await order("shared-address")).status).toBe("success");

    const [inquiry] = await db.select().from(orderInquiries);
    expect(inquiry).toMatchObject({ productId: holder, productSlug: "shared-address" });
  });

  it("says a product is no longer sold when the old slug leads to one that was removed", async () => {
    await add({ slug: CURRENT, name: "Borbone", previousSlugs: [FORMER], status: "removed" });

    const result = await order(FORMER);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/вече не се предлага/);
    expect(await db.select().from(orderInquiries)).toHaveLength(0);
  });

  it("still turns away a slug no product has or had", async () => {
    await add({ slug: CURRENT, name: "Borbone", previousSlugs: [FORMER] });

    const result = await order("kapsuli-dg-no-such-product-16-br");

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/^Не намерихме този продукт\./);
    expect(await db.select().from(orderInquiries)).toHaveLength(0);
    expect(sent).toEqual([]);
  });
});
