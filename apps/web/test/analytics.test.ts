import { describe, expect, it, vi } from "vitest";
import {
  CUSTOM_EVENT_MAX_PROPERTIES,
  CUSTOM_EVENT_MAX_STRING,
  SEARCH_QUERY_MAX,
  dropAdmin,
  isAdminUrl,
  sanitizeSearchQuery,
  setAnalyticsSink,
  toCustomEvent,
  track,
  type AnalyticsEvent,
} from "@/lib/analytics";

/**
 * The rules this file guards: no personal data leaves in an event, every event
 * fits what the platform accepts, and nothing under /admin is measured.
 */

describe("sanitizeSearchQuery", () => {
  it("passes an ordinary query, tidied", () => {
    expect(sanitizeSearchQuery("  кафе   на  зърна ")).toBe("кафе на зърна");
  });

  it("keeps quantities", () => {
    expect(sanitizeSearchQuery("lavazza 1 кг")).toBe("lavazza 1 кг");
    expect(sanitizeSearchQuery("капсули 250 г")).toBe("капсули 250 г");
  });

  it.each([
    "0888123456",
    "+359 888 123 456",
    "088-812-34-56",
    "(088) 812.34.56",
    "обадете се 0888 12 34 56",
  ])("withholds a phone number: %s", (q) => {
    expect(sanitizeSearchQuery(q)).toBeNull();
  });

  it.each(["ivan@example.bg", "кафе ivan [at] x @ y", "Ivan@Example.BG"])(
    "withholds an email: %s",
    (q) => {
      expect(sanitizeSearchQuery(q)).toBeNull();
    },
  );

  it("withholds links", () => {
    expect(sanitizeSearchQuery("https://example.com/x")).toBeNull();
    expect(sanitizeSearchQuery("www.example.com")).toBeNull();
  });

  it("looks past the length cap for a number", () => {
    const q = `${"а".repeat(SEARCH_QUERY_MAX + 10)} 0888123456`;
    expect(sanitizeSearchQuery(q)).toBeNull();
  });

  it("caps the length", () => {
    expect(sanitizeSearchQuery("а".repeat(500))).toHaveLength(SEARCH_QUERY_MAX);
  });

  it("returns null for blank input", () => {
    expect(sanitizeSearchQuery("   ")).toBeNull();
    expect(sanitizeSearchQuery("")).toBeNull();
  });
});

const EVENTS: AnalyticsEvent[] = [
  { name: "view_product", productSlug: "a", brand: null, price: "4.20" },
  { name: "view_category", categorySlug: "c", resultCount: 3 },
  { name: "view_brand", brandSlug: "b", resultCount: 0 },
  { name: "search", query: "кафе", resultCount: 2 },
  { name: "filter_applied", filter: "f", value: "v", resultCount: 1 },
  { name: "quick_order_started", productSlug: "a" },
  { name: "quick_order_submitted", productSlug: "a", outcome: "success" },
  { name: "newsletter_submitted", outcome: "error" },
  { name: "wizard_step_viewed", step: "1" },
  {
    name: "wizard_completed",
    system: "s",
    taste: null,
    volume: "v",
    budget: null,
    requirements: "r",
    resultCount: 3,
    relaxed: "x",
    factsUsed: "composition,roast",
  },
];

describe("toCustomEvent", () => {
  it.each(EVENTS)("maps $name onto flat, allowed values", (event) => {
    const { name, properties } = toCustomEvent(event);
    expect(name).toBe(event.name);
    const entries = Object.entries(properties);
    expect(entries.length).toBeLessThanOrEqual(CUSTOM_EVENT_MAX_PROPERTIES);
    for (const [, v] of entries) {
      expect(["string", "number", "boolean"].includes(typeof v) || v === null).toBe(true);
    }
  });

  it("carries every field except the name, unchanged", () => {
    const wizard = EVENTS[EVENTS.length - 1]!;
    const { name, ...rest } = wizard;
    expect(toCustomEvent(wizard).properties).toEqual(rest);
    expect(name).toBe("wizard_completed");
  });

  it("sanitises the search query on the way out", () => {
    expect(
      toCustomEvent({ name: "search", query: "0888123456", resultCount: 0 }).properties,
    ).toEqual({ query: null, resultCount: 0 });
    expect(toCustomEvent({ name: "search", query: "кафе", resultCount: 4 }).properties).toEqual({
      query: "кафе",
      resultCount: 4,
    });
  });

  it("caps strings and drops non-finite numbers", () => {
    const long = toCustomEvent({ name: "wizard_step_viewed", step: "x".repeat(1000) });
    expect(long.properties.step).toHaveLength(CUSTOM_EVENT_MAX_STRING);
    const bad = toCustomEvent({ name: "view_brand", brandSlug: "b", resultCount: NaN });
    expect(bad.properties).toEqual({ brandSlug: "b" });
  });
});

describe("track", () => {
  it("hands the event to the current sink and survives a throwing one", () => {
    const seen = vi.fn();
    setAnalyticsSink({ track: seen });
    track(EVENTS[0]!);
    expect(seen).toHaveBeenCalledWith(EVENTS[0]);

    setAnalyticsSink({
      track: () => {
        throw new Error("boom");
      },
    });
    expect(() => track(EVENTS[0]!)).not.toThrow();
  });
});

describe("isAdminUrl / dropAdmin", () => {
  it.each([
    "/admin",
    "/admin/",
    "/admin/poshta/ABC123",
    "/ADMIN/vhod",
    "/%61dmin/poshta",
    "https://shop.example/admin/poshta?x=1",
    "/admin?next=/",
  ])("recognises %s", (url) => {
    expect(isAdminUrl(url)).toBe(true);
    expect(dropAdmin({ url })).toBeNull();
  });

  it.each([
    "/",
    "/kafe",
    "/administrator-blend",
    "/products/admin",
    "https://shop.example/?r=/admin",
  ])("leaves %s alone", (url) => {
    expect(isAdminUrl(url)).toBe(false);
    expect(dropAdmin({ url })).toEqual({ url });
  });

  it("treats an unparseable URL as admin", () => {
    expect(isAdminUrl("http://[bad")).toBe(true);
  });
});
