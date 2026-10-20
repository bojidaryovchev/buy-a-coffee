import { expect, test, type APIRequestContext } from "@playwright/test";
import { BG } from "./support/paths";

/**
 * The internal links, as a crawler follows them.
 *
 * Fetches every URL in the sitemap and every clean later page of a listing
 * (`?page=N`, nothing else in the query) it links, and builds the graph of
 * links between the pages a search engine may index. Held to three rules:
 *
 *  - every product in the sitemap is linked from at least one indexable
 *    listing — a category, a landing, a brand, a later page — and not only
 *    from other products' "related" blocks (research 08 §3.1: five products
 *    were linked only from `noindex` later pages);
 *  - the Lavazza, Tchibo and flavoured landings, which carry measured demand,
 *    are linked from at least twenty indexable pages each;
 *  - no indexable page links a listing that is not in the sitemap because it
 *    lists nothing (the consumables page, while it is empty).
 */

const decode = (text: string) =>
  text
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

interface Node {
  readonly path: string;
  readonly status: number;
  readonly indexable: boolean;
  readonly product: boolean;
  /** Declares an `ItemList`: a category, landing or machine page's product list. */
  readonly itemList: boolean;
  readonly links: ReadonlySet<string>;
}

async function fetchNode(request: APIRequestContext, path: string, origin: string): Promise<Node> {
  const response = await request.get(path, { maxRedirects: 0 });
  const html = response.status() === 200 ? await response.text() : "";
  const robots = [...html.matchAll(/<meta name="robots" content="([^"]+)"/g)].map((m) => m[1]!);
  const types = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].flatMap((match) => {
    try {
      const data = JSON.parse(match[1]!) as Record<string, unknown>;
      const graph = (data["@graph"] as Record<string, unknown>[] | undefined) ?? [data];
      return graph.map((entry) => entry["@type"]);
    } catch {
      return [];
    }
  });
  const links = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href="([^"#]+)/g)) {
    const raw = decode(match[1]!);
    if (!raw.startsWith("/") && !raw.startsWith(origin)) continue;
    const url = new URL(raw, origin);
    if (url.origin !== origin) continue;
    links.add(url.pathname + url.search);
  }
  return {
    path,
    status: response.status(),
    indexable: response.status() === 200 && !robots.some((value) => /noindex/.test(value)),
    product: types.includes("Product"),
    itemList: types.includes("ItemList"),
    links,
  };
}

test.describe("the internal link graph", () => {
  test.describe.configure({ mode: "serial" });

  test("links every product from a listing, and the landings from twenty pages", async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(900_000);
    const origin = new URL(baseURL!).origin;
    const xml = await (await request.get("/sitemap.xml")).text();
    const sitemap = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(decode(match[1]!)).pathname,
    );
    expect(sitemap.length).toBeGreaterThan(100);

    const nodes = new Map<string, Node>();
    const queue = [...sitemap];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const batch = queue.splice(0, 6);
      for (const node of await Promise.all(batch.map((path) => fetchNode(request, path, origin)))) {
        nodes.set(node.path, node);
        for (const link of node.links) {
          // A clean later page of a listing: `?page=N` and nothing else.
          if (/^\/bg\/[^?]+\?page=\d+$/.test(link) && !seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    }

    const indexable = [...nodes.values()].filter((node) => node.indexable);
    const inbound = (target: string, from: readonly Node[] = indexable) =>
      from.filter((node) => node.path !== target && node.links.has(target));

    // Every clean later page the listings link is a real, indexable page.
    const laterPages = [...nodes.values()].filter((node) => node.path.includes("?page="));
    expect(laterPages.length).toBeGreaterThan(0);
    expect(
      laterPages.filter((node) => !node.indexable).map((node) => `${node.path} ${node.status}`),
    ).toEqual([]);

    /* A listing, as T1.3 means it: a category or landing (its `ItemList`), a
       brand page, or a clean later page — not the home page, an article or
       the footer of any page. The journal index lists articles, not products. */
    const listings = indexable.filter(
      (node) =>
        !node.product &&
        !node.path.startsWith("/bg/blog") &&
        (node.itemList ||
          /^\/bg\/marki\/[^/?]+(\?page=\d+)?$/.test(node.path) ||
          /\?page=\d+$/.test(node.path)),
    );
    expect(listings.length).toBeGreaterThan(20);
    const products = sitemap.filter((path) => nodes.get(path)?.product);
    expect(products.length).toBeGreaterThan(100);
    const orphans = products.filter((path) => inbound(path, listings).length === 0);
    expect(orphans, `products linked from no indexable listing:\n${orphans.join("\n")}`).toEqual(
      [],
    );

    for (const landing of [
      BG.lavazzaCapsules,
      BG.lavazzaBeans,
      BG.machineBrand("tchibo"),
      BG.flavoured,
    ]) {
      if (!sitemap.includes(landing)) continue; // A landing exists only while it lists something.
      expect(inbound(landing).length, landing).toBeGreaterThanOrEqual(20);
    }

    // A listing out of the sitemap because it is empty is linked from nowhere indexable.
    if (!sitemap.includes(BG.consumables)) {
      expect(inbound(BG.consumables).map((node) => node.path)).toEqual([]);
    }
  });
});
