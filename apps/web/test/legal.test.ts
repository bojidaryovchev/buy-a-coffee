import { describe, expect, it } from "vitest";
import { siteConfig, type CommerceConfig } from "@/config/site";
import {
  REVIEW_MARKER,
  buildTermsOfService,
  cookiePolicy,
  deliverySection,
  isReviewParagraph,
  legalDocuments,
  openReviewItems,
  paymentSection,
  privacyPolicy,
  settledParagraphs,
  termsOfService,
  withdrawalSection,
  type LegalDocument,
} from "@/content/legal";
import { launchReport, legalPagesFor, run } from "../scripts/check-launch.ts";

const UNSET: CommerceConfig = {
  confirmedByOwner: false,
  freeDeliveryThreshold: null,
  deliveryFee: null,
  deliveryTime: null,
  couriers: [],
  paymentMethods: [],
  returnWindowDays: null,
  returnShippingPaidBy: null,
  openingHours: [],
};

const COMPLETE: CommerceConfig = {
  confirmedByOwner: true,
  freeDeliveryThreshold: "49.00",
  deliveryFee: "5.90",
  deliveryTime: { dispatch: { min: 0, max: 1 }, transit: { min: 1, max: 2 } },
  couriers: ["Куриер А"],
  paymentMethods: ["cash_on_delivery", "bank_transfer"],
  returnWindowDays: 14,
  returnShippingPaidBy: "customer",
  openingHours: [{ from: "monday", to: "friday", opens: "09:00", closes: "18:00" }],
};

const markers = (paragraphs: readonly string[]) => paragraphs.filter(isReviewParagraph);
const section = (document: LegalDocument, heading: string) =>
  document.sections.find((candidate) => candidate.heading === heading);

describe("the review marker", () => {
  it("is recognised only at the start of a paragraph", () => {
    expect(isReviewParagraph(`${REVIEW_MARKER}: нещо`)).toBe(true);
    expect(isReviewParagraph(`Разделите, отбелязани с ${REVIEW_MARKER}`)).toBe(false);
  });

  it("is found in bullets as well as paragraphs", () => {
    const document: LegalDocument = {
      slug: "x",
      title: "x",
      summary: "x",
      needsReview: false,
      sections: [
        { heading: "a", paragraphs: ["готово"], bullets: [`${REVIEW_MARKER}: в списък`] },
        { heading: "b", paragraphs: [`${REVIEW_MARKER}: в абзац`, "готово"] },
      ],
    };
    expect(openReviewItems(document)).toEqual([
      `${REVIEW_MARKER}: в списък`,
      `${REVIEW_MARKER}: в абзац`,
    ]);
  });
});

describe("deliverySection", () => {
  it("states only that delivery is agreed by phone when nothing is configured", () => {
    const delivery = deliverySection(UNSET);
    const text = settledParagraphs(delivery).join(" ");
    expect(text).toContain("Доставяме на територията на България.");
    expect(text).toContain("Цената на доставката ви казваме по телефона");
    expect(text).toContain("Срока на доставката уговаряме с вас по телефона");
    // No amounts and no day counts were invented.
    expect(text).not.toMatch(/\d/);
  });

  it("keeps a marker naming exactly what is still missing", () => {
    const [none] = markers(deliverySection(UNSET).paragraphs);
    expect(none).toContain("цената на доставката;");
    expect(none).toContain("срокът за доставка");

    const [feeOnly] = markers(deliverySection({ ...COMPLETE, deliveryFee: null }).paragraphs);
    expect(feeOnly).toContain("цената на доставката за поръчки под прага");
    expect(feeOnly).not.toContain("срокът за доставка");

    const [timeOnly] = markers(deliverySection({ ...COMPLETE, deliveryTime: null }).paragraphs);
    expect(timeOnly).toContain("срокът за доставка");
    expect(timeOnly).not.toContain("цената на доставката");
  });

  it("is finished text, with no marker, once fee and time are set", () => {
    const delivery = deliverySection(COMPLETE);
    expect(markers(delivery.paragraphs)).toEqual([]);
    const text = delivery.paragraphs.join(" ");
    expect(text).toContain("Пратките изпращаме с Куриер А.");
    expect(text).toMatch(/безплатна за поръчки над 49,00\s€/);
    expect(text).toMatch(/доставката струва 5,90\s€/);
    expect(text).toContain("доставката отнема 1–2 работни дни");
  });

  it("follows a changed threshold", () => {
    const text = deliverySection({ ...COMPLETE, freeDeliveryThreshold: "60.00" }).paragraphs.join(
      " ",
    );
    expect(text).toMatch(/над 60,00\s€/);
    expect(text).not.toContain("49,00");
  });

  it("always says the total is confirmed before the order is accepted", () => {
    for (const commerce of [UNSET, COMPLETE, siteConfig.commerce]) {
      expect(deliverySection(commerce).paragraphs.join(" ")).toContain(
        "преди поръчката да бъде приета",
      );
    }
  });
});

describe("paymentSection", () => {
  it("does not exist when no method is configured", () => {
    expect(paymentSection(UNSET)).toBeNull();
    expect(section(buildTermsOfService(UNSET), "Плащане")).toBeUndefined();
  });

  it("names the configured methods and nothing else", () => {
    const text = paymentSection(COMPLETE)!.paragraphs.join(" ");
    expect(text).toContain("наложен платеж");
    expect(text).toContain("банков превод");
    expect(text).not.toContain("с карта при получаване");
  });
});

describe("withdrawalSection", () => {
  it("states the statutory period even when nothing is configured", () => {
    expect(withdrawalSection(UNSET).paragraphs[0]).toContain("в срок от 14 дни");
  });

  it("follows a longer configured window without touching the refund deadline", () => {
    const paragraphs = withdrawalSection({ ...COMPLETE, returnWindowDays: 30 }).paragraphs;
    expect(paragraphs[0]).toContain("в срок от 30 дни");
    expect(paragraphs.join(" ")).toContain("не по-късно от 14 дни от уведомлението");
  });

  it("keeps the marker while who pays for the return is undecided", () => {
    const open = markers(withdrawalSection(UNSET).paragraphs);
    expect(open.some((paragraph) => paragraph.includes("кой поема разходите за връщане"))).toBe(
      true,
    );
  });

  it("replaces that marker with the answer once it is decided", () => {
    const paragraphs = withdrawalSection({ ...UNSET, returnShippingPaidBy: "merchant" }).paragraphs;
    expect(paragraphs).toContain("Разходите за връщането на стоката са за наша сметка.");
    expect(markers(paragraphs).some((paragraph) => paragraph.includes("кой поема разходите"))).toBe(
      false,
    );
  });

  it("keeps the marker for the withdrawal form, which no config value supplies", () => {
    expect(
      markers(withdrawalSection(COMPLETE).paragraphs).some((paragraph) =>
        paragraph.includes("формуляр за отказ"),
      ),
    ).toBe(true);
  });
});

describe("the terms document", () => {
  it("is generated from the shipped config", () => {
    expect(termsOfService).toEqual(buildTermsOfService(siteConfig.commerce));
  });

  it("puts the generated sections where the hand-written ones were", () => {
    const headings = buildTermsOfService(COMPLETE).sections.map((entry) => entry.heading);
    expect(headings).toEqual([
      "Как работи поръчването",
      "Цени и наличност",
      "Информация за продуктите",
      "Доставка",
      "Плащане",
      "Право на отказ",
      "Кога правото на отказ не важи",
      "Съответствие на стоката и рекламации",
      "Спорове",
      "Контакт",
    ]);
  });

  it("has unique section headings, which the renderer uses as keys", () => {
    for (const document of [...legalDocuments, buildTermsOfService(UNSET)]) {
      const headings = document.sections.map((entry) => entry.heading);
      expect(new Set(headings).size).toBe(headings.length);
      for (const entry of document.sections) {
        expect(new Set(entry.paragraphs).size).toBe(entry.paragraphs.length);
      }
    }
  });

  it("leaves the Article 57 question open whatever the config says", () => {
    const exclusions = section(buildTermsOfService(COMPLETE), "Кога правото на отказ не важи")!;
    expect(markers(exclusions.paragraphs)).toHaveLength(1);
    expect(markers(exclusions.paragraphs)[0]).toContain("член 57");
  });

  it("as shipped, has exactly four open questions", () => {
    // Delivery fee and time; who pays for a return; the withdrawal form; the
    // scope of the Article 57 exclusions.
    expect(openReviewItems(termsOfService)).toHaveLength(4);
  });
});

describe("the delivery page and the terms cannot disagree", () => {
  it("prints the terms' own paragraphs, minus the open questions", () => {
    for (const commerce of [UNSET, COMPLETE, siteConfig.commerce]) {
      const terms = buildTermsOfService(commerce);
      for (const generated of [deliverySection(commerce), withdrawalSection(commerce)]) {
        const inTerms = section(terms, generated.heading)!;
        expect(inTerms).toEqual(generated);
        const shown = settledParagraphs(generated);
        expect(shown.length).toBeGreaterThan(0);
        expect(shown.some(isReviewParagraph)).toBe(false);
        for (const paragraph of shown) expect(inTerms.paragraphs).toContain(paragraph);
      }
    }
  });
});

describe("measurement in the privacy and cookie texts", () => {
  const cookiesText = cookiePolicy.sections.flatMap((entry) => entry.paragraphs).join(" ");
  const privacyCookies = section(privacyPolicy, "Бисквитки")!.paragraphs.join(" ");

  it("no longer promises an update before any measurement is switched on", () => {
    expect(cookiesText).not.toContain("Ако по-късно бъдат добавени аналитични");
    expect(privacyCookies).not.toContain("по подразбиране");
  });

  it("describes cookieless, aggregate measurement on both pages", () => {
    for (const text of [cookiesText, privacyCookies]) {
      expect(text).toContain("обобщено");
      expect(text).toMatch(/не се поставят бисквитки|без бисквитки/);
      expect(text).toContain("не събираме лични данни");
    }
  });

  it("still says visitors get no cookie and no banner", () => {
    expect(cookiesText).toContain("не поставя бисквитки на посетителите си");
    expect(cookiesText).toContain("няма и банер за бисквитки");
    expect(openReviewItems(cookiePolicy)).toEqual([]);
  });
});

describe("check:launch", () => {
  it("fails for the shipped config, and says why", () => {
    const report = launchReport();
    const text = report.blockers.join("\n");
    expect(text).toContain("commerce.confirmedByOwner is false");
    expect(text).toContain("unset term: commerce.deliveryFee");
    expect(text).toContain("unset term: commerce.deliveryTime");
    expect(text).toContain("unset term: commerce.returnShippingPaidBy");
    expect(report.blockers.filter((line) => line.startsWith("/terms renders"))).toHaveLength(4);
    expect(
      run(
        report,
        () => {},
        () => {},
      ),
    ).toBe(1);
  });

  it("lists every reason on its own line", () => {
    const lines: string[] = [];
    const report = launchReport();
    run(
      report,
      () => {},
      (line) => lines.push(line),
    );
    expect(lines).toHaveLength(report.blockers.length + 1);
    for (const blocker of report.blockers) expect(lines).toContain(`  - ${blocker}`);
  });

  it("fails on the confirmation flag alone", () => {
    const report = launchReport({ ...COMPLETE, confirmedByOwner: false }, [cookiePolicy]);
    expect(report.blockers).toEqual([
      expect.stringContaining("commerce.confirmedByOwner is false"),
    ]);
  });

  it("fails on an unset term alone", () => {
    const report = launchReport({ ...COMPLETE, deliveryFee: null }, [cookiePolicy]);
    expect(report.blockers).toEqual([
      "unset term: " + "commerce.deliveryFee — what delivery costs when it is not free",
    ]);
  });

  it("fails on a marker alone, on any legal page", () => {
    const withMarker: LegalDocument = {
      ...cookiePolicy,
      sections: [{ heading: "x", paragraphs: [`${REVIEW_MARKER}: довършете`] }],
    };
    const report = launchReport(COMPLETE, [withMarker]);
    expect(report.blockers).toEqual([expect.stringContaining('/cookies renders a "ЗА ПРЕГЛЕД"')]);
    expect(
      run(
        report,
        () => {},
        () => {},
      ),
    ).toBe(1);
  });

  it("still fails with everything configured, because the terms keep two open questions", () => {
    const report = launchReport(COMPLETE);
    expect(report.blockers).toHaveLength(2);
    expect(report.blockers.join("\n")).toContain("формуляр за отказ");
    expect(report.blockers.join("\n")).toContain("член 57");
  });

  it("passes when nothing is open, and reports an unreviewed document as a note only", () => {
    const settled: LegalDocument = { ...cookiePolicy, slug: "terms", needsReview: true };
    const report = launchReport(COMPLETE, [settled]);
    expect(report.blockers).toEqual([]);
    expect(report.notes).toEqual([expect.stringContaining("/terms still shows its draft notice")]);

    const out: string[] = [];
    expect(
      run(
        report,
        (line) => out.push(line),
        () => {},
      ),
    ).toBe(0);
    expect(out.join("\n")).toContain("check:launch passed");
  });

  it("checks all three legal pages by default", () => {
    expect(legalPagesFor(COMPLETE).map((document) => document.slug)).toEqual([
      "privacy",
      "terms",
      "cookies",
    ]);
  });
});
