import { expect, test } from "@playwright/test";
import { checkStructuredData } from "../test/helpers/structured-data";
import { BG, PRODUCT_LINK } from "./support/paths";
import {
  expectImagesHaveAlt,
  expectLandmarks,
  expectNoHeadingSkips,
  expectNoHorizontalScroll,
} from "./support/structure";
import { characters, shopTitle } from "./support/titles";

/**
 * The ESE-machine guide (research `09`, T2.3), as a reader and a crawler get
 * it from a production build: one page, findable, well formed, and the way
 * into the pods listing and the machine pages it names.
 *
 * Written out, as the other specs are: the address, the title and the
 * destinations are literals, so a spec that computed them with the code under
 * test could not pass whatever the page said. Runs in both projects, desktop
 * and phone.
 */

const ARTICLE = "/bg/blog/kafemashina-za-dozi-ese";
const TITLE = "Кафемашина за хартиени дози: коя ги приема и какви дози има";
const META =
  "Как да познаете кафемашина за хартиени дози ESE, какво да проверите, преди да купите такава, и как да изберете дозите по цена на чаша и интензивност.";
/** The machine-database brands with a model that takes ESE pods. */
const POD_MACHINE_BRANDS = ["delonghi", "gaggia", "smeg"] as const;

const decode = (text: string) =>
  text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

test.describe("the ESE-machine guide", () => {
  test("is a page a search result can show whole", async ({ request, baseURL }) => {
    const response = await request.get(ARTICLE, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const html = await response.text();

    const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "");
    expect(title).toBe(shopTitle(TITLE));
    expect(characters(title)).toBeLessThanOrEqual(60);

    const description = decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "");
    expect(description).toBe(META);
    expect(characters(description)).toBeLessThanOrEqual(160);

    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    expect(canonical).toBe(new URL(ARTICLE, baseURL).href);
    expect(html).toMatch(/<meta name="robots" content="index, follow"/);
  });

  test("describes itself as an article, in structured data that passes the check", async ({
    request,
  }) => {
    const html = await (await request.get(ARTICLE)).text();
    const blocks = [
      ...html.matchAll(/<script id="[^"]*" type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map((match) => JSON.parse(match[1]!) as unknown);
    expect(checkStructuredData(blocks)).toEqual([]);

    const nodes = blocks
      .flatMap((block) => [block].flat() as Array<Record<string, unknown>>)
      .flatMap((node) => (Array.isArray(node["@graph"]) ? node["@graph"] : [node])) as Array<
      Record<string, unknown>
    >;
    const article = nodes.find((node) => node["@type"] === "Article");
    expect(article, "Article JSON-LD").toBeTruthy();
    expect(article!.headline).toBe(TITLE);
    expect(article!.datePublished).toBe("2026-10-20");
    expect(String(article!.url)).toMatch(new RegExp(`${ARTICLE}$`));
    expect(nodes.some((node) => node["@type"] === "BreadcrumbList")).toBe(true);
  });

  test("is in the sitemap and in llms.txt", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(decode(match[1]!)).pathname,
    );
    expect(locs).toContain(ARTICLE);

    const llms = await (await request.get("/llms.txt")).text();
    expect(llms).toContain(`[${TITLE}](`);
    expect(llms).toMatch(new RegExp(`\\]\\([^)]*${ARTICLE}\\)`));
  });

  test("is listed by the journal and opens well formed", async ({ page }) => {
    await page.goto(BG.journal);
    await expect(page.locator(`main a[href="${ARTICLE}"]`).first()).toBeAttached();

    await page.goto(ARTICLE);
    await expect(page.locator("h1")).toHaveText(TITLE);
    await expectLandmarks(page);
    await expectNoHeadingSkips(page);
    await expectImagesHaveAlt(page);
    const tables = await page.locator("main table").count();
    expect(await page.locator("main table > caption").count()).toBe(tables);
  });

  test("does not scroll sideways", async ({ page }) => {
    await page.goto(ARTICLE);
    await expectNoHorizontalScroll(page, ARTICLE);
  });

  test("ends at the pods listing, linked by its head term", async ({ page }) => {
    await page.goto(ARTICLE);
    const toPods = page.locator(`main article a[href="${BG.pods}"]`);
    await expect(toPods).toHaveText(["кафе дози", "кафе дози", "Към кафе дозите"]);
    expect((await page.request.get(BG.pods)).status()).toBe(200);
  });

  test("links the machine page of every brand it names, and each one opens", async ({ page }) => {
    await page.goto(ARTICLE);
    for (const brand of POD_MACHINE_BRANDS) {
      const link = page.locator(`main article a[href="${BG.machineBrand(brand)}"]`);
      await expect(link, brand).toHaveCount(1);
      expect((await page.request.get(BG.machineBrand(brand))).status(), brand).toBe(200);
    }
    // And nothing it links is a dead end.
    const hrefs = await page
      .locator("main article a[href^='/bg']")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of new Set(hrefs)) {
      expect((await page.request.get(href, { maxRedirects: 0 })).status(), href).toBe(200);
    }
  });

  /* `docs/seo.md` §13.4: each listing links at most one article. */
  test("is the one article the pods listing links, by its title", async ({ page }) => {
    await page.goto(BG.pods);
    const articles = page.locator('main a[href^="/bg/blog/"]');
    await expect(articles).toHaveCount(1);
    await expect(articles).toHaveAttribute("href", ARTICLE);
    await expect(articles).toHaveText(TITLE);
  });

  /*
   * Corrected with this article: the X7.1 was listed for pods with no source,
   * and illy makes it for Iperespresso capsules only. Nothing on the illy page
   * may send its owner to the pods any more.
   */
  test("the illy page lists the X7.1 among the machines we have nothing for", async ({ page }) => {
    await page.goto(BG.machineBrand("illy"));
    await expect(page.locator(`main a[href="${BG.pods}"]`)).toHaveCount(0);
    await expect(page.locator("main #illy-x7-ese")).toHaveCount(0);
    const unsupported = page.locator("main section", {
      has: page.getByRole("heading", { name: "Модели, за които не предлагаме кафе" }),
    });
    await expect(unsupported).toContainText("X7.1 Iperespresso");
  });

  test("a pod's own page no longer offers it for the X7.1", async ({ page }) => {
    await page.goto(BG.pods);
    const first = await page.locator(`main ${PRODUCT_LINK}`).first().getAttribute("href");
    await page.goto(first as string);
    const fits = page.locator("main section", {
      has: page.getByRole("heading", { name: "Става за тези машини" }),
    });
    await expect(fits).toContainText("De'Longhi Dedica");
    await expect(fits).not.toContainText(/X7|illy/);
  });

  test("keeps the pods listing's title, heading and lead as they were", async ({ page }) => {
    // Milestone 1 measures this page (research 09, T1.1): the link is the only change.
    await page.goto(BG.pods);
    await expect(page).toHaveTitle(shopTitle("Кафе дози ESE (хартиени дози 44 мм)"));
    await expect(page.locator("h1")).toHaveText("Кафе дози ESE");
    await expect(page.locator("main")).toContainText(
      "Кафе дози ESE: хартиените дози, които мнозина търсят и като ESE капсули или дозети.",
    );
  });
});
