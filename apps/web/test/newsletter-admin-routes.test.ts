import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The newsletter's three admin routes, which get no layout and so no panel
 * gate: each checks the session itself, and these tests hold them to it. A
 * route that forgot would hand anybody an upload token for the shop's
 * storage, a renderer for the shop's letterhead, or the subscriber list.
 *
 * The session, Blob's token signer and the list query are stand-ins; nothing
 * here touches a database or the network.
 */

const auth = vi.hoisted(() => ({ isSignedIn: vi.fn(async () => false) }));
vi.mock("@/lib/auth", () => auth);

const blob = vi.hoisted(() => ({ handleUpload: vi.fn() }));
vi.mock("@vercel/blob/client", () => blob);

const campaigns = vi.hoisted(() => ({ allSubscribers: vi.fn() }));
vi.mock("@/lib/newsletter/campaigns", () => campaigns);

/* The catalog, as the preview reads a draft's product blocks from it and the
   picker searches it. */
const productSource = vi.hoisted(() => ({ resolveLetterProducts: vi.fn() }));
vi.mock("@/lib/newsletter/product-source", () => productSource);
const catalog = vi.hoisted(() => ({ searchProductCards: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/lib/catalog/queries", () => catalog);

const { newsletterProductsFixture } = await import("@/emails/fixtures");
const upload = await import("@/app/api/admin/newsletter/upload/route");
const preview = await import("@/app/api/admin/newsletter/preview/route");
const csv = await import("@/app/(admin)/admin/(panel)/byuletin/abonati.csv/route");
const products = await import("@/app/api/admin/newsletter/products/route");

const searchRequest = (term: string) =>
  new Request(`http://localhost/api/admin/newsletter/products?q=${encodeURIComponent(term)}`);

const tokenRequest = (pathname = "newsletter/c1/ceni.pdf") =>
  new Request("http://localhost/api/admin/newsletter/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname, multipart: false, clientPayload: null },
    }),
  });

const previewRequest = (body = "Текст") =>
  new Request("http://localhost/api/admin/newsletter/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "Тема", preheader: "", body, attachments: "[]" }),
  });

beforeEach(() => {
  auth.isSignedIn.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("without a session", () => {
  it("signs no upload", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const response = await upload.POST(tokenRequest());
    expect(response.status).toBe(401);
    expect(blob.handleUpload).not.toHaveBeenCalled();
  });

  it("renders no preview", async () => {
    const response = await preview.POST(previewRequest());
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("<html");
  });

  it("searches no products", async () => {
    const response = await products.GET(searchRequest("lavazza"));
    expect(response.status).toBe(401);
    expect(catalog.searchProductCards).not.toHaveBeenCalled();
  });

  it("exports no list", async () => {
    const response = await csv.GET(new Request("http://localhost/admin/byuletin/abonati.csv"));
    expect(response.status).toBe(401);
    expect(campaigns.allSubscribers).not.toHaveBeenCalled();
  });
});

describe("with a session", () => {
  beforeEach(() => auth.isSignedIn.mockResolvedValue(true));

  it("signs uploads only under newsletter/, of the allowed types and size", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    blob.handleUpload.mockImplementation(
      async ({
        onBeforeGenerateToken,
      }: {
        onBeforeGenerateToken: (p: string) => Promise<unknown>;
      }) => {
        const options = (await onBeforeGenerateToken("newsletter/c1/ceni.pdf")) as {
          allowedContentTypes: string[];
          maximumSizeInBytes: number;
          addRandomSuffix: boolean;
        };
        expect(options.allowedContentTypes).toContain("application/pdf");
        expect(options.allowedContentTypes).not.toContain("image/webp");
        expect(options.maximumSizeInBytes).toBe(15 * 1024 * 1024);
        expect(options.addRandomSuffix).toBe(true);
        await expect(onBeforeGenerateToken("catalog/aa/bb.jpg")).rejects.toThrow();
        await expect(onBeforeGenerateToken("newsletter/../catalog/x.jpg")).rejects.toThrow();
        return { type: "blob.generate-client-token", clientToken: "token" };
      },
    );
    const response = await upload.POST(tokenRequest());
    expect(response.status).toBe(200);
    expect(blob.handleUpload).toHaveBeenCalledOnce();
  });

  it("says so when uploads are not configured", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const response = await upload.POST(tokenRequest());
    expect(response.status).toBe(503);
  });

  it("renders the real template for the preview", async () => {
    const response = await preview.POST(previewRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { html, blocks } = (await response.json()) as { html: string; blocks: unknown[] };
    expect(html).toContain('lang="bg"');
    expect(html).toContain("Тема");
    expect(blocks).toEqual([]);
    // A draft without a product block never reaches the catalog.
    expect(productSource.resolveLetterProducts).not.toHaveBeenCalled();
  });

  it("draws a draft's product blocks from the catalog, and reports what they resolved to", async () => {
    productSource.resolveLetterProducts.mockResolvedValue({
      ...newsletterProductsFixture.products,
      blocks: [
        newsletterProductsFixture.products!.blocks[2],
        { token: "[[нови-продукти]]", spec: { kind: "new", limit: 4 }, products: [], missing: [] },
      ],
    });
    const body = "Текст\n\n[[промоции]]\n\n[[нови-продукти]]";
    const response = await preview.POST(previewRequest(body));
    expect(response.status).toBe(200);
    expect(productSource.resolveLetterProducts).toHaveBeenCalledWith({ subject: "Тема", body });
    const { html, blocks } = (await response.json()) as {
      html: string;
      blocks: { token: string; products: unknown[] }[];
    };
    expect(html).toContain("Eurocaf Crema Vivace");
    expect(blocks.map((block) => [block.token, block.products.length])).toEqual([
      ["[[промоции]]", 2],
      ["[[нови-продукти]]", 0],
    ]);
  });

  it("says so, rather than drawing a letter without its products, when the catalog cannot be read", async () => {
    productSource.resolveLetterProducts.mockRejectedValue(new Error("connection refused"));
    const response = await preview.POST(previewRequest("[[промоции]]"));
    expect(response.status).toBe(503);
  });

  it("searches products for the picker, with what the picker shows of each", async () => {
    catalog.searchProductCards.mockResolvedValue([
      {
        id: "p1",
        slug: "kafe-na-zarna-lavazza-oro-1kg",
        name: "Lavazza Qualità Oro — кафе на зърна, 1 кг",
        title: "Lavazza Qualità Oro",
        detail: "Кафе на зърна, 1 кг",
        price: { amount: "27.90", currency: "EUR", formatted: "27,90 €" },
        oldPrice: null,
        discountPercent: null,
        availability: "in_stock",
        weight: "1 кг",
        intensity: null,
        systemId: null,
        servingPrice: null,
        brand: null,
        image: { url: "https://store.example/catalog/a.jpg", alt: "", width: 800, height: 800 },
        shortDescription: null,
      },
    ]);
    const response = await products.GET(searchRequest(" lavazza "));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(catalog.searchProductCards).toHaveBeenCalledWith(" lavazza ", 20);
    expect(await response.json()).toEqual({
      products: [
        {
          slug: "kafe-na-zarna-lavazza-oro-1kg",
          title: "Lavazza Qualità Oro",
          detail: "Кафе на зърна, 1 кг",
          price: "27,90 €",
          oldPrice: null,
          image: "https://store.example/catalog/a.jpg",
          soldOut: false,
        },
      ],
    });
  });

  it("says so when the search fails, rather than answer with nothing", async () => {
    catalog.searchProductCards.mockRejectedValue(new Error("connection refused"));
    const response = await products.GET(searchRequest("lavazza"));
    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toMatch(/Търсенето не успя/);
  });

  it("exports the active list for Excel in Bulgarian, with formulas defused", async () => {
    campaigns.allSubscribers.mockResolvedValue([
      {
        id: "1",
        email: '=HYPERLINK("x")@example.bg',
        consentAt: new Date("2026-10-19T10:00:00Z"),
        consentSource: "footer",
        unsubscribedAt: null,
      },
    ]);
    const response = await csv.GET(new Request("http://localhost/admin/byuletin/abonati.csv"));
    expect(response.status).toBe(200);
    expect(campaigns.allSubscribers).toHaveBeenCalledWith(false);
    // The byte-order mark, which `text()` would decode away.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await response.text();
    expect(body).toContain('"Имейл";"Съгласие (UTC)";"Как е дадено"');
    expect(body).toContain(`"'=HYPERLINK(""x"")@example.bg"`);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
