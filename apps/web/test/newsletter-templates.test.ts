import { describe, expect, it } from "vitest";
import { siteConfig } from "@/config/site";
import { parseMarkdown } from "@/emails/markdown";
import { draftReadyNotice } from "@/lib/mail/newsletter-notices";
import { composeNotificationEmail } from "@/lib/mail/notify-sink";
import { checkDeliverability } from "@/lib/newsletter/deliverability";
import {
  dayWords,
  lastDay,
  monthName,
  periodMonthName,
  rangeWords,
  sofiaMonthStart,
  sofiaPeriod,
} from "@/lib/newsletter/sofia";
import {
  monthlyLetter,
  promotionLetter,
  type MonthlyInput,
  type TemplatePromotion,
} from "@/lib/newsletter/templates";

/**
 * The letters "Нов бюлетин" starts from, written from data: the same data
 * writes the same letter, its words follow what there is, its products are
 * explicit lists the owner can take apart, its dates are Sofia's days in
 * words, and nothing in it trips the composer's own checks. And the calendar
 * those dates come from, and the notice that tells the owner a month's draft
 * is ready.
 */

/** 1 November 2026, 09:00 in Sofia: when the monthly job runs. */
const NOW = new Date("2026-11-01T07:00:00Z");

/** 27 October to 15 November, as the promotions panel stores a run of Sofia days. */
const AUTUMN: TemplatePromotion = {
  id: "11111111-1111-4111-8111-111111111111",
  label: "Есенни дни",
  percentOff: 10,
  startsAt: new Date("2026-10-26T22:00:00Z"),
  endsAt: new Date("2026-11-15T22:00:00Z"),
};

const monthly = (input: Partial<MonthlyInput>) =>
  monthlyLetter({ now: NOW, newArrivals: [], reduced: [], promotions: [], ...input });

/** The product lines of a body, as the letter reads them. */
const productLines = (body: string) =>
  parseMarkdown(body).flatMap((block) => (block.type === "products" ? [block.token] : []));

const checks = (letter: { subject: string; preheader: string; body: string }) =>
  checkDeliverability({ ...letter, images: 0, files: 0, blocks: null }).map((note) => note.id);

describe("the Sofia calendar", () => {
  it("puts an instant in the month Sofia is in, across the month's last hours in UTC", () => {
    // 31 October 23:59 and 1 November 00:30 in Sofia (UTC+2 after the clocks went back).
    expect(sofiaPeriod(new Date("2026-10-31T21:59:00Z"))).toBe("2026-10");
    expect(sofiaPeriod(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11");
    // Summer time: 1 July begins at 21:00 UTC.
    expect(sofiaPeriod(new Date("2026-06-30T21:00:00Z"))).toBe("2026-07");
    expect(sofiaPeriod(new Date("2026-06-30T20:59:59Z"))).toBe("2026-06");
  });

  it("knows when a Sofia month began, in winter and in summer", () => {
    expect(sofiaMonthStart(new Date("2026-11-15T10:00:00Z")).toISOString()).toBe(
      "2026-10-31T22:00:00.000Z",
    );
    expect(sofiaMonthStart(new Date("2026-07-15T10:00:00Z")).toISOString()).toBe(
      "2026-06-30T21:00:00.000Z",
    );
    // October began in summer time and ends in winter time.
    expect(sofiaMonthStart(new Date("2026-10-31T21:00:00Z")).toISOString()).toBe(
      "2026-09-30T21:00:00.000Z",
    );
  });

  it("names months and days as a sentence writes them", () => {
    expect(monthName(NOW)).toBe("ноември");
    expect(periodMonthName("2026-01")).toBe("януари");
    expect(dayWords(new Date("2026-11-15T12:00:00Z"))).toBe("15 ноември");
  });

  it("tells a promotion's last day: the day before the instant it ends", () => {
    // Ends at 16 November 00:00 in Sofia: its last day is the 15th.
    expect(dayWords(lastDay(AUTUMN.endsAt))).toBe("15 ноември");
    // In summer time too.
    expect(dayWords(lastDay(new Date("2026-07-16T21:00:00Z")))).toBe("16 юли");
  });

  it("writes a run of days in the fewest words", () => {
    const day = (iso: string) => new Date(iso);
    expect(rangeWords(day("2026-10-31T22:00:00Z"), day("2026-11-15T22:00:00Z"))).toBe(
      "от 1 до 15 ноември",
    );
    expect(rangeWords(day("2026-10-27T22:00:00Z"), day("2026-11-03T22:00:00Z"))).toBe(
      "от 28 октомври до 3 ноември",
    );
    expect(rangeWords(day("2026-12-27T22:00:00Z"), day("2027-01-03T22:00:00Z"))).toBe(
      "от 28 декември 2026 до 3 януари 2027",
    );
    expect(rangeWords(day("2026-11-14T22:00:00Z"), day("2026-11-15T22:00:00Z"))).toBe(
      "на 15 ноември",
    );
  });
});

describe("the monthly letter", () => {
  it("names the month, and says both when there are new products and promotions", () => {
    const letter = monthly({
      newArrivals: ["nov-1", "nov-2"],
      reduced: ["minus-1"],
      promotions: [AUTUMN],
    });
    expect(letter.subject).toBe("Новото в магазина през ноември: нови продукти и промоции");
    expect(letter.preheader).toBe(
      "Какво пристигна наскоро и какво е с намалена цена сега. Промоцията важи до 15 ноември включително.",
    );
    // An opening that names no section: a section can vanish by the send.
    expect(letter.body.split("\n\n").slice(0, 2)).toEqual([
      "Здравейте,",
      "Ето какво е новото в магазина през ноември.",
    ]);
    // Each list right under its heading, so an emptied section goes with its heading.
    expect(letter.body).toContain("## Ново в магазина\n\n[[продукти: nov-1, nov-2]]");
    // The promotion by its words and its last day; no figure — each badge says its own.
    expect(letter.body).toContain(
      "## Промоции\n\n**Есенни дни** — намалени цени до 15 ноември включително.\n\n[[промоции: minus-1]]",
    );
    expect(letter.body).not.toMatch(/\d+\s*%/);
    expect(letter.body.endsWith(`Поздрави,\n${siteConfig.name}`)).toBe(true);
    expect(letter.body).toContain(siteConfig.contact.phone);
  });

  it("writes the new arrivals as lists to take apart, and the reductions as reductions to check", () => {
    const letter = monthly({ newArrivals: ["nov-1", "nov-2"], reduced: ["minus-1"] });
    expect(productLines(letter.body).map((token) => token.spec)).toEqual([
      { kind: "picked", slugs: ["nov-1", "nov-2"] },
      { kind: "reduced", slugs: ["minus-1"] },
    ]);
  });

  it("finds room for up to twelve new arrivals, in blocks of six", () => {
    const arrivals = Array.from({ length: 12 }, (_, index) => `nov-${index + 1}`);
    const letter = monthly({ newArrivals: arrivals });
    expect(productLines(letter.body).map((token) => token.spec)).toEqual([
      { kind: "picked", slugs: arrivals.slice(0, 6) },
      { kind: "picked", slugs: arrivals.slice(6) },
    ]);
  });

  it("links the promotions page plainly: the letter adds its campaign when it is drawn", () => {
    const letter = monthly({ reduced: ["minus-1"], promotions: [AUTUMN] });
    const link = /\[страницата с промоциите\]\((https?:\/\/[^)]+)\)/.exec(letter.body)?.[1];
    expect(link).toBeTruthy();
    const url = new URL(link!);
    expect(url.pathname).toBe("/bg/promotsii");
    expect(url.search).toBe("");
    // And the letter's parser reads it as a link, not as text.
    expect(JSON.stringify(parseMarkdown(letter.body))).toContain('"type":"link"');
  });

  it("speaks only of new products when nothing is reduced", () => {
    const letter = monthly({ newArrivals: ["nov-1"] });
    expect(letter.subject).toBe("Новите продукти в магазина през ноември");
    expect(letter.preheader).toBe("Какво пристигна в магазина наскоро.");
    expect(letter.body).toContain("Ето какво е новото в магазина през ноември.");
    expect(letter.body).not.toContain("## Промоции");
    expect(letter.body).not.toContain("промоциите");
  });

  it("speaks only of the promotions when nothing is new, and of a reduction without a promotion", () => {
    const letter = monthly({ reduced: ["minus-1", "minus-2"] });
    expect(letter.subject).toBe("Промоциите в магазина през ноември");
    expect(letter.preheader).toBe("Какво е с намалена цена сега.");
    expect(letter.body).not.toContain("## Ново в магазина");
    // The source's own reductions, with no promotion of the shop's to name.
    expect(letter.body).toContain("## Промоции\n\nТези продукти са с намалена цена в момента.");
  });

  it("lists several promotions, each with its last day, and names none in the preheader", () => {
    const letter = monthly({
      reduced: ["minus-1"],
      promotions: [
        AUTUMN,
        {
          ...AUTUMN,
          id: "2",
          label: null,
          percentOff: 15,
          endsAt: new Date("2026-11-30T22:00:00Z"),
        },
      ],
    });
    expect(letter.body).toContain(
      "- **Есенни дни** — намалени цени до 15 ноември включително.\n- Намалени цени до 30 ноември включително.",
    );
    expect(letter.preheader).toBe("Какво е с намалена цена сега.");
  });

  it("says a one-day promotion's day, without 'включително'", () => {
    const oneDay = {
      ...AUTUMN,
      startsAt: new Date("2026-11-14T22:00:00Z"),
      endsAt: new Date("2026-11-15T22:00:00Z"),
    };
    const letter = monthly({ reduced: ["minus-1"], promotions: [oneDay] });
    expect(letter.body).toContain("**Есенни дни** — намалени цени на 15 ноември.");
    expect(letter.preheader).toContain("Промоцията важи на 15 ноември.");
    expect(`${letter.body} ${letter.preheader}`).not.toContain("включително");
  });

  it("is a greeting and a sign-off when there is nothing to announce", () => {
    const letter = monthly({});
    expect(letter.subject).toBe("Бюлетин за ноември");
    expect(letter.preheader).toBe("");
    expect(productLines(letter.body)).toEqual([]);
    expect(letter.body.split("\n\n")[0]).toBe("Здравейте,");
  });

  it("keeps a label's own characters as text", () => {
    const letter = monthly({
      reduced: ["minus-1"],
      promotions: [{ ...AUTUMN, label: "Черен *петък* [онлайн]" }],
    });
    expect(letter.body).toContain("**Черен \\*петък\\* \\[онлайн\\]**");
    const paragraph = parseMarkdown(letter.body).find(
      (block) => block.type === "paragraph" && JSON.stringify(block).includes("петък"),
    );
    expect(JSON.stringify(paragraph)).toContain("Черен *петък* [онлайн]");
  });

  it("is the same letter for the same data, and trips none of the composer's checks", () => {
    const input = { newArrivals: ["nov-1"], reduced: ["minus-1"], promotions: [AUTUMN] };
    expect(monthly(input)).toEqual(monthly(input));
    expect(checks(monthly(input))).toEqual([]);
  });
});

describe("a promotion's letter", () => {
  it("announces a running promotion with its reduction, until its last day", () => {
    const letter = promotionLetter({ now: NOW, promotion: AUTUMN, members: ["a", "b"] });
    expect(letter.subject).toBe("Есенни дни: −10% до 15 ноември");
    expect(letter.preheader).toBe(
      "Цените на продуктите в промоцията са намалени с 10% до 15 ноември включително.",
    );
    expect(letter.body).toContain(
      "**Есенни дни** — до 15 ноември включително цените на продуктите по-долу са намалени с 10%.",
    );
    expect(productLines(letter.body).map((token) => token.spec)).toEqual([
      { kind: "picked", slugs: ["a", "b"] },
    ]);
    expect(letter.body).toMatch(
      /Всички продукти в промоцията са на \[страницата с промоциите\]\(https?:\/\/[^)]+\/bg\/promotsii\)\./,
    );
    expect(checks(letter)).toEqual([]);
  });

  it("announces an upcoming one by its days alone: no figure, nothing in the present tense", () => {
    const upcoming: TemplatePromotion = {
      ...AUTUMN,
      label: null,
      percentOff: 15,
      startsAt: new Date("2026-11-04T22:00:00Z"),
      endsAt: new Date("2026-11-20T22:00:00Z"),
    };
    const letter = promotionLetter({ now: NOW, promotion: upcoming, members: ["a"] });
    expect(letter.subject).toBe("Намалени цени от 5 до 20 ноември");
    expect(letter.preheader).toBe(
      "Намалени цени на избрани продукти от 5 до 20 ноември включително.",
    );
    expect(letter.body).toContain(
      "\n\nНамалени цени на продуктите по-долу от 5 до 20 ноември включително.",
    );
    expect(letter.body).toContain("Всички продукти в промоцията — на [");
    for (const text of [letter.subject, letter.preheader, letter.body]) {
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/\bса намалени\b/);
    }
  });

  it("writes a one-day promotion as its day, and a run across two months", () => {
    const oneDay: TemplatePromotion = {
      ...AUTUMN,
      startsAt: new Date("2026-10-31T22:00:00Z"),
      endsAt: new Date("2026-11-01T22:00:00Z"),
    };
    const today = promotionLetter({ now: NOW, promotion: oneDay, members: ["a"] });
    expect(today.subject).toBe("Есенни дни: −10% на 1 ноември");
    expect(`${today.subject} ${today.preheader} ${today.body}`).not.toContain("включително");

    const across: TemplatePromotion = {
      ...AUTUMN,
      startsAt: new Date("2026-11-27T22:00:00Z"),
      endsAt: new Date("2026-12-03T22:00:00Z"),
    };
    const letter = promotionLetter({ now: NOW, promotion: across, members: [] });
    expect(letter.subject).toBe("Есенни дни: намалени цени от 28 ноември до 3 декември");
    expect(productLines(letter.body)).toEqual([]);
  });

  it("takes no more than a block holds", () => {
    const letter = promotionLetter({
      now: NOW,
      promotion: AUTUMN,
      members: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    const spec = productLines(letter.body)[0]!.spec;
    expect(spec).toEqual({ kind: "picked", slugs: ["a", "b", "c", "d", "e", "f"] });
  });
});

describe("the owner's notice of a prepared letter", () => {
  const notice = draftReadyNotice({
    id: "22222222-2222-4222-8222-222222222222",
    period: "2026-11",
    newProducts: 3,
    reducedProducts: 1,
  });

  it("says which month, what is in it, and that nothing has gone to anybody", () => {
    expect(notice.kind).toBe("newsletter_draft");
    expect(notice.subject).toBe("Бюлетинът за ноември е готов за преглед");
    expect(notice.summary).toContain("3 нови продукта и 1 намален продукт");
    expect(notice.summary).toContain("Нищо не е изпратено на абонатите.");
  });

  it("links to the draft itself, absolute, and says nothing about contact details", async () => {
    const { text, html } = await composeNotificationEmail(notice);
    expect(text).toMatch(/https?:\/\/\S+\/admin\/byuletin\/22222222-2222-4222-8222-222222222222/);
    expect(html).toContain("/admin/byuletin/22222222-2222-4222-8222-222222222222");
    expect(text).not.toContain("Данните за контакт");
  });
});
