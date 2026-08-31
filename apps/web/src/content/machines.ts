import type { AnySystemId } from "@/lib/recommend/systems";

/**
 * Machine compatibility database.
 *
 * Customers know their machine, not their capsule system. "I have a Krups
 * thing" is the normal state of knowledge, and the gap between that and
 * "Dolce Gusto" is the entire reason this wizard is worth building. This file
 * closes it.
 *
 * It is written by us, by hand. Nothing here comes from the source site, and
 * nothing here should: a compatibility claim is a promise to the customer, so
 * it needs an owner who can be asked why.
 *
 * Two rules govern entries:
 *
 *  - **A model is listed only if we know which capsule it takes.** A wrong
 *    entry sells someone a box that does not fit their machine, which is worse
 *    than omitting the model and letting them phone us.
 *  - **Incompatible machines are listed too**, pointing at an unsupported
 *    system. Someone with a Vertuo deserves a straight "nothing here fits it"
 *    rather than a wizard that quietly runs out of answers.
 *
 * `aliases` carry Cyrillic spellings, because that is how these names are
 * typed in Bulgaria — "Делонги", "Долче Густо", "Неспресо". Latin-only
 * matching would miss a large share of real input.
 *
 * Capsules for third-party systems fit by shared format, not by licence from
 * the machine's maker. `crossFormat` marks the entries where that distinction
 * is worth stating, and the UI states it.
 */

export interface MachineModel {
  /** Unique across the whole database; used in URLs. */
  readonly slug: string;
  readonly name: string;
  /** Alternative spellings, including Cyrillic, for matching typed input. */
  readonly aliases?: readonly string[];
  readonly system: AnySystemId;
  /**
   * Set when the capsule fits by shared format rather than through the machine
   * maker's own range, so the page can say so instead of implying otherwise.
   */
  readonly crossFormat?: boolean;
  readonly note?: string;
}

export interface MachineBrand {
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  /** One line about the brand, shown above its model list. */
  readonly summary: string;
  readonly models: readonly MachineModel[];
}

/* Constructors for the repetitive entries; the unusual ones are written out. */

const nespresso = (slug: string, name: string, aliases?: readonly string[]): MachineModel => ({
  slug,
  name,
  aliases,
  system: "nespresso-original",
});

const vertuo = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "nespresso-vertuo",
});

const dolceGusto = (slug: string, name: string, aliases?: readonly string[]): MachineModel => ({
  slug,
  name,
  aliases,
  system: "dolce-gusto",
});

const aModoMio = (slug: string, name: string, aliases?: readonly string[]): MachineModel => ({
  slug,
  name,
  aliases,
  system: "a-modo-mio",
});

const lavazzaBlue = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "lavazza-blue",
});

const caffitaly = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "caffitaly",
});

/** Caffitaly-format machines sold under another brand. */
const caffitalyFormat = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "caffitaly",
  crossFormat: true,
});

const tassimo = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "tassimo",
});

const beans = (slug: string, name: string, aliases?: readonly string[]): MachineModel => ({
  slug,
  name,
  aliases,
  system: "beans",
});

export const MACHINE_BRANDS: readonly MachineBrand[] = [
  {
    slug: "nespresso",
    name: "Nespresso",
    aliases: ["неспресо"],
    summary:
      "Машините Nespresso се произвеждат от Krups, De'Longhi, Magimix и Breville, но моделът определя капсулата, не производителят.",
    models: [
      nespresso("nespresso-essenza-mini", "Essenza Mini", ["есенца мини"]),
      nespresso("nespresso-essenza-plus", "Essenza Plus"),
      nespresso("nespresso-inissia", "Inissia", ["инисия"]),
      nespresso("nespresso-pixie", "Pixie", ["пикси"]),
      nespresso("nespresso-citiz", "CitiZ", ["ситиз", "CitiZ & Milk"]),
      nespresso("nespresso-lattissima-one", "Lattissima One", ["латисима"]),
      nespresso("nespresso-lattissima-touch", "Lattissima Touch"),
      nespresso("nespresso-lattissima-pro", "Lattissima Pro"),
      nespresso("nespresso-gran-lattissima", "Gran Lattissima"),
      nespresso("nespresso-creatista-uno", "Creatista Uno", ["креатиста"]),
      nespresso("nespresso-creatista-plus", "Creatista Plus"),
      nespresso("nespresso-creatista-pro", "Creatista Pro"),
      nespresso("nespresso-atelier", "Atelier"),
      nespresso("nespresso-expert", "Expert"),
      nespresso("nespresso-prodigio", "Prodigio"),
      nespresso("nespresso-maestria", "Maestria"),
      nespresso("nespresso-u", "U"),
      nespresso("nespresso-le-cube", "Le Cube"),
      vertuo("nespresso-vertuo", "Vertuo"),
      vertuo("nespresso-vertuo-plus", "Vertuo Plus"),
      vertuo("nespresso-vertuo-next", "Vertuo Next"),
      vertuo("nespresso-vertuo-pop", "Vertuo Pop"),
      vertuo("nespresso-vertuo-lattissima", "Vertuo Lattissima"),
      { slug: "nespresso-zenius", name: "Zenius", system: "nespresso-professional" },
      { slug: "nespresso-gemini", name: "Gemini", system: "nespresso-professional" },
      { slug: "nespresso-aguila", name: "Aguila", system: "nespresso-professional" },
    ],
  },
  {
    slug: "krups",
    name: "Krups",
    aliases: ["крупс"],
    summary:
      "Krups прави машини за три различни системи. Изберете модела — марката сама по себе си не казва коя капсула пасва.",
    models: [
      dolceGusto("krups-piccolo", "Dolce Gusto Piccolo", ["пиколо"]),
      dolceGusto("krups-piccolo-xs", "Dolce Gusto Piccolo XS"),
      dolceGusto("krups-genio-s", "Dolce Gusto Genio S", ["дженио"]),
      dolceGusto("krups-genio-s-plus", "Dolce Gusto Genio S Plus"),
      dolceGusto("krups-genio-s-touch", "Dolce Gusto Genio S Touch"),
      dolceGusto("krups-mini-me", "Dolce Gusto Mini Me", ["мини ми"]),
      dolceGusto("krups-oblo", "Dolce Gusto Oblo", ["обло"]),
      dolceGusto("krups-jovia", "Dolce Gusto Jovia"),
      dolceGusto("krups-lumio", "Dolce Gusto Lumio", ["лумио"]),
      dolceGusto("krups-movenza", "Dolce Gusto Movenza"),
      dolceGusto("krups-esperta", "Dolce Gusto Esperta"),
      dolceGusto("krups-infinissima", "Dolce Gusto Infinissima", ["инфинисима"]),
      dolceGusto("krups-infinissima-touch", "Dolce Gusto Infinissima Touch"),
      dolceGusto("krups-circolo", "Dolce Gusto Circolo"),
      dolceGusto("krups-melody", "Dolce Gusto Melody"),
      dolceGusto("krups-drop", "Dolce Gusto Drop"),
      dolceGusto("krups-neo", "Dolce Gusto Neo"),
      nespresso("krups-nespresso-inissia", "Nespresso Inissia"),
      nespresso("krups-nespresso-essenza", "Nespresso Essenza"),
      nespresso("krups-nespresso-pixie", "Nespresso Pixie"),
      nespresso("krups-nespresso-citiz", "Nespresso CitiZ"),
      beans("krups-evidence", "Evidence (автоматична)", ["евиденс"]),
      beans("krups-arabica", "Arabica (автоматична)"),
      beans("krups-intuition", "Intuition (автоматична)"),
    ],
  },
  {
    slug: "delonghi",
    name: "De'Longhi",
    aliases: ["делонги", "делонджи", "de longhi"],
    summary:
      "De'Longhi прави и капсулни, и автоматични машини. Автоматичните мелят зърна — за тях се купува кафе на зърна.",
    models: [
      dolceGusto("delonghi-mini-me", "Dolce Gusto Mini Me"),
      dolceGusto("delonghi-genio", "Dolce Gusto Genio"),
      dolceGusto("delonghi-piccolo", "Dolce Gusto Piccolo"),
      dolceGusto("delonghi-eclipse", "Dolce Gusto Eclipse"),
      dolceGusto("delonghi-infinissima", "Dolce Gusto Infinissima"),
      nespresso("delonghi-nespresso-lattissima", "Nespresso Lattissima"),
      nespresso("delonghi-nespresso-inissia", "Nespresso Inissia"),
      nespresso("delonghi-nespresso-citiz", "Nespresso CitiZ"),
      beans("delonghi-magnifica", "Magnifica (автоматична)", ["магнифика"]),
      beans("delonghi-magnifica-s", "Magnifica S (автоматична)"),
      beans("delonghi-magnifica-evo", "Magnifica Evo (автоматична)"),
      beans("delonghi-dinamica", "Dinamica (автоматична)", ["динамика"]),
      beans("delonghi-eletta", "Eletta (автоматична)"),
      beans("delonghi-eletta-explore", "Eletta Explore (автоматична)"),
      beans("delonghi-primadonna", "PrimaDonna (автоматична)", ["примадона"]),
      beans("delonghi-rivelia", "Rivelia (автоматична)"),
      {
        slug: "delonghi-dedica",
        name: "Dedica (ръчна с цедка)",
        aliases: ["дедика"],
        system: "ese-pod",
        note: "Работи с мляно кафе. С цедката за дози приема и хартиени дози ESE 44 мм.",
      },
    ],
  },
  {
    slug: "lavazza",
    name: "Lavazza",
    aliases: ["лаваца", "лавазза"],
    summary:
      "Lavazza има две несъвместими системи: A Modo Mio за дома и Blue за офиса. Проверете какво пише на машината.",
    models: [
      aModoMio("lavazza-tiny", "A Modo Mio Tiny", ["тини"]),
      aModoMio("lavazza-tiny-eco", "A Modo Mio Tiny Eco"),
      aModoMio("lavazza-jolie", "A Modo Mio Jolie", ["жоли"]),
      aModoMio("lavazza-jolie-plus", "A Modo Mio Jolie Plus"),
      aModoMio("lavazza-desea", "A Modo Mio Deséa", ["дезеа"]),
      aModoMio("lavazza-idola", "A Modo Mio Idola", ["идола"]),
      aModoMio("lavazza-voicy", "A Modo Mio Voicy"),
      aModoMio("lavazza-minu", "A Modo Mio Minù"),
      aModoMio("lavazza-magia-plus", "A Modo Mio Magia Plus"),
      aModoMio("lavazza-espria", "A Modo Mio Espria"),
      aModoMio("lavazza-fantasia", "A Modo Mio Fantasia"),
      lavazzaBlue("lavazza-lb-300", "Blue LB 300"),
      lavazzaBlue("lavazza-lb-800", "Blue LB 800"),
      lavazzaBlue("lavazza-lb-910", "Blue LB 910"),
      lavazzaBlue("lavazza-lb-951", "Blue LB 951"),
      lavazzaBlue("lavazza-lb-1000", "Blue LB 1000"),
      lavazzaBlue("lavazza-lb-2317", "Blue LB 2317"),
      lavazzaBlue("lavazza-classy-mini", "Blue Classy Mini"),
      lavazzaBlue("lavazza-classy-plus", "Blue Classy Plus"),
      lavazzaBlue("lavazza-classy-compact", "Blue Classy Compact"),
    ],
  },
  {
    slug: "caffitaly",
    name: "Caffitaly",
    aliases: ["кафитали"],
    summary: "Всички машини Caffitaly приемат един и същ формат капсула.",
    models: [
      caffitaly("caffitaly-s03", "S03"),
      caffitaly("caffitaly-s04", "S04"),
      caffitaly("caffitaly-s05", "S05"),
      caffitaly("caffitaly-s07", "S07"),
      caffitaly("caffitaly-s09", "S09"),
      caffitaly("caffitaly-s12", "S12"),
      caffitaly("caffitaly-s14", "S14"),
      caffitaly("caffitaly-s15", "S15"),
      caffitaly("caffitaly-s18", "S18"),
      caffitaly("caffitaly-s21", "S21"),
      caffitaly("caffitaly-s22", "S22"),
      caffitaly("caffitaly-s24", "S24"),
      caffitaly("caffitaly-s25", "S25"),
      caffitaly("caffitaly-s27", "S27"),
      caffitaly("caffitaly-s30", "S30"),
      caffitaly("caffitaly-s32", "S32"),
      caffitaly("caffitaly-ambra", "Ambra"),
      caffitaly("caffitaly-nautilus", "Nautilus"),
      caffitaly("caffitaly-iris", "Iris"),
      caffitaly("caffitaly-luna", "Luna"),
      caffitaly("caffitaly-maia", "Maia"),
    ],
  },
  {
    slug: "tchibo",
    name: "Tchibo",
    aliases: ["чибо", "кафисимо"],
    summary:
      "Машините Cafissimo използват същия формат капсула като Caffitaly, така че капсулите Caffitaly работят в тях.",
    models: [
      caffitalyFormat("tchibo-cafissimo-classic", "Cafissimo Classic"),
      caffitalyFormat("tchibo-cafissimo-pure", "Cafissimo Pure"),
      caffitalyFormat("tchibo-cafissimo-mini", "Cafissimo Mini"),
      caffitalyFormat("tchibo-cafissimo-latte", "Cafissimo Latte"),
      caffitalyFormat("tchibo-cafissimo-compact", "Cafissimo Compact"),
      caffitalyFormat("tchibo-cafissimo-tuttocaffe", "Cafissimo Tuttocaffè"),
    ],
  },
  {
    slug: "k-fee",
    name: "K-fee",
    aliases: ["к фи"],
    summary: "Машините K-fee използват същия формат капсула като Caffitaly.",
    models: [
      caffitalyFormat("k-fee-one", "One"),
      caffitalyFormat("k-fee-twins", "Twins"),
      caffitalyFormat("k-fee-lattea", "Lattea"),
      caffitalyFormat("k-fee-espresso", "Espresso"),
    ],
  },
  {
    slug: "bosch",
    name: "Bosch",
    aliases: ["бош"],
    summary: "Внимание: Tassimo и VeroCup са напълно различни системи.",
    models: [
      tassimo("bosch-tassimo-vivy", "Tassimo Vivy"),
      tassimo("bosch-tassimo-happy", "Tassimo Happy"),
      tassimo("bosch-tassimo-suny", "Tassimo Suny"),
      tassimo("bosch-tassimo-style", "Tassimo Style"),
      tassimo("bosch-tassimo-finesse", "Tassimo Finesse"),
      beans("bosch-verocup", "VeroCup (автоматична)"),
      beans("bosch-verocafe", "VeroCafe (автоматична)"),
      beans("bosch-vero-barista", "Vero Barista (автоматична)"),
    ],
  },
  {
    slug: "philips",
    name: "Philips / Saeco",
    aliases: ["филипс", "саеко"],
    summary: "Автоматични машини с вградена мелачка — за тях се купува кафе на зърна.",
    models: [
      beans("philips-3200", "Series 3200 (автоматична)"),
      beans("philips-4300", "Series 4300 (автоматична)"),
      beans("philips-5400", "Series 5400 (автоматична)"),
      beans("philips-5500", "Series 5500 (автоматична)"),
      beans("philips-lattego", "LatteGo (автоматична)", ["латего"]),
      beans("saeco-incanto", "Saeco Incanto (автоматична)"),
      beans("saeco-xelsis", "Saeco Xelsis (автоматична)"),
      beans("saeco-gran-aroma", "Saeco GranAroma (автоматична)"),
    ],
  },
  {
    slug: "jura",
    name: "Jura",
    aliases: ["юра"],
    summary: "Автоматични машини на зърна.",
    models: [
      beans("jura-ena-4", "ENA 4 (автоматична)"),
      beans("jura-ena-8", "ENA 8 (автоматична)"),
      beans("jura-e8", "E8 (автоматична)"),
      beans("jura-s8", "S8 (автоматична)"),
      beans("jura-z10", "Z10 (автоматична)"),
    ],
  },
  {
    slug: "siemens",
    name: "Siemens",
    aliases: ["сименс"],
    summary: "Автоматични машини на зърна от серията EQ.",
    models: [
      beans("siemens-eq3", "EQ.3 (автоматична)"),
      beans("siemens-eq500", "EQ.500 (автоматична)"),
      beans("siemens-eq700", "EQ.700 (автоматична)"),
      beans("siemens-eq900", "EQ.900 (автоматична)"),
    ],
  },
  {
    slug: "melitta",
    name: "Melitta",
    aliases: ["мелита"],
    summary: "Автоматични машини на зърна.",
    models: [
      beans("melitta-caffeo-solo", "Caffeo Solo (автоматична)"),
      beans("melitta-barista-smart", "Barista Smart (автоматична)"),
      beans("melitta-purista", "Purista (автоматична)"),
    ],
  },
  {
    slug: "gaggia",
    name: "Gaggia",
    aliases: ["гаджия", "гаггия"],
    summary:
      "Ръчните модели с цедка работят с мляно кафе и с дози ESE; автоматичните мелят зърна сами.",
    models: [
      {
        slug: "gaggia-classic",
        name: "Classic (ръчна с цедка)",
        aliases: ["класик"],
        system: "ese-pod",
        note: "С цедката за дози приема хартиени дози ESE 44 мм.",
      },
      {
        slug: "gaggia-carezza",
        name: "Carezza (ръчна с цедка)",
        system: "ese-pod",
        note: "С цедката за дози приема хартиени дози ESE 44 мм.",
      },
      beans("gaggia-cadorna", "Cadorna (автоматична)"),
      beans("gaggia-magenta", "Magenta (автоматична)"),
    ],
  },
  {
    slug: "smeg",
    name: "Smeg",
    aliases: ["смег"],
    summary: "Машините Smeg за Lavazza работят с капсули A Modo Mio.",
    models: [
      aModoMio("smeg-lavazza-amm", "Smeg for Lavazza A Modo Mio"),
      {
        slug: "smeg-ecf01",
        name: "ECF01 (ръчна с цедка)",
        system: "ese-pod",
        note: "С цедката за дози приема хартиени дози ESE 44 мм.",
      },
    ],
  },
  {
    slug: "illy",
    name: "illy",
    aliases: ["или", "илли"],
    summary: "Машините Iperespresso приемат само собствените капсули на illy.",
    models: [
      { slug: "illy-y3", name: "Y3.3 Iperespresso", system: "illy-iperespresso" },
      { slug: "illy-y5", name: "Y5 Iperespresso", system: "illy-iperespresso" },
      { slug: "illy-x1", name: "X1 Iperespresso", system: "illy-iperespresso" },
      {
        slug: "illy-x7-ese",
        name: "X7.1 (версия за дози)",
        system: "ese-pod",
        note: "Вариантът с цедка за дози приема хартиени дози ESE 44 мм.",
      },
    ],
  },
  {
    slug: "bialetti",
    name: "Bialetti",
    aliases: ["биалети"],
    summary: "Капсулите на Bialetti са собствен формат и не се заменят с друг.",
    models: [
      { slug: "bialetti-cf40", name: "Break CF40", system: "bialetti-i-caffe" },
      { slug: "bialetti-gioia", name: "Gioia", system: "bialetti-i-caffe" },
    ],
  },
  {
    slug: "vending",
    name: "Вендинг машини",
    aliases: ["вендинг", "автомат за кафе"],
    summary:
      "Вендинг автоматите мелят зърна на място. Търсете кафе на зърна, обикновено в опаковки от 1 кг.",
    models: [
      beans("vending-espresso-automat", "Автомат за еспресо на зърна"),
      beans("vending-office", "Офис машина на зърна"),
    ],
  },
];

const MODELS_BY_SLUG = new Map<string, { brand: MachineBrand; model: MachineModel }>();
const BRANDS_BY_SLUG = new Map<string, MachineBrand>();

for (const brand of MACHINE_BRANDS) {
  BRANDS_BY_SLUG.set(brand.slug, brand);
  for (const model of brand.models) MODELS_BY_SLUG.set(model.slug, { brand, model });
}

export function getMachineBrand(slug: string | null | undefined): MachineBrand | null {
  if (!slug) return null;
  return BRANDS_BY_SLUG.get(slug) ?? null;
}

export function getMachineModel(
  slug: string | null | undefined,
): { readonly brand: MachineBrand; readonly model: MachineModel } | null {
  if (!slug) return null;
  return MODELS_BY_SLUG.get(slug) ?? null;
}

/** Every model in the database, flattened. Used by tests and by search. */
export function allMachineModels(): ReadonlyArray<{
  readonly brand: MachineBrand;
  readonly model: MachineModel;
}> {
  return [...MODELS_BY_SLUG.values()];
}
