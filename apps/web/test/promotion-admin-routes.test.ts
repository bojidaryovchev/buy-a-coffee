import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The promotion editor's two routes, which get no layout and so no panel
 * gate: each checks the session itself. A route that forgot would let anyone
 * search the catalog through the panel or, worse, read what a promotion
 * would do before the owner has saved it.
 *
 * The session, the catalog and the preview are stand-ins; nothing here
 * touches a database.
 */

const auth = vi.hoisted(() => ({ isSignedIn: vi.fn(async () => false) }));
vi.mock("@/lib/auth", () => auth);

const catalog = vi.hoisted(() => ({ searchProductCards: vi.fn(async () => [] as unknown[]) }));
vi.mock("@/lib/catalog/queries", () => catalog);

const previewModule = vi.hoisted(() => ({
  previewPromotion: vi.fn(async () => ({
    percentOff: 10,
    total: 0,
    reduced: 0,
    withBadge: 0,
    rows: [],
    more: 0,
  })),
}));
vi.mock("@/lib/promotions/preview", () => previewModule);

const { addDays, todayInSofia } = await import("@/lib/promotions/days");
const products = await import("@/app/api/admin/promotions/products/route");
const preview = await import("@/app/api/admin/promotions/preview/route");

const BRAND = "6f1f9a52-3c2b-4c62-9a0e-2a6b7f1d9e01";

const previewRequest = (body: unknown) =>
  new Request("http://localhost/api/admin/promotions/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/* The preview takes only days the form could save, counted from today. */
const today = todayInSofia();
const question = {
  promotionId: null,
  percent: "10",
  startDay: addDays(today, 1),
  endDay: addDays(today, 15),
  targets: { brandIds: [BRAND] },
};

beforeEach(() => {
  auth.isSignedIn.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("without a session", () => {
  it("searches nothing", async () => {
    const response = await products.GET(
      new Request("http://localhost/api/admin/promotions/products?q=lavazza"),
    );
    expect(response.status).toBe(401);
    expect(catalog.searchProductCards).not.toHaveBeenCalled();
  });

  it("previews nothing", async () => {
    const response = await preview.POST(previewRequest(question));
    expect(response.status).toBe(401);
    expect(previewModule.previewPromotion).not.toHaveBeenCalled();
  });
});

describe("signed in", () => {
  beforeEach(() => auth.isSignedIn.mockResolvedValue(true));

  it("answers a search with ids, uncached", async () => {
    catalog.searchProductCards.mockResolvedValueOnce([
      {
        id: "p1",
        slug: "lavazza-crema",
        name: "Lavazza Crema, 1 кг",
        title: "Lavazza Crema",
        detail: "Кафе на зърна, 1 кг",
        price: { amount: "20.00", currency: "EUR", formatted: "20,00 €" },
        image: null,
        availability: "in_stock",
      },
    ]);
    const response = await products.GET(
      new Request("http://localhost/api/admin/promotions/products?q=lavazza"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      products: [
        {
          id: "p1",
          slug: "lavazza-crema",
          title: "Lavazza Crema",
          detail: "Кафе на зърна, 1 кг",
          price: "20,00 €",
          image: null,
          soldOut: false,
        },
      ],
    });
  });

  it("asks the preview only a question it can read", async () => {
    expect((await preview.POST(previewRequest({ ...question, startDay: "" }))).status).toBe(422);
    expect((await preview.POST(previewRequest({ ...question, targets: "x" }))).status).toBe(422);
    // An absurd year is a message, never a crash.
    const absurd = await preview.POST(
      previewRequest({ ...question, startDay: "9999-12-30", endDay: "9999-12-31" }),
    );
    expect(absurd.status).toBe(422);
    expect(((await absurd.json()) as { error: string }).error).toMatch(/Изберете дни/);
    expect(previewModule.previewPromotion).not.toHaveBeenCalled();

    const response = await preview.POST(previewRequest(question));
    expect(response.status).toBe(200);
    expect(previewModule.previewPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ percent: 10, startDay: question.startDay }),
    );
  });

  it("refuses what is not JSON", async () => {
    const response = await preview.POST(
      new Request("http://localhost/api/admin/promotions/preview", { method: "POST", body: "{" }),
    );
    expect(response.status).toBe(400);
  });
});
