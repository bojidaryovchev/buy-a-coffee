import { parseMarkdown, type Inline, type ProductsBlock } from "@/emails/markdown";
import { claimNotes, type PromotionFacts } from "./claims";
import type { BlockReport } from "./product-blocks";
import { drawnBlocks } from "./sections";
import { dayWords, daysBetween } from "./sofia";
import {
  MAX_LETTER_PRODUCTS,
  NEW_PRODUCTS_DAYS,
  planTokens,
  type ProductBlockKind,
  type ProductToken,
} from "./tokens";

/**
 * "Преди изпращане": what about a letter is likely to send it to "Спам", said
 * to the owner while they write it.
 *
 * Advice, with exceptions that are about the letter arriving whole rather
 * than about spam: a letter over `LETTER_MAX_BYTES`, a product line that is
 * not the letter the owner meant (`blockProblems` in `product-blocks.ts`) and
 * a letter with nothing in it stop a send (`actions.ts`); those notes carry
 * `blocksSend` and say so. What only shortens the letter — a section left
 * empty, a picked product sold out since — is a warning, and so is a letter
 * within a month of the last one: the signup promises one a month at most.
 * Every other rule is one the filters at Gmail,
 * Outlook and abv.bg are known to weigh, worded as what to do and why. The
 * owner's own letters taught the first ones: a picture and one promotional
 * sentence went to spam, read by the filters as an advertisement with nothing
 * to read.
 *
 *   - too little text: under about 250 characters, counting the owner's own
 *     words and what the product cards say (name, pack, price), not counting
 *     addresses or image lines;
 *   - pictures outweighing the words: fewer than about 200 characters of text
 *     per picture across the sheet, or a letter that is a picture and nothing
 *     else. A product card's photograph is a 112 px thumbnail beside its own
 *     text, and is not counted as a picture;
 *   - a subject that shouts — a word of five or more letters in capitals, or
 *     mostly capitalised words — unless the capitals are a brand's or a line's
 *     own spelling ("LAVAZZA", "A MODO MIO", `capitalised`); more than one
 *     "!"; the phrases spam is written in ("безплатно", "спечелете"), but not
 *     an honest "безплатна доставка";
 *   - no preheader, so the inbox shows whatever the body starts with;
 *   - more than about 15 links, a product block counting as one;
 *   - a letter over about 90 KB, which Gmail is close to cutting off;
 *   - a product block that cannot be read, names an address that is no
 *     product's, or is past the letter's twelve products (each stops a
 *     send); one that shows nothing, or leaves out a product sold out or
 *     withdrawn since it was picked (warnings);
 *   - a letter within a month of the last (a warning);
 *   - what the letter says about the shop's promotions: a promotion's letter
 *     before the promotion runs or after it ended, a product whose badge
 *     cannot carry the announced percentage, a promotion named in words that
 *     has ended (each stops a send; `claims.ts`).
 *
 * Pure: the composer runs it on every keystroke, and the send confirmation
 * shows the same list. What needs the server — the blocks' products, the
 * rendered size, the catalog's names — comes in from the last preview and
 * the page.
 */

export const MIN_PROSE_CHARS = 250;
export const CHARS_PER_IMAGE = 200;
export const MAX_LINKS = 15;

/** Past this the composer warns; Gmail clips a message's HTML at about 102 KB. */
export const LETTER_WARN_BYTES = 90_000;
/** Past this a send does not start: the unsubscribe footer would be cut off. */
export const LETTER_MAX_BYTES = 100_000;

/**
 * Names that are written in capitals by their owners, beyond the catalog's
 * own brands and lines (`listCapitalisedNames`, read by the page): the
 * coffee systems and the household names a subject about them would use.
 */
export const KNOWN_CAPITALISED_NAMES: readonly string[] = [
  "NESCAFÉ",
  "NESPRESSO",
  "VERTUO",
  "DOLCE",
  "GUSTO",
  "MODO",
  "MIO",
  "TASSIMO",
  "CAFFITALY",
  "IPERESPRESSO",
  "KEURIG",
  "ESE",
  "ILLY",
  "LAVAZZA",
  "KIMBO",
  "SEGAFREDO",
  "JACOBS",
  "TCHIBO",
  "DAVIDOFF",
  "STARBUCKS",
  "BIALETTI",
  "DELONGHI",
  "SAECO",
  "PHILIPS",
  "KRUPS",
  "JURA",
  "MELITTA",
  "SIEMENS",
  "NECTA",
];

/**
 * Phrases that read as spam in a subject, in either language the shop's
 * readers get mail in, matched as whole words whatever the case. Short on
 * purpose: words an honest coffee newsletter can do without. "Безплатна
 * доставка" (and "free shipping") is a term of trade, not a lure, and is left
 * alone; "безплатно!" on its own is not.
 */
const SPAM_RULES: readonly RegExp[] = [
  /(?<![\p{L}\p{N}])безплатн\p{L}*(?![\p{L}\p{N}])(?!\s+доставк)/gu,
  /(?<![\p{L}\p{N}])спечел\p{L}*/gu,
  /100\s*%\s*гаранци\p{L}*/gu,
  /(?<![\p{L}\p{N}])гарантиран\p{L}*/gu,
  /(?<![\p{L}\p{N}])(?:кликнете|кликни|натиснете|натисни)\s+тук(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])само\s+днес(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])последен\s+шанс(?![\p{L}\p{N}])/gu,
  /\$\$\$/gu,
  /(?<![\p{L}\p{N}])free(?![\p{L}\p{N}])(?!\s+(?:shipping|delivery))/gu,
  /(?<![\p{L}\p{N}])winner(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])click\s+here(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])act\s+now(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])guaranteed(?![\p{L}\p{N}])/gu,
];

export type DeliverabilityNoteId =
  | "single-image"
  | "short-text"
  | "image-heavy"
  | "subject-caps"
  | "subject-exclamations"
  | "subject-phrases"
  | "no-preheader"
  | "many-links"
  | "too-large"
  | "block-unreadable"
  | "block-over-cap"
  | "block-invalid"
  | "block-empty"
  | "block-missing"
  | "block-sold-out"
  | "block-gone"
  | "block-adjusted"
  | "letter-empty"
  | "recent-letter"
  | "block-not-reduced"
  | "promotion-not-started"
  | "promotion-ended"
  | "promotion-claim";

export interface DeliverabilityNote {
  readonly id: DeliverabilityNoteId;
  /** What is wrong, in a few words. */
  readonly title: string;
  /** Why it matters and what to do, in a sentence or two. */
  readonly detail: string;
  /** The server will not start the send while this holds. Absent: advice, or a warning. */
  readonly blocksSend?: true;
}

/** The signup promises a letter a month at most; within this, the composer says so. */
export const LETTER_INTERVAL_DAYS = 30;

export interface DeliverabilityInput {
  readonly subject: string;
  readonly preheader: string;
  readonly body: string;
  /** Pictures drawn under the text. */
  readonly images: number;
  /** Files linked for download: each one is a link. */
  readonly files: number;
  /** What the body's drawn product blocks resolved to at the last preview; null before it answers. */
  readonly blocks?: readonly BlockReport[] | null;
  /** The rendered letter's size in bytes, from the last preview; null before it answers. */
  readonly htmlBytes?: number | null;
  /** Brand and line names from the catalog, which may be written in capitals. */
  readonly capitalised?: readonly string[];
  /** When the last letter that went out started (`lastLetterStart`); null if none has. */
  readonly lastLetterAt?: Date | string | null;
  /** The promotion this letter announces, when it is a promotion's letter. */
  readonly announced?: PromotionFacts | null;
  /** A promotion's letter whose promotion was deleted before it started. */
  readonly announcedMissing?: boolean;
  /** The promotions the letter names in words (`LetterPlan.promotionIds`). */
  readonly named?: readonly PromotionFacts[];
  /** Now, for the dates above; the clock when absent. */
  readonly now?: Date;
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const IMAGE_SYNTAX = /!\[[^\]\n]*\]\([^)\n]*\)/g;

function words(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return node.value.replace(URL_PATTERN, " ");
        case "break":
          return " ";
        case "strong":
        case "em":
          return words(node.children);
        case "link": {
          const label = words(node.children).trim();
          // A bare address is its own label: it is an address, not words.
          return label === node.href || /^(?:https?:\/\/|www\.)/i.test(label) ? " " : label;
        }
      }
    })
    .join("");
}

/**
 * The letter's own words: headings, paragraphs and list items, without
 * addresses, image lines or product blocks, whitespace collapsed.
 */
export function proseOf(body: string): string {
  return parseMarkdown(body.replace(IMAGE_SYNTAX, " "))
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "paragraph":
          return words(block.children);
        case "list":
          return block.items.map(words).join(" ");
        case "products":
          return "";
      }
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What the product cards say, as a reader reads it: name, pack, price, per cup. */
function cardText(reports: readonly BlockReport[]): number {
  return reports
    .flatMap((report) => report.products)
    .reduce(
      (sum, product) =>
        sum +
        [product.title, product.detail, product.price, product.perCup].filter(Boolean).join(" ")
          .length,
      0,
    );
}

/** Every link the body itself makes, by address. */
export function bodyLinks(body: string): Set<string> {
  const found = new Set<string>();
  const visit = (nodes: readonly Inline[]) => {
    for (const node of nodes) {
      if (node.type === "link") found.add(node.href);
      if (node.type === "link" || node.type === "strong" || node.type === "em") {
        visit(node.children);
      }
    }
  };
  for (const block of parseMarkdown(body)) {
    if (block.type === "heading" || block.type === "paragraph") visit(block.children);
    if (block.type === "list") block.items.forEach(visit);
  }
  return found;
}

/* -- the subject ------------------------------------------------------------ */

const isLetter = (character: string) => /\p{L}/u.test(character);
const isUpper = (letter: string) =>
  letter === letter.toLocaleUpperCase("bg") && letter !== letter.toLocaleLowerCase("bg");

/** A word as it is compared with the names: capitals, no accents ("Nescafé" is "NESCAFE"). */
export function nameKey(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleUpperCase("bg");
}

/**
 * The words of a subject written entirely in capitals that are nobody's
 * name — "ГОЛЯМО", "НОВО" — and whether they shout: one of five letters or
 * more, or most of the subject's words. A brand or a line written the way it
 * is written ("LAVAZZA", "A MODO MIO", "NESCAFÉ DOLCE GUSTO") is not counted
 * at all, and two letters ("DG") are an abbreviation.
 */
export function shoutedWords(
  subject: string,
  capitalised: readonly string[] = [],
): { readonly words: string[]; readonly shouts: boolean } {
  const names = new Set([...KNOWN_CAPITALISED_NAMES, ...capitalised].map(nameKey));
  const lettered = (subject.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).filter((word) =>
    [...word].some(isLetter),
  );
  const loud = lettered.filter((word) => {
    const letters = [...word].filter(isLetter);
    return letters.length >= 2 && letters.every(isUpper) && !names.has(nameKey(word));
  });
  const long = loud.some((word) => [...word].filter(isLetter).length >= 5);
  // Most of the words, and at least two: one short word alone ("DG") is an abbreviation.
  return { words: loud, shouts: long || (loud.length >= 2 && loud.length * 2 > lettered.length) };
}

/** The spam phrases a subject contains, as written there (lower case). */
export function spamPhrasesIn(subject: string): string[] {
  const text = subject.toLocaleLowerCase("bg");
  const found: { at: number; phrase: string }[] = [];
  for (const rule of SPAM_RULES) {
    for (const match of text.matchAll(rule)) {
      found.push({ at: match.index ?? 0, phrase: match[0].replace(/\s+/g, " ") });
    }
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((item) => item.phrase))];
}

/* -- the notes -------------------------------------------------------------- */

const quoted = (items: readonly string[]) => items.map((item) => `„${item}“`).join(", ");

const NOT_SENT = "Докато е в текста, изпращането не започва.";
const HIDDEN =
  "На нейно място в писмото няма да има нищо, а заглавие, под което няма друго, също се скрива. Писмото може да се изпрати и така.";

/** How the composer names each kind of block. */
export const BLOCK_KIND_NAMES: Readonly<Record<ProductBlockKind, string>> = {
  picked: "Избрани продукти",
  new: "Нови продукти",
  sale: "Промоции",
  reduced: "Промоции",
};

/** What a block that resolved to nothing asked for, in a reader's words. */
function emptyBlockDetail(report: BlockReport): string {
  switch (report.kind) {
    case "picked":
      return `Нито един от избраните продукти не може да се поръча сега. ${HIDDEN}`;
    case "new":
      return `Няма нови продукти от последните ${NEW_PRODUCTS_DAYS} дни, които могат да се поръчат. ${HIDDEN}`;
    case "sale":
      return `В момента няма продукти с намалена цена, които могат да се поръчат. ${HIDDEN}`;
    case "reduced":
      return `Нито един от избраните намалени продукти не може да се поръча сега. Секцията им няма да се покаже, заедно с думите за промоцията над тях. Писмото може да се изпрати и така.`;
  }
}

const kilobytes = (bytes: number) => Math.round(bytes / 1000);

/**
 * Each block line with the report that answers for it: the n-th line the
 * letter draws (`planTokens`) is the n-th report, and only if it is that
 * line's — a report for a line since edited answers for nothing.
 */
export function reportsFor(
  tokens: readonly ProductToken[],
  reports: readonly BlockReport[] | null | undefined,
): (BlockReport | null)[] {
  const states = planTokens(tokens);
  let drawn = 0;
  return tokens.map((token, index) => {
    if (states[index] !== "shown") return null;
    const report = reports?.[drawn] ?? null;
    drawn += 1;
    return report && report.token === token.source ? report : null;
  });
}

function blockNotes(
  tokens: readonly ProductToken[],
  reports: readonly BlockReport[] | null | undefined,
): DeliverabilityNote[] {
  const notes: DeliverabilityNote[] = [];
  const states = planTokens(tokens);
  const answers = reportsFor(tokens, reports);
  tokens.forEach((token, index) => {
    const state = states[index];
    if (state === "unreadable") {
      notes.push({
        id: "block-unreadable",
        title: `Блокът ${token.source} не е разпознат`,
        detail: `${token.problem ?? ""} ${NOT_SENT}`.trim(),
        blocksSend: true,
      });
      return;
    }
    if (state === "over-cap") {
      notes.push({
        id: "block-over-cap",
        title: `Блокът ${token.source} не се показва`,
        detail: `Едно писмо показва най-много ${MAX_LETTER_PRODUCTS} продукта, а блоковете над този вече ги изчерпват: с повече писмото става твърде дълго за Gmail. Махнете го или намалете броя в другите. ${NOT_SENT}`,
        blocksSend: true,
      });
      return;
    }
    if (token.notes.length > 0) {
      notes.push({
        id: "block-adjusted",
        title: `Блокът ${token.source}`,
        detail: token.notes.join(" "),
      });
    }
    if (token.invalid.length > 0) {
      notes.push({
        id: "block-invalid",
        title: `Адрес, който не е на продукт, в ${token.source}`,
        detail: `${quoted(token.invalid)} — ${
          token.invalid.length === 1 ? "това не е адрес" : "това не са адреси"
        } на продукт. Поправете или махнете. ${NOT_SENT}`,
        blocksSend: true,
      });
    }
    const report = answers[index];
    if (!report) return;
    if (report.missing.length > 0) {
      notes.push({
        id: "block-missing",
        title: `Непознат продукт в ${token.source}`,
        detail: `${quoted(report.missing)} не ${
          report.missing.length === 1 ? "е адрес" : "са адреси"
        } на продукт в магазина. Поправете адреса или го махнете. ${NOT_SENT}`,
        blocksSend: true,
      });
    }
    const soldOut = report.soldOut ?? [];
    if (soldOut.length > 0) {
      const one = soldOut.length === 1;
      notes.push({
        id: "block-sold-out",
        title: one
          ? "Изчерпан продукт ще бъде пропуснат"
          : "Изчерпани продукти ще бъдат пропуснати",
        detail: `${quoted(soldOut.map((product) => product.title))} — ${
          one ? "изчерпан е и няма да се покаже" : "изчерпани са и няма да се покажат"
        } в писмото. Махнете ${one ? "го" : "ги"} или изберете друг продукт.`,
      });
    }
    const notReduced = report.notReduced ?? [];
    if (notReduced.length > 0) {
      const one = notReduced.length === 1;
      notes.push({
        id: "block-not-reduced",
        title: one ? "Продукт, който вече не е намален" : "Продукти, които вече не са намалени",
        detail: `${quoted(notReduced.map((product) => product.title))} — ${
          one
            ? "в писмото е сред намалените, а вече не е"
            : "в писмото са сред намалените, а вече не са"
        }. Махнете ${one ? "го" : "ги"} или изберете друг намален продукт. ${NOT_SENT}`,
        blocksSend: true,
      });
    }
    const gone = report.gone ?? [];
    if (gone.length > 0) {
      const one = gone.length === 1;
      notes.push({
        id: "block-gone",
        title: one
          ? "Продукт, който вече не се продава, ще бъде пропуснат"
          : "Продукти, които вече не се продават, ще бъдат пропуснати",
        detail: `${quoted(gone)} — ${
          one
            ? "вече не е в магазина и няма да се покаже"
            : "вече не са в магазина и няма да се покажат"
        }. Махнете ${one ? "го" : "ги"} или изберете друг продукт.`,
      });
    }
    if (report.products.length === 0) {
      notes.push({
        id: "block-empty",
        title: `Секцията „${BLOCK_KIND_NAMES[report.kind]}“ е празна и няма да се покаже`,
        detail: emptyBlockDetail(report),
      });
    }
  });
  return notes;
}

/**
 * Would the letter draw nothing at all — no word, no product? Judged only once
 * every block has its answer, or when there are no blocks to wait for.
 */
function drawsNothing(body: string, reports: readonly BlockReport[] | null | undefined): boolean {
  if (!body.trim()) return false;
  const parsed = parseMarkdown(body);
  const lines = parsed.filter((block): block is ProductsBlock => block.type === "products");
  if (lines.length > 0 && reports == null) return false;
  const answers = reportsFor(
    lines.map((line) => line.token),
    reports,
  );
  const answerOf = new Map(lines.map((line, index) => [line, answers[index] ?? null]));
  return (
    drawnBlocks(parsed, (block) => (answerOf.get(block)?.products.length ?? 0) === 0).length === 0
  );
}

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

function timingNotes(input: DeliverabilityInput): DeliverabilityNote[] {
  const notes: DeliverabilityNote[] = [];
  const now = input.now ?? new Date();
  if (input.lastLetterAt) {
    const last = asDate(input.lastLetterAt);
    const days = daysBetween(last, now);
    if (days >= 0 && days < LETTER_INTERVAL_DAYS) {
      const after = new Date(last.getTime() + LETTER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
      notes.push({
        id: "recent-letter",
        title:
          days === 0
            ? "Днес вече е изпратено писмо"
            : `Последното писмо е изпратено преди ${days} ${days === 1 ? "ден" : "дни"}`,
        detail: `Формата за абониране обещава писмо не повече от веднъж месечно, а честите писма карат хората да се отписват. Ако това може да почака, изпратете го след ${dayWords(after)}.`,
      });
    }
  }
  notes.push(
    ...claimNotes({
      announced: input.announced ?? null,
      announcedMissing: input.announcedMissing ?? false,
      named: input.named ?? [],
      products: input.blocks ? input.blocks.flatMap((report) => report.products) : null,
      now,
    }),
  );
  return notes;
}

export function checkDeliverability(input: DeliverabilityInput): DeliverabilityNote[] {
  const notes: DeliverabilityNote[] = [];
  const prose = proseOf(input.body).length;
  const reports = input.blocks ?? [];
  const products = reports.flatMap((report) => report.products);
  const text = prose + cardText(reports);

  /* -- the words and the pictures -- */
  if (input.images > 0 && prose < 40 && products.length === 0) {
    notes.push({
      id: "single-image",
      title: "Писмото е само снимка",
      detail:
        "Писмата, които са предимно снимка, често попадат в „Спам“: филтрите не виждат какво пише на нея, а читател с изключени картинки не вижда нищо. Напишете с няколко изречения какво показва и какво предлагате.",
    });
  } else {
    if (text < MIN_PROSE_CHARS) {
      notes.push({
        id: "short-text",
        title: "Малко текст",
        detail: `В писмото има около ${text} знака текст (с имената и цените на продуктите, без адресите), а е добре да са поне около ${MIN_PROSE_CHARS}. Кратко рекламно изречение изглежда на филтрите като реклама и нищо друго; напишете какво е новото и защо е интересно.`,
      });
    }
    if (input.images > 0 && text / input.images < CHARS_PER_IMAGE) {
      notes.push({
        id: "image-heavy",
        title: "Снимките преобладават",
        detail: `На всяка снимка се падат около ${Math.round(text / input.images)} знака текст, а е добре да са поне ${CHARS_PER_IMAGE}. Писмата, които са предимно снимки, често попадат в „Спам“: добавете текст или махнете някоя снимка.`,
      });
    }
  }

  /* -- the subject and the preview line -- */
  const subject = input.subject.trim();
  const shouting = shoutedWords(subject, input.capitalised);
  if (subject && shouting.shouts) {
    notes.push({
      id: "subject-caps",
      title: "Главни букви в темата",
      detail: `${quoted(shouting.words)} — думи, написани изцяло с главни букви, се четат като викане и са от първите признаци на спам. Пишете темата като изречение; имената на марките могат да останат както се пишат.`,
    });
  }
  if ((subject.match(/!/g) ?? []).length > 1) {
    notes.push({
      id: "subject-exclamations",
      title: "Повече от един удивителен знак в темата",
      detail: "Няколко „!“ в темата са типични за спам. Оставете най-много един.",
    });
  }
  const phrases = spamPhrasesIn(subject);
  if (phrases.length > 0) {
    notes.push({
      id: "subject-phrases",
      title: "Думи, типични за спам, в темата",
      detail: `${quoted(phrases)} — филтрите търсят точно такива думи в темата. Кажете същото с други думи, например какво е новото.`,
    });
  }
  if (!input.preheader.trim()) {
    notes.push({
      id: "no-preheader",
      title: "Няма въведение",
      detail:
        "Без него пощата показва началото на текста след темата. Едно изречение, написано за целта, казва защо писмото си струва отварянето и не изглежда като масова поща.",
    });
  }

  /* -- links: the body's own, the files, and a product block as one -- */
  const links =
    bodyLinks(input.body).size +
    input.files +
    reports.filter((report) => report.products.length > 0).length;
  if (links > MAX_LINKS) {
    notes.push({
      id: "many-links",
      title: "Много връзки",
      detail: `Писмото води към около ${links} адреса (блок с продукти се брои за един), а е добре да са до около ${MAX_LINKS}. Много връзки в едно писмо са признак на спам; оставете най-важните.`,
    });
  }

  /* -- size -- */
  if (input.htmlBytes != null && input.htmlBytes > LETTER_WARN_BYTES) {
    const over = input.htmlBytes > LETTER_MAX_BYTES;
    notes.push({
      ...(over ? { blocksSend: true as const } : {}),
      id: "too-large",
      title: over ? "Писмото е твърде голямо" : "Писмото е близо до границата на Gmail",
      detail: `Около ${kilobytes(input.htmlBytes)} KB. Gmail съкращава писмата над около 102 KB и скрива края им — заедно с връзката за отписване. ${
        over
          ? `Над ${kilobytes(LETTER_MAX_BYTES)} KB изпращането не започва.`
          : `Над ${kilobytes(LETTER_MAX_BYTES)} KB изпращането няма да започне.`
      } Махнете блок с продукти или съкратете текста.`,
    });
  }

  /* -- product blocks -- */
  const tokens = parseMarkdown(input.body).flatMap((block) =>
    block.type === "products" ? [block.token] : [],
  );
  notes.push(...blockNotes(tokens, input.blocks));
  if (drawsNothing(input.body, input.blocks)) {
    notes.push({
      id: "letter-empty",
      title: "Писмото е празно",
      detail: `В него няма нито текст, нито продукти за показване. Напишете какво е новото или добавете продукти. ${NOT_SENT}`,
      blocksSend: true,
    });
  }

  /* -- when it goes out -- */
  notes.push(...timingNotes(input));

  return notes;
}
