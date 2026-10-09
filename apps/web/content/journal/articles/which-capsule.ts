import { MACHINE_BRANDS, allMachineModels } from "@/content/machines";
import { pluralize } from "@/lib/catalog/format";
import {
  UNSUPPORTED_SYSTEMS,
  systemsForMethod,
  type AnySystemId,
  type BrewingSystemId,
} from "@/lib/recommend/systems";
import {
  action,
  callout,
  h2,
  h3,
  link,
  ol,
  p,
  phone,
  sentenceList,
  strong,
  ul,
  type Article,
  type Block,
  type Inline,
} from "../blocks";
import {
  CAPSULES_HREF,
  MACHINES_HREF,
  WIZARD_HREF,
  machineBrandHref,
  systemCategoryHref,
} from "../links";

/**
 * The kinds of coffee capsule, and which one fits which machine.
 *
 * Retitled in October 2026 toward the query people type — „видове капсули за
 * кафе“ — and moved to the slug that says so; the address it launched at is in
 * `previousSlugs` and answers 308. The opening answers "what kinds are there"
 * before anything else, because that is the question the title now asks.
 *
 * Built from `machines.ts` and `systems.ts` and from nothing else. What a
 * capsule looks like is quoted from each system's own `recognise` line, and
 * which brands make machines for it is counted from the machine database, so
 * neither can drift from the pages that state the same facts. The hand-written
 * sentences only restate what those two files say; a compatibility claim that
 * is not in them does not belong here either.
 */

export const WHICH_CAPSULE_SLUG = "vidove-kapsuli-za-kafe";

/** Machine brands that list at least one model for a system, with the count. */
function brandsFor(system: AnySystemId): Inline[][] {
  return MACHINE_BRANDS.flatMap((brand) => {
    const count = brand.models.filter((model) => model.system === system).length;
    if (count === 0) return [];
    return [
      [link(machineBrandHref(brand.slug), brand.name), ` (${pluralize(count, "модел", "модела")})`],
    ];
  });
}

/** What the shopkeeper adds to the bare description of each capsule. */
const SYSTEM_NOTES: Partial<Record<BrewingSystemId, string>> = {
  "nespresso-original":
    "Влиза в класическите домашни машини Nespresso. Vertuo също носи името Nespresso, но е отделна система — за нея пише по-долу.",
  "dolce-gusto":
    "Машините се правят от Krups и De'Longhi, а името на модела започва с Dolce Gusto: Piccolo, Genio, Mini Me, Infinissima.",
  "a-modo-mio":
    "Това е домашната система на Lavazza. Със същите капсули работи и машината Smeg for Lavazza A Modo Mio. Не я бъркайте с Lavazza Blue — двете не са съвместими.",
  caffitaly:
    "Всички машини Caffitaly приемат един и същ формат. Същият формат работи и в Tchibo Cafissimo и в K-fee: там капсулите не са произведени от производителя на машината, а пасват по размер и форма.",
  "lavazza-blue":
    "Това е професионалната система на Lavazza, която най-често стои в офис. Към нея са и моделите Classy.",
};

export const whichCapsule: Article = {
  slug: WHICH_CAPSULE_SLUG,
  previousSlugs: ["koya-kapsula-pasva-na-koya-mashina"],
  title: "Видове капсули за кафе: коя пасва на вашата машина",
  description:
    "Капсулите за кафе се делят по системи, не по марки: Nespresso, Dolce Gusto, Lavazza A Modo Mio, Lavazza Blue и Caffitaly. Как да познаете своята по капсулата и по машината.",
  publishedAt: "2026-10-09",
  usesCatalog: false,

  body: () => {
    const capsuleSystems = systemsForMethod("capsule");
    const modelCount = allMachineModels().length;

    /* Only the unsupported systems a listed machine actually points at: those
       are the ones a reader can own. */
    const listedSystems = new Set<string>(allMachineModels().map(({ model }) => model.system));
    const unsupported = UNSUPPORTED_SYSTEMS.filter(
      (system) => listedSystems.has(system.id) && system.id !== "ground",
    );

    const systemSections: Block[] = capsuleSystems.flatMap((system) => {
      const note = SYSTEM_NOTES[system.id];
      const brands = brandsFor(system.id);
      return [
        h3(system.name),
        p(system.recognise, ...(note ? [" ", note] : [])),
        ...(brands.length > 0
          ? [
              p(
                "Машини в нашия списък: ",
                ...sentenceList(brands),
                ". Вижте ",
                link(systemCategoryHref(system.id), `капсулите за ${system.name}`),
                ".",
              ),
            ]
          : []),
      ];
    });

    return [
      p(
        "Видовете капсули за кафе не се различават по марката на кафето, а по системата — тоест по машината, за която са направени. Държим капсули за ",
        pluralize(capsuleSystems.length, "система", "системи"),
        ": ",
        ...sentenceList(
          capsuleSystems.map((system) => [link(systemCategoryHref(system.id), system.name)]),
        ),
        ".",
      ),
      p(
        "Нито една от тях не влиза в машина за друга. Затова „какви капсули да купя“ е въпрос за машината, не за кафето: грешната кутия не е „малко по-различно кафе“ — тя просто не става за вашата машина.",
      ),

      h2("Марката на машината не е достатъчна"),
      p(
        "Лесно е да се подведете по марката на машината. Krups прави машини за три различни системи: Dolce Gusto, Nespresso и автоматични машини на зърна. De'Longhi прави и капсулни, и автоматични. Lavazza има две несъвместими системи — A Modo Mio за дома и Blue за офиса, така че и „капсули Lavazza“ не значи един вид капсула.",
      ),
      p(
        "Обратното също важи: машините Nespresso се произвеждат от Krups, De'Longhi, Magimix и Breville, но капсулата се определя от модела, не от производителя. Затова гледайте името на модела, което пише на самата машина, а не логото.",
      ),

      h2("Системите, за които имаме капсули"),
      p(
        "Всички заедно са в категорията ",
        link(CAPSULES_HREF, "кафе капсули"),
        ". По-долу са една по една: как изглежда капсулата и в кои машини влиза.",
      ),
      ...systemSections,

      h2("Системи, за които нямаме капсули"),
      p(
        "По-добре да го кажем направо, отколкото да поръчате нещо, което няма да влезе в машината.",
      ),
      ul(...unsupported.map((system) => [strong(`${system.name}. `), system.explanation])),
      callout(
        { tone: "caution", title: "Bosch: две различни неща под една марка" },
        "Tassimo и VeroCup са напълно различни системи. Tassimo работи с дискове, каквито нямаме, а VeroCup е автоматична машина — за нея се купува ",
        link(systemCategoryHref("beans"), "кафе на зърна"),
        ".",
      ),

      h2("Ако машината ви не е капсулна"),
      p(
        "Автоматичната машина мели зърната сама: сипвате зърна в контейнер отгоре, не капсула. За нея се купува ",
        link(systemCategoryHref("beans"), "кафе на зърна"),
        ".",
      ),
      p(
        "Някои ръчни еспресо машини с цедка — например De'Longhi Dedica и Gaggia Classic — работят с мляно кафе, а с цедката за дози приемат и ",
        link(systemCategoryHref("ese-pod"), "хартиени дози ESE 44 мм"),
        ". Предварително мляно кафе в пакет в момента не предлагаме.",
      ),

      h2("Ако не сте сигурни"),
      ol(
        "Прочетете какво пише на самата машина: марката и името на модела.",
        [
          "Намерете модела в ",
          link(MACHINES_HREF, "списъка ни по марки"),
          `. В него има ${pluralize(modelCount, "модел", "модела")} от ${pluralize(MACHINE_BRANDS.length, "марка", "марки")} и за всеки пише коя система приема — включително за тези, за които нямаме кафе.`,
        ],
        "Ако ви е останала капсула, сравнете я с описанията по-горе.",
        [
          "Ако моделът го няма в списъка или пак се колебаете, обадете се на ",
          phone,
          " и кажете какво пише на машината. Не поръчвайте наслуки.",
        ],
      ),
      p(
        "Щом системата е ясна, остават вкусът и цената. За тях е въпросникът: няколко въпроса, след които остават само кафета, които пасват на вашата машина.",
      ),
      action({ href: WIZARD_HREF, label: "Към въпросника" }),
    ];
  },
};
