import { GRAMS_PER_SERVING } from "@catalog/shared";
import { pluralize, toPriceView } from "@/lib/catalog/format";
import {
  CHEAPEST_PER_SYSTEM,
  LAVAZZA_OWN_SYSTEMS,
  type CupPrice,
  type LandingId,
} from "@/lib/catalog/landings";
import { systemCategory } from "@/lib/routes";
import { categoryNameFor } from "./category-copy";
import {
  getBrewingSystem,
  type BrewMethod,
  type BrewingSystem,
  type BrewingSystemId,
} from "@/lib/recommend/systems";

/**
 * The words of the landing listings, the Tchibo machine page and the
 * cross-links between them.
 *
 * Written from scratch, by us, in the voice `PRODUCT.md` asks for: plain,
 * addressed to „вие“, no superlatives.
 *
 * **There is not one figure in this file.** A count, a price per cup, the
 * systems a page covers, the size of a pack: each arrives as an argument,
 * computed from the catalog when the page renders (`lib/catalog/landings.ts`),
 * and the sentence that would have quoted a figure the catalog cannot supply
 * is left out. So nothing here goes stale when a price moves or a product
 * leaves, and nothing here can state a fact about a coffee that the record
 * does not hold.
 *
 * Titles and headings follow the market study's table (`docs/seo.md` §12).
 * The site name is not part of a title: the layout's template appends it.
 */

/** What a page's copy is computed from. A view of `LandingView`, without the cards. */
export interface LandingFacts {
  readonly count: number;
  readonly systems: readonly BrewingSystem[];
  readonly methods: readonly BrewMethod[];
  readonly cupRange: { readonly min: CupPrice; readonly max: CupPrice } | null;
  readonly commonPack: string | null;
  readonly currency: string;
}

/** „A“, „A и B“, „A, B и C“. */
export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} и ${items[items.length - 1]}`;
}

const cupPrice = (price: CupPrice, currency: string): string | null => {
  const view = toPriceView(price.amount, currency);
  return view ? `${price.estimated ? "≈ " : ""}${view.formatted}` : null;
};

/**
 * „от 0,30 € до 0,48 € на чаша“ — or one price when the range is a point.
 *
 * An end that was worked out from weight carries its own „≈“, exactly as the
 * card under it does; a range from a counted pack to a weighed one says so at
 * the right end only.
 */
export function cupRangeText(facts: Pick<LandingFacts, "cupRange" | "currency">): string | null {
  if (!facts.cupRange) return null;
  const min = cupPrice(facts.cupRange.min, facts.currency);
  const max = cupPrice(facts.cupRange.max, facts.currency);
  if (!min || !max) return null;
  return min === max ? `${min} на чаша` : `от ${min} до ${max} на чаша`;
}

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** The order is by phone callback; every meta description ends on it. */
export const CALLBACK_SENTENCE = "Оставете телефон и ще ви се обадим, за да потвърдим поръчката.";

/** Range and callback: the two things a search snippet of ours can say. */
function closing(facts: LandingFacts): string {
  const range = cupRangeText(facts);
  return [range ? sentence(range) : null, CALLBACK_SENTENCE].filter(Boolean).join(" ");
}

/* --- Naming a system in a sentence -------------------------------------- */

/** How a capsule system reads in the Lavazza capsules title: the short form. */
const LAVAZZA_TITLE_NAMES: Readonly<Partial<Record<BrewingSystemId, string>>> = {
  "lavazza-blue": "Blue",
  "a-modo-mio": "A Modo Mio",
  "nespresso-original": "за Nespresso",
  "dolce-gusto": "за Dolce Gusto",
  caffitaly: "за Caffitaly",
};

const METHOD_WORDS: Readonly<Record<BrewMethod, string>> = {
  capsule: "капсули",
  pod: "дози",
  beans: "зърна",
};

/**
 * "Всички капсули за Dolce Gusto", "Всички капсули Caffitaly", "Всички дози
 * ESE", "Цялото кафе на зърна".
 *
 * A capsule shelf is named as it names itself (`categoryNameFor`), with
 * „Всички“ in front: „за Nespresso“, not „за Nespresso Original“, and
 * „капсули Caffitaly“, not „капсули за Caffitaly“ — the same words every
 * other link to that shelf uses (`docs/seo.md` §13.1).
 */
export function systemShelfLabel(system: BrewingSystem): string {
  if (system.method === "capsule") {
    const name = categoryNameFor({ ...systemCategory(system), name: `Капсули за ${system.name}` });
    return `Всички ${name.charAt(0).toLocaleLowerCase("bg")}${name.slice(1)}`;
  }
  return system.method === "pod" ? "Всички дози ESE" : "Цялото кафе на зърна";
}

/* --- The four landings --------------------------------------------------- */

export interface LandingCopy {
  /** The page's single `h1`, its breadcrumb and the name of its item list. */
  readonly h1: string;
  readonly title: (facts: LandingFacts) => string;
  readonly description: (facts: LandingFacts) => string;
  /** Two to four sentences under the heading. */
  readonly intro: (facts: LandingFacts) => readonly string[];
  /** The `h2` over one system's products. */
  readonly groupHeading: (system: BrewingSystem) => string;
  /** One line in `llms.txt`, beside the link. */
  readonly llms: string;
}

export const landingCopy: Readonly<Record<LandingId, LandingCopy>> = {
  lavazzaCapsules: {
    h1: "Капсули Lavazza",
    title: ({ systems }) => {
      const names = systems.map((system) => LAVAZZA_TITLE_NAMES[system.id] ?? system.name);
      return names.length > 0
        ? `Капсули Lavazza (Лаваца): ${joinList(names)}`
        : "Капсули Lavazza (Лаваца)";
    },
    description: (facts) =>
      `Капсули Lavazza, подредени по система: ${joinList(
        facts.systems.map((system) => system.name),
      )}. ${closing(facts)}`,
    intro: ({ systems }) =>
      systems.length > 1
        ? [
            `Под името Lavazza се продават капсули за различни машини и те не се заменят една с друга. Затова тук са подредени по система: ${joinList(
              systems.map((system) => system.name),
            )}.`,
            "Първо вижте коя система е вашата машина, после сравнявайте по цена на чаша — тя стои под цената на всяка кутия.",
          ]
        : [
            `В момента имаме капсули Lavazza за една система: ${systems[0]?.name ?? ""}.`,
            "Преди да поръчате, проверете дали вашата машина е от нея. Цената на чаша стои под цената на всяка кутия.",
          ],
    groupHeading: (system) =>
      LAVAZZA_OWN_SYSTEMS.includes(system.id)
        ? `Капсули за ${system.name}`
        : `Капсули Lavazza, съвместими с ${system.name}`,
    llms: "Капсулите на Lavazza, разделени по системата, за която са.",
  },

  lavazzaBeans: {
    h1: "Кафе на зърна Lavazza",
    title: ({ commonPack }) =>
      `Кафе на зърна Lavazza (Лаваца) — ${commonPack ? `${commonPack}, ` : ""}цена на чаша`,
    description: (facts) =>
      `${sentence(
        `${pluralize(facts.count, "вид", "вида")} кафе на зърна Lavazza${
          facts.commonPack ? ` в пакет от ${facts.commonPack}` : ""
        }`,
      )} ${closing(facts)}`,
    intro: ({ count, commonPack }) => [
      `Тук е цялото кафе на зърна Lavazza, което предлагаме: ${pluralize(count, "вид", "вида")}${
        commonPack ? `, всеки в пакет от ${commonPack}` : ""
      }, подредени от най-ниската цена на чаша.`,
      `Цената на чаша при зърната е приблизителна и затова е отбелязана с „≈“: смятаме по ${GRAMS_PER_SERVING} грама кафе на чаша, а колко мели вашата машина, зависи от настройката ѝ.`,
      "Зърната са за автоматична кафемашина с вградена мелачка или за собствена мелачка.",
    ],
    groupHeading: () => "Кафе на зърна Lavazza",
    llms: "Кафето на зърна на Lavazza, с цена на чаша.",
  },

  decaf: {
    h1: "Безкофеиново кафе",
    title: ({ methods }) => {
      const words = methods.map((method) => METHOD_WORDS[method]);
      return words.length > 0 ? `Безкофеиново кафе — ${joinList(words)}` : "Безкофеиново кафе";
    },
    description: (facts) =>
      `Безкофеиново кафе на ${joinList(
        facts.methods.map((method) => METHOD_WORDS[method]),
      )}: ${pluralize(facts.count, "продукт", "продукта")}, подредени по системата на машината. ${closing(
        facts,
      )}`,
    intro: ({ count }) => [
      `Тук е всичко без кофеин в магазина: ${pluralize(
        count,
        "продукт",
        "продукта",
      )}, отбелязани в каталога като безкофеинови.`,
      "Подредени са по системата, за която са, защото капсула без кофеин влиза само в машината, за която е направена. Намерете първо своята система, после сравнявайте по цена на чаша.",
    ],
    groupHeading: (system) => {
      if (system.method === "capsule") return `Без кофеин за ${system.name}`;
      return system.method === "pod" ? "Дози ESE без кофеин" : "Кафе на зърна без кофеин";
    },
    llms: "Всички продукти без кофеин, разделени по система.",
  },

  cheapest: {
    h1: "Най-евтино на чаша",
    title: ({ methods }) => {
      const subjects = [
        methods.includes("capsule") ? "капсули" : null,
        methods.includes("beans") ? "кафе на зърна" : null,
      ].filter((subject): subject is string => subject !== null);
      const lead =
        subjects.length === 0
          ? "Евтино кафе"
          : subjects[0] === "капсули"
            ? `Евтини ${joinList(subjects)}`
            : `Евтино ${joinList(subjects)}`;
      return `${lead} — подредени по цена на чаша`;
    },
    description: (facts) =>
      `Продуктите с най-ниска цена на чаша във всяка система: ${joinList(
        facts.methods.map((method) => METHOD_WORDS[method]),
      )}. ${closing(facts)}`,
    intro: ({ methods }) => [
      "Цената на кутията не казва колко струва едно кафе: в различните опаковки има различен брой чаши. Затова тук подреждаме по цена на чаша.",
      `За всяка система показваме до ${CHEAPEST_PER_SYSTEM} продукта с най-ниска цена на чаша сред тези, които могат да се поръчат в момента.`,
      ...(methods.includes("beans")
        ? [
            `При кафето на зърна цената на чаша е приблизителна и е отбелязана с „≈“: смятаме по ${GRAMS_PER_SERVING} грама на чаша.`,
          ]
        : []),
      "Подреждането е само по цена — за вкуса не казва нищо.",
    ],
    groupHeading: (system) => {
      if (system.method === "capsule") return `Капсули за ${system.name}`;
      return system.method === "pod" ? "Дози ESE" : "Кафе на зърна";
    },
    llms: "Продуктите с най-ниска цена на чаша във всяка система.",
  },
};

/** Under a group's heading on the cheapest-per-cup page: what was chosen, out of what. */
export function cheapestGroupNote(shown: number, poolSize: number): string {
  return shown < poolSize
    ? `${pluralize(shown, "продукт", "продукта")} с най-ниска цена на чаша от общо ${poolSize} в тази система.`
    : `Това е всичко в тази система: ${pluralize(shown, "продукт", "продукта")}, от най-ниската цена на чаша.`;
}

/** Which machine brands our own list holds models of, for one system. */
export function machineBrandsSentence(brandNames: readonly string[]): string | null {
  if (brandNames.length === 0) return null;
  return `Машини с тази система в списъка ни: ${joinList(brandNames)}.`;
}

export const landingLabels = {
  breadcrumbHome: "Начало",
  /** Accessible name of the row of in-page links to the groups. */
  jumpLabel: "Системи на тази страница",
  findMachine: "Намерете машината си по марка и модел",
  orderHeading: "Поръчка по телефона",
  orderBody:
    "Няма количка и плащане онлайн. Оставяте телефон на страницата на продукта и ние ви се обаждаме, за да потвърдим поръчката. Можете и направо да ни позвъните:",
  llmsHeading: "Подбрани списъци",
} as const;

/* --- Machine-brand pages ------------------------------------------------- */

/**
 * The generic machine-brand title and heading.
 *
 * „Капсули и кафе“ only for a brand that has a capsule machine in our list:
 * a title promising capsules for a maker of bean-to-cup machines alone would
 * say something the page then has to take back.
 */
export const machineBrandCopy = {
  title: (brandName: string, hasCapsuleMachines: boolean) =>
    `${hasCapsuleMachines ? "Капсули и кафе" : "Кафе"} за кафемашини ${brandName} — кой модел какво приема`,
  h1: (brandName: string) => `Кафемашини ${brandName}: какво им пасва`,
  description: (brandName: string, hasCapsuleMachines: boolean) =>
    hasCapsuleMachines
      ? `Коя капсула пасва на всеки модел ${brandName} — и какво от асортимента ни можете да поръчате за него. ${CALLBACK_SENTENCE}`
      : `Какво кафе приема всеки модел ${brandName} — и какво от асортимента ни можете да поръчате за него. ${CALLBACK_SENTENCE}`,
} as const;

/**
 * A machine brand whose page is about one family of machines and the one shelf
 * that fits it. Tchibo is the only one: „tchibo cafissimo“ is searched for by
 * name, and a page of compatible capsules is what wins that search.
 */
export interface MachineBrandFeature {
  readonly title: string;
  readonly h1: string;
  /** The system whose products the page lists, above the model list. */
  readonly system: BrewingSystemId;
  /** After the machine database's own sentence about the brand. */
  readonly lead: string;
  readonly listHeading: string;
  readonly description: (facts: LandingFacts) => string;
}

export const machineBrandFeatures: Readonly<Record<string, MachineBrandFeature>> = {
  tchibo: {
    title: "Капсули за Tchibo Cafissimo (Чибо Кафисимо) — пасват капсулите Caffitaly",
    h1: "Капсули за Tchibo Cafissimo",
    system: "caffitaly",
    lead: "По-долу са капсулите Caffitaly, които предлагаме в момента, с цената на чаша под всяка кутия. След тях са моделите Cafissimo, за които знаем, че приемат този формат.",
    listHeading: "Капсули Caffitaly, които стават за Cafissimo",
    description: (facts) =>
      `Машините Tchibo Cafissimo приемат формата Caffitaly. ${
        facts.count > 0
          ? `${sentence(`${pluralize(facts.count, "вид", "вида")} капсули Caffitaly`)} `
          : ""
      }${closing(facts)}`,
  },
};

/**
 * Whether any model in our list takes a capsule, of a system we stock or not.
 * Pre-ground coffee is the one "system" in the unsupported list that is not a
 * capsule.
 */
export function hasCapsuleMachines(brand: {
  readonly models: ReadonlyArray<{ readonly system: string }>;
}): boolean {
  return brand.models.some((model) => {
    const system = getBrewingSystem(model.system);
    return system ? system.method === "capsule" : model.system !== "ground";
  });
}

/**
 * The `<title>` (before the shop's name) and `h1` of one machine brand's page:
 * the featured wording for the brand that has one, the generic one for the
 * rest. In one place so that the page and `test/keyword-map.test.ts` cannot
 * build them differently.
 */
export function machineBrandNames(brand: {
  readonly slug: string;
  readonly name: string;
  readonly models: ReadonlyArray<{ readonly system: string }>;
}): { readonly title: string; readonly h1: string } {
  const feature = Object.hasOwn(machineBrandFeatures, brand.slug)
    ? machineBrandFeatures[brand.slug]
    : undefined;
  return {
    title: feature?.title ?? machineBrandCopy.title(brand.name, hasCapsuleMachines(brand)),
    h1: feature?.h1 ?? machineBrandCopy.h1(brand.name),
  };
}

/* --- Cross-links --------------------------------------------------------- */

/**
 * The anchors of the links between pages that must not compete
 * (`docs/seo.md` §13.5, §13.7). One anchor per page, used wherever that page
 * is linked from; `note` says in a few words what the page is.
 */
export const relatedCopy = {
  navLabel: "Свързани страници",
  lavazzaCapsules: {
    label: "Капсули Lavazza",
    note: "всички капсули на марката, разделени по система",
  },
  lavazzaBeans: { label: "Кафе на зърна Lavazza", note: "само зърната на марката" },
  lavazzaBrand: { label: "Кафе Lavazza", note: "всичко от марката на една страница" },
  lavazzaBlue: {
    label: "Капсули за Lavazza Blue",
    note: "за професионалните машини Blue, най-често в офиси",
  },
  aModoMio: { label: "Капсули за Lavazza A Modo Mio", note: "за домашните машини на Lavazza" },
  caffitaly: { label: "Капсули Caffitaly", note: "целият рафт, с филтри и подреждане" },
  tchibo: {
    label: "Капсули за Tchibo Cafissimo",
    note: "същият формат; кои модели Cafissimo го приемат",
  },
  decafInSystem: "Без кофеин в тази система",
  decaf: "Безкофеиново кафе",
  cheapest: "Най-евтино на чаша",
} as const;
