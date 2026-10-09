import { describe, expect, it } from "vitest";
import { freeDeliveryPromise, paymentMethods } from "@/components/commerce/terms";
import { siteConfig, type CommerceConfig } from "@/config/site";
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_READY,
  SHIPPING_LOCALES,
  isShipping,
  xDefaultLocale,
} from "@/i18n/config";
import { bg } from "@/i18n/dictionaries/bg";
import { getDictionary } from "@/i18n/dictionaries";
import { ERROR_COPY } from "@/i18n/error-copy";
import { fill, plural } from "@/i18n/fill";
import { openingHoursLabel } from "@/i18n/hours";
import { preferredLocale } from "@/i18n/negotiate";
import { toPerServingView, toPriceView, unitPriceView } from "@/lib/catalog/format";
import { languageAlternates, pageAlternates } from "@/lib/seo/alternates";
import { href, routes } from "@/lib/routes";

describe("the locale gate", () => {
  it("ships Bulgarian, and holds English back until its content exists", () => {
    expect(LOCALE_READY).toEqual({ bg: true, en: false });
    expect(SHIPPING_LOCALES).toEqual(["bg"]);
    expect(isShipping("en")).toBe(false);
    expect(DEFAULT_LOCALE).toBe("bg");
  });

  it("points x-default at English once it ships, at Bulgarian until then", () => {
    expect(xDefaultLocale(["bg"])).toBe("bg");
    expect(xDefaultLocale(["bg", "en"])).toBe("en");
  });
});

describe("Accept-Language", () => {
  it("answers with a shipping locale only", () => {
    expect(preferredLocale("en-GB,en;q=0.9")).toBe("bg");
    expect(preferredLocale("en-GB,en;q=0.9", ["bg", "en"])).toBe("en");
    expect(preferredLocale("de-DE,en;q=0.5", ["bg", "en"])).toBe("en");
  });

  it("ranks by weight, ignores q=0 and *, and survives a malformed header", () => {
    expect(preferredLocale("en;q=0.2,bg;q=0.8", ["bg", "en"])).toBe("bg");
    expect(preferredLocale("en;q=0,de", ["bg", "en"])).toBe("bg");
    expect(preferredLocale("*", ["bg", "en"])).toBe("bg");
    expect(preferredLocale("en;q=abc", ["bg", "en"])).toBe("bg");
    expect(preferredLocale("", ["bg", "en"])).toBe("bg");
    expect(preferredLocale(null)).toBe("bg");
  });
});

describe("the dictionaries", () => {
  /** Every key path in a dictionary, so a missing string fails here as well as in tsc. */
  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value === "string"
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
          keys(child, prefix ? `${prefix}.${key}` : key),
        );

  it("give every locale every string, none of them empty", () => {
    const expected = keys(bg).sort();
    for (const locale of LOCALES) {
      const dict = getDictionary(locale);
      expect(keys(dict).sort(), locale).toEqual(expected);
      for (const key of expected) {
        const value = key
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
        expect(String(value).trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("write English in English", () => {
    const english = keys(getDictionary("en")).map((key) =>
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown>)[part],
          getDictionary("en"),
        ),
    );
    for (const value of english) expect(String(value)).not.toMatch(/[А-Яа-я]/);
  });

  it("keep the frame's Bulgarian identical to the sentences the pages print", () => {
    const commerce: CommerceConfig = { ...siteConfig.commerce, freeDeliveryThreshold: "49.00" };
    const figure = toPriceView("49.00", "EUR")!.formatted;
    expect(fill(bg.announcement.freeDelivery, { amount: figure })).toBe(
      freeDeliveryPromise(commerce),
    );

    for (const method of paymentMethods({
      ...commerce,
      paymentMethods: ["cash_on_delivery", "card_on_delivery", "bank_transfer"],
    })) {
      expect(bg.footer.paymentMethods[method.id]).toBe(method.label);
    }

    expect(openingHoursLabel(bg.hours.days)).toBe(siteConfig.contact.hours);
    expect(openingHoursLabel(getDictionary("en").hours.days)).toBe("Mon–Fri, 9:00–18:00");
  });

  it("give the error page the same day names as the frame", () => {
    for (const locale of LOCALES) {
      expect(ERROR_COPY[locale].days).toEqual(getDictionary(locale).hours.days);
    }
  });

  it("fill placeholders without fixing the word order", () => {
    expect(fill(bg.announcement.freeDelivery, { amount: "49 €" })).toBe(
      "Безплатна доставка за поръчки над 49 €",
    );
    expect(fill(getDictionary("en").announcement.freeDelivery, { amount: "€49" })).toBe(
      "Free delivery on orders over €49",
    );
    expect(fill("{a} и {b}", { a: 1 })).toBe("1 и {b}");
    expect(plural(bg.nav.products, 1)).toBe("продукт");
    expect(plural(bg.nav.products, 3)).toBe("продукта");
  });
});

describe("money and numbers, per locale", () => {
  it("format in Bulgarian by default and in English on request", () => {
    expect(toPriceView("9.50", "EUR")?.formatted).toMatch(/^9,50\s€$/);
    expect(toPriceView("9.50", "EUR", "en")?.formatted).toBe("€9.50");
    expect(toPerServingView("0.31", "EUR")?.formatted).toMatch(/^0,31\s€ на чаша$/);
    expect(toPerServingView("0.31", "EUR", { locale: "en" })?.formatted).toBe("€0.31 per cup");
    expect(unitPriceView("10.00", "250", "g", "EUR", "en")?.formatted).toBe("€40.00 / kg");
  });
});

describe("canonical and hreflang", () => {
  const base = siteConfig.url.replace(/\/+$/, "");

  it("declares a self-referencing bg alternate and x-default while Bulgarian ships alone", () => {
    expect(pageAlternates("bg", routes.brands)).toEqual({
      canonical: `${base}/bg/marki`,
      languages: { bg: `${base}/bg/marki`, "x-default": `${base}/bg/marki` },
    });
  });

  it("lists every shipping locale, in its own spelling, once English ships", () => {
    expect(languageAlternates((locale) => href(locale, routes.brands), ["bg", "en"])).toEqual({
      bg: `${base}/bg/marki`,
      en: `${base}/en/brands`,
      "x-default": `${base}/en/brands`,
    });
  });
});
