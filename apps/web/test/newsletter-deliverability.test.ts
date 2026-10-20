import { describe, expect, it } from "vitest";
import {
  CHARS_PER_IMAGE,
  LETTER_MAX_BYTES,
  LETTER_WARN_BYTES,
  MAX_LINKS,
  MIN_PROSE_CHARS,
  checkDeliverability,
  proseOf,
  shoutedWords,
  spamPhrasesIn,
  type DeliverabilityInput,
} from "@/lib/newsletter/deliverability";
import type { BlockReport } from "@/lib/newsletter/product-blocks";

/**
 * "Преди изпращане": the rules that warn the owner, as they type, about what
 * is likely to send a letter to spam — or to be cut off by Gmail. What is
 * pinned is when each note appears and when it does not, including the cases
 * a first version got wrong: a brand in capitals read as shouting, an honest
 * "безплатна доставка" read as spam, the short letter the signup form
 * promises read as too short, three product blocks read as too many links.
 */

const PROSE =
  "Здравейте! Този месец в магазина пристигнаха три нови марки кафе на зърна и още капсули за Dolce Gusto. " +
  "Опитахме ги в офиса: Vandino е плътно и шоколадово, Eurocaf е по-леко и с повече киселинност, а капсулите " +
  "Rema са добър избор за всеки ден. Ако не сте сигурни кое е за вашата машина, обадете ни се.";

const card = (title: string, detail: string | null = "Кафе на зърна, 1 кг") => ({
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  title,
  detail,
  price: "24,70 €",
  perCup: "≈ 0,17 € на чаша",
});

const report = (
  token: string,
  kind: BlockReport["kind"],
  products: BlockReport["products"],
  missing: string[] = [],
): BlockReport => ({ token, kind, products, missing });

const healthy: DeliverabilityInput = {
  subject: "Новите кафета на октомври",
  preheader: "Три нови марки на зърна и капсули за Dolce Gusto.",
  body: `${PROSE}\n\n[[промоции]]`,
  images: 1,
  files: 0,
  blocks: [
    report("[[промоции]]", "sale", [
      card("Eurocaf Crema Vivace"),
      card("Rema Caffè Arabica Gold", "Капсули за Dolce Gusto, 16 бр."),
    ]),
  ],
};

const ids = (input: DeliverabilityInput) => checkDeliverability(input).map((note) => note.id);
const note = (input: DeliverabilityInput, id: string) =>
  checkDeliverability(input).find((item) => item.id === id);

describe("a letter written the way the shop should write one", () => {
  it("gets no notes", () => {
    expect(PROSE.length).toBeGreaterThan(MIN_PROSE_CHARS);
    expect(checkDeliverability(healthy)).toEqual([]);
  });

  it("includes the short letter the signup form promises: a sentence and the new products", () => {
    const promised: DeliverabilityInput = {
      subject: "Ново в магазина",
      preheader: "Четири нови кафета този месец.",
      body: "Здравейте, ето кафетата, които пристигнаха в магазина този месец.\n\n[[нови-продукти]]",
      images: 0,
      files: 0,
      blocks: [
        report("[[нови-продукти]]", "new", [
          card("Vergnano Antica Bottega"),
          card("Kimbo Barista Napoli"),
          card("Lavazza Delizioso", "Капсули Lavazza A Modo Mio, 36 бр."),
          card("illy Classico", "Кафе на зърна, 250 г"),
        ]),
      ],
    };
    expect(checkDeliverability(promised)).toEqual([]);
  });
});

describe("the words and the pictures", () => {
  it("counts only the owner's own words as prose: no addresses, image lines or product blocks", () => {
    expect(
      proseOf(
        "## Ново\n\nВижте https://buy-a-coffee.com/bg/promotsii и [страницата](https://x.example/a).\n\n" +
          "https://buy-a-coffee.com/media/newsletter/a.jpg\n\n![снимка](https://x.example/a.jpg)\n\n" +
          "[[промоции]]\n\n- **едно**\n- *две*",
      ),
    ).toBe("Ново Вижте и страницата. едно две");
  });

  it("warns when there is too little text, counting what the product cards say", () => {
    const bare = note(
      { ...healthy, body: "Голямо намаление на кафето тази седмица — заповядайте!", blocks: [] },
      "short-text",
    );
    expect(bare?.detail).toMatch(/около 54 знака/);
    expect(bare?.detail).toContain(String(MIN_PROSE_CHARS));

    // The same sentence with one card is still short; with four it is a letter.
    const sentence = "Голямо намаление на кафето тази седмица — заповядайте!\n\n[[промоции]]";
    const one = [report("[[промоции]]", "sale", [card("Eurocaf Crema Vivace")])];
    expect(ids({ ...healthy, body: sentence, blocks: one })).toContain("short-text");
    const four = [
      report(
        "[[промоции]]",
        "sale",
        ["Eurocaf Crema Vivace", "Kimbo Aroma Gold", "Lavazza Super Crema", "illy Classico"].map(
          (title) => card(title),
        ),
      ),
    ];
    expect(ids({ ...healthy, body: sentence, blocks: four })).not.toContain("short-text");
  });

  it("says plainly when the letter is a picture and nothing else", () => {
    const notes = ids({ ...healthy, body: "Намаление!", blocks: [], images: 1 });
    expect(notes).toContain("single-image");
    // Not the same thing said three times.
    expect(notes).not.toContain("short-text");
    expect(notes).not.toContain("image-heavy");
    expect(note({ ...healthy, body: "Намаление!", blocks: [] }, "single-image")!.detail).toMatch(
      /„Спам“/,
    );
  });

  it("warns when pictures outweigh the words, with the share each gets", () => {
    const heavy = note({ ...healthy, images: 4 }, "image-heavy");
    expect(heavy?.detail).toMatch(new RegExp(`около \\d+ знака.*${CHARS_PER_IMAGE}`));
    expect(ids({ ...healthy, images: 1 })).not.toContain("image-heavy");
  });

  it("does not count a product card as a picture: its thumbnail comes with its own text", () => {
    const cards = report(
      "[[нови-продукти: 6]]",
      "new",
      Array.from({ length: 6 }, (_, index) => card(`Кафе ${index}`, null)),
    );
    expect(
      ids({ ...healthy, body: `${PROSE}\n\n[[нови-продукти: 6]]`, images: 0, blocks: [cards] }),
    ).toEqual([]);
  });
});

describe("a subject in capitals", () => {
  const shouts = (subject: string, names: readonly string[] = []) =>
    shoutedWords(subject, names).shouts;

  it("is a brand's or a line's own spelling, not shouting", () => {
    for (const subject of [
      "Ново LAVAZZA",
      "Lavazza A MODO MIO",
      "NESCAFÉ DOLCE GUSTO",
      "Новото от LAVAZZA и KIMBO",
      "Капсули DG и A Modo Mio",
      "DG",
    ]) {
      expect(shouts(subject), subject).toBe(false);
      expect(ids({ ...healthy, subject }), subject).not.toContain("subject-caps");
    }
  });

  it("knows the catalog's own brands and lines, as the page hands them over", () => {
    expect(shouts("Ново от REMA CAFFE")).toBe(true);
    expect(shouts("Ново от REMA CAFFE", ["REMA", "CAFFE"])).toBe(false);
    expect(shouts("Ново: Caffè Arte CLASSICO", ["Classico"])).toBe(false);
    expect(
      ids({
        ...healthy,
        subject: "Ново от REMA CAFFE",
        capitalised: ["REMA CAFFE", "Rema", "Caffe"],
      }),
    ).not.toContain("subject-caps");
  });

  it("is shouting for any capitalised word of five letters or more, Cyrillic or Latin", () => {
    expect(shoutedWords("ГОЛЯМО намаление")).toEqual({ words: ["ГОЛЯМО"], shouts: true });
    expect(shouts("Кафе SUPER цени")).toBe(true);
    expect(shouts("ГОЛЯМО НАМАЛЕНИЕ!!! Безплатна доставка")).toBe(true);
    expect(shouts("НОВО: Lavazza Crema")).toBe(false);
  });

  it("is shouting when most of the subject's words are capitals", () => {
    expect(shoutedWords("НОВО ОТ LAVAZZA")).toEqual({ words: ["НОВО", "ОТ"], shouts: true });
    expect(shouts("КАФЕ НА ЗЪРНА")).toBe(true);
    expect(shouts("НОВО кафе от Kimbo")).toBe(false);
  });

  it("names the words in the note", () => {
    expect(note({ ...healthy, subject: "ГОЛЯМО намаление" }, "subject-caps")?.detail).toMatch(
      /^„ГОЛЯМО“ — /,
    );
  });
});

describe("the rest of the subject and the preview line", () => {
  it("warns about more than one exclamation mark", () => {
    expect(ids({ ...healthy, subject: "Ново кафе!" })).not.toContain("subject-exclamations");
    expect(ids({ ...healthy, subject: "Ново кафе!!" })).toContain("subject-exclamations");
    expect(ids({ ...healthy, subject: "Ново! Кафе!" })).toContain("subject-exclamations");
  });

  it("leaves an honest free delivery alone", () => {
    for (const subject of [
      "Безплатна доставка над 50 €",
      "безплатна доставка за всички поръчки",
      "Free shipping over 50 €",
    ]) {
      expect(spamPhrasesIn(subject), subject).toEqual([]);
      expect(ids({ ...healthy, subject }), subject).not.toContain("subject-phrases");
    }
  });

  it("names the spam phrases it finds, in either language, as whole words", () => {
    expect(spamPhrasesIn("Безплатно!")).toEqual(["безплатно"]);
    expect(spamPhrasesIn("100% безплатно кафе")).toEqual(["безплатно"]);
    expect(spamPhrasesIn("Спечелете кафемашина — само днес")).toEqual(["спечелете", "само днес"]);
    expect(spamPhrasesIn("Кликнете тук за $$$")).toEqual(["кликнете тук", "$$$"]);
    expect(spamPhrasesIn("FREE coffee, click here")).toEqual(["free", "click here"]);
    expect(spamPhrasesIn("100% гаранция за качество")).toEqual(["100% гаранция"]);
    expect(spamPhrasesIn("100% арабика от Етиопия")).toEqual([]);
    expect(spamPhrasesIn("Freedom roast")).toEqual([]);
    const found = note({ ...healthy, subject: "Спечелете безплатно кафе" }, "subject-phrases");
    expect(found?.detail).toContain("„спечелете“, „безплатно“");
  });

  it("warns when there is no preheader", () => {
    expect(ids({ ...healthy, preheader: "  " })).toContain("no-preheader");
  });
});

describe("links", () => {
  const links = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `- [Кафе ${index}](https://x.example/${index})`,
    ).join("\n");

  it("count a product block as one, however many cards it has", () => {
    const three = ["[[продукти: a]]", "[[нови-продукти: 6]]", "[[промоции: 6]]"];
    const blocks = [
      report(three[0]!, "picked", [card("A")]),
      report(
        three[1]!,
        "new",
        Array.from({ length: 6 }, (_, index) => card(`Ново ${index}`)),
      ),
      report(
        three[2]!,
        "sale",
        Array.from({ length: 6 }, (_, index) => card(`Намалено ${index}`)),
      ),
    ];
    // Twelve links of the owner's and three full blocks: fifteen.
    expect(
      ids({ ...healthy, body: `${PROSE}\n\n${links(12)}\n\n${three.join("\n\n")}`, blocks }),
    ).not.toContain("many-links");
    expect(
      note(
        { ...healthy, body: `${PROSE}\n\n${links(13)}\n\n${three.join("\n\n")}`, blocks },
        "many-links",
      )?.detail,
    ).toMatch(new RegExp(`около 16 адреса.*${MAX_LINKS}`));
  });

  it("count the files, and an address once however often it is linked", () => {
    expect(
      ids({ ...healthy, body: `${PROSE}\n\n${links(14)}\n\n[[промоции]]`, files: 1 }),
    ).toContain("many-links");
    const same = Array.from({ length: 20 }, () => "[тук](https://x.example/a)").join(" ");
    expect(ids({ ...healthy, body: `${PROSE}\n\n${same}` })).not.toContain("many-links");
  });
});

describe("size", () => {
  it("warns near Gmail's clipping point, and says past the limit the send will not start", () => {
    expect(ids({ ...healthy, htmlBytes: LETTER_WARN_BYTES })).not.toContain("too-large");
    const near = note({ ...healthy, htmlBytes: 95_000 }, "too-large");
    expect(near?.title).toBe("Писмото е близо до границата на Gmail");
    expect(near?.detail).toMatch(
      /Около 95 KB.*102 KB.*отписване.*Над 100 KB изпращането няма да започне/,
    );
    const over = note({ ...healthy, htmlBytes: LETTER_MAX_BYTES + 1 }, "too-large");
    expect(over?.title).toBe("Писмото е твърде голямо");
    expect(over?.detail).toContain("Над 100 KB изпращането не започва.");
    expect(ids({ ...healthy, htmlBytes: null })).not.toContain("too-large");
  });
});

describe("product blocks", () => {
  const withBlock = (token: string, blockReport: BlockReport | null) =>
    checkDeliverability({
      ...healthy,
      body: `${PROSE}\n\n${token}`,
      blocks: blockReport ? [blockReport] : [],
    });

  it("warns about a section that resolved to nothing, saying why for its kind, and lets it go", () => {
    const empty = (kind: BlockReport["kind"], token: string, missing: string[] = []) =>
      withBlock(token, report(token, kind, [], missing)).find((item) => item.id === "block-empty");

    const sale = empty("sale", "[[промоции]]");
    expect(sale?.title).toBe("Секцията „Промоции“ е празна и няма да се покаже");
    expect(sale?.detail).toMatch(/няма продукти с намалена цена/);
    expect(sale?.detail).toContain("Писмото може да се изпрати и така.");
    expect(sale?.blocksSend).toBeUndefined();
    expect(empty("new", "[[нови-продукти]]")?.detail).toMatch(/последните 30 дни/);
    expect(empty("picked", "[[продукти: a-b, c-d]]")?.title).toBe(
      "Секцията „Избрани продукти“ е празна и няма да се покаже",
    );
    // Addresses that name nothing still stop it, beside the warning.
    const notes = withBlock(
      "[[продукти: a-b, c-d]]",
      report("[[продукти: a-b, c-d]]", "picked", [], ["a-b", "c-d"]),
    );
    expect(notes.find((item) => item.id === "block-missing")).toMatchObject({ blocksSend: true });
    expect(notes.find((item) => item.id === "block-missing")?.detail).toContain(
      "изпращането не започва",
    );
  });

  it("warns, without stopping, about picked products sold out or withdrawn since", () => {
    const notes = withBlock("[[продукти: ima, gone, spryan]]", {
      ...report("[[продукти: ima, gone, spryan]]", "picked", [card("Има")]),
      soldOut: [{ slug: "gone", title: "Lavazza Oro" }],
      gone: ["spryan"],
    });
    const soldOut = notes.find((item) => item.id === "block-sold-out");
    expect(soldOut?.title).toBe("Изчерпан продукт ще бъде пропуснат");
    expect(soldOut?.detail).toMatch(/^„Lavazza Oro“ — изчерпан е и няма да се покаже/);
    expect(soldOut?.blocksSend).toBeUndefined();
    expect(notes.find((item) => item.id === "block-gone")?.detail).toMatch(
      /^„spryan“ — вече не е в магазина/,
    );
    expect(notes.some((item) => item.blocksSend)).toBe(false);
  });

  it("names the hand-picked addresses that are no product's, which stop a send", () => {
    const missing = withBlock(
      "[[продукти: ima, nyama]]",
      report("[[продукти: ima, nyama]]", "picked", [card("Има")], ["nyama"]),
    ).find((item) => item.id === "block-missing");
    expect(missing?.detail).toMatch(/^„nyama“ не е адрес на продукт в магазина/);
    expect(missing?.blocksSend).toBe(true);

    const invalid = withBlock(
      "[[продукти: ima, Лаваца]]",
      report("[[продукти: ima, Лаваца]]", "picked", [card("Има")]),
    ).find((item) => item.id === "block-invalid");
    expect(invalid?.detail).toMatch(/^„Лаваца“ — това не е адрес на продукт/);
  });

  it("explains a line it cannot read, and what it adjusted in one it could", () => {
    const notes = checkDeliverability({
      ...healthy,
      body: `${PROSE}\n\n[[промоций]]\n\n[[промоции: 9]]`,
      blocks: null,
    });
    expect(notes.find((item) => item.id === "block-unreadable")?.detail).toMatch(
      /Непознат блок.*изпращането не започва/,
    );
    expect(notes.find((item) => item.id === "block-adjusted")?.detail).toBe(
      "Показват се най-много 6.",
    );
  });

  it("names a block past the letter's twelve products, which is not drawn", () => {
    const body = `${PROSE}\n\n[[нови-продукти: 6]]\n\n[[промоции: 6]]\n\n[[продукти: a]]`;
    const notes = checkDeliverability({ ...healthy, body, blocks: null });
    expect(notes.filter((item) => item.id === "block-over-cap").map((item) => item.title)).toEqual([
      "Блокът [[продукти: a]] не се показва",
    ]);
  });

  it("pairs reports with the blocks drawn, past one that is not", () => {
    // The unreadable line draws nothing and has no report; the next one has the first.
    const notes = checkDeliverability({
      ...healthy,
      body: `${PROSE}\n\n[[промоций]]\n\n[[промоции]]`,
      blocks: [report("[[промоции]]", "sale", [])],
    });
    expect(notes.map((item) => item.id)).toEqual(["block-unreadable", "block-empty"]);
  });

  it("waits for the preview rather than guess about a block it has no answer for", () => {
    expect(
      ids({ ...healthy, body: `${PROSE}\n\n[[нови-продукти]]`, blocks: healthy.blocks }),
    ).not.toContain("block-empty");
  });
});
