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
 * is worth stating, and the UI states it, with `CROSS_FORMAT_CAVEAT`.
 *
 * A system's name on a machine is not the same as its capsule: Dolce Gusto
 * NEO is not Dolce Gusto, Vertuo is not Nespresso Original, K-fee is not
 * Caffitaly, Lavazza runs four office and home systems. Each maker's own
 * compatibility statement decides, not the logo.
 */

/**
 * Said wherever a cross-format fit is stated. Tchibo tells Cafissimo owners to
 * use its own capsules, and its manual warns that repairs after other makers'
 * capsules are not covered by the warranty; the customer should hear that
 * before relying on the fit.
 */
export const CROSS_FORMAT_CAVEAT =
  "Капсулите не са произведени от производителя на машината, а са съвместими по размер и форма. Производителят на машината посочва, че в нея трябва да се използват само неговите капсули, и може да не поеме по гаранция ремонт след капсули на друг производител.";

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
  /**
   * Set on a machine for ESE pods that also brews ground coffee in its
   * ordinary filters, when that is known from its maker or from this file's
   * own note. Absent is "not known", never "pods only". The ESE-machine article
   * names exactly these models (`content/journal/articles/ese-machine.ts`).
   */
  readonly alsoGround?: boolean;
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

/** Dolce Gusto NEO: paper pods, not the classic capsule (Nescafé Dolce Gusto FAQ). */
const dolceGustoNeo = (slug: string, name: string): MachineModel => ({
  slug,
  name,
  system: "dolce-gusto-neo",
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
      "Krups прави машини за няколко несъвместими системи: Dolce Gusto и Dolce Gusto NEO, Nespresso Original и Vertuo, и автоматични на зърна. Изберете модела — марката сама по себе си не казва коя капсула пасва.",
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
      dolceGustoNeo("krups-neo", "Dolce Gusto NEO Caffè (KP8301)"),
      dolceGustoNeo("krups-neo-latte", "Dolce Gusto NEO Latte (KP8501)"),
      nespresso("krups-nespresso-inissia", "Nespresso Inissia"),
      nespresso("krups-nespresso-essenza", "Nespresso Essenza"),
      nespresso("krups-nespresso-pixie", "Nespresso Pixie"),
      nespresso("krups-nespresso-citiz", "Nespresso CitiZ"),
      vertuo("krups-nespresso-vertuo", "Nespresso Vertuo (всички модели)"),
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
      dolceGustoNeo("delonghi-neo", "Dolce Gusto NEO Barista (NEO300)"),
      // Vertuo Lattissima is a Vertuo machine; these four are Original.
      nespresso("delonghi-nespresso-lattissima", "Nespresso Lattissima One, Touch, Pro, Gran"),
      nespresso("delonghi-nespresso-inissia", "Nespresso Inissia"),
      nespresso("delonghi-nespresso-citiz", "Nespresso CitiZ"),
      vertuo("delonghi-nespresso-vertuo", "Nespresso Vertuo (всички модели, и Vertuo Lattissima)"),
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
        alsoGround: true,
        note: "Работи с мляно кафе. С цедката за дози приема и хартиени дози ESE 44 мм.",
      },
    ],
  },
  {
    slug: "lavazza",
    name: "Lavazza",
    aliases: ["лаваца", "лавазза"],
    summary:
      "Lavazza има няколко несъвместими системи: A Modo Mio за дома, а за офиса Blue, Espresso Point и Firma. Проверете какво пише на машината.",
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
      /* As a family: Lavazza names the system, and the model codes we have
         seen are not from Lavazza's own pages. LF 300 is, from its manual. */
      {
        slug: "lavazza-espresso-point",
        name: "Espresso Point (всички модели)",
        system: "lavazza-espresso-point",
      },
      { slug: "lavazza-lf-300", name: "Firma LF 300 Inovy Mini", system: "lavazza-firma" },
    ],
  },
  {
    slug: "caffitaly",
    name: "Caffitaly",
    aliases: ["кафитали"],
    summary:
      "Машините със знака Caffitaly System приемат един и същ формат капсула. Професионалните машини Caffitaly и Coffee For You са друг формат.",
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
      {
        slug: "caffitaly-professional",
        name: "Caffitaly Professional (всички модели)",
        system: "caffitaly-professional",
      },
      {
        slug: "caffitaly-coffee-for-you",
        name: "Coffee For You",
        system: "caffitaly-professional",
      },
    ],
  },
  {
    slug: "tchibo",
    name: "Tchibo",
    aliases: ["чибо", "кафисимо"],
    summary:
      "Машините Cafissimo използват формата на Caffitaly: Tchibo е партньор на системата и капсулите Caffitaly пасват в тях по размер и форма. Tchibo посочва, че в Cafissimo трябва да се използват само нейните капсули. Машините Qbo са друга система.",
    models: [
      caffitalyFormat("tchibo-cafissimo-classic", "Cafissimo Classic"),
      caffitalyFormat("tchibo-cafissimo-pure", "Cafissimo Pure"),
      caffitalyFormat("tchibo-cafissimo-mini", "Cafissimo Mini"),
      caffitalyFormat("tchibo-cafissimo-latte", "Cafissimo Latte"),
      caffitalyFormat("tchibo-cafissimo-compact", "Cafissimo Compact"),
      caffitalyFormat("tchibo-cafissimo-tuttocaffe", "Cafissimo Tuttocaffè"),
      { slug: "tchibo-qbo", name: "Qbo (всички модели)", system: "tchibo-qbo" },
    ],
  },
  {
    slug: "k-fee",
    name: "K-fee",
    aliases: ["к фи"],
    summary:
      "K-fee е собствена система капсули, не Caffitaly: машините приемат капсулите на K-fee и EXPRESSI на Aldi.",
    // K-fee's current range, as k-fee.com lists it.
    models: [
      { slug: "k-fee-one", name: "ONE", system: "k-fee" },
      { slug: "k-fee-square", name: "SQUARE", system: "k-fee" },
      { slug: "k-fee-twins", name: "TWINS II", system: "k-fee" },
      { slug: "k-fee-lattensia", name: "LATTENSIA+", system: "k-fee" },
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
        // Gaggia: "3 filters available ... for ground coffee or coffee pods",
        // https://www.gaggia.com/manual-machines/new-classic-e24/
        alsoGround: true,
        note: "С цедката за дози приема хартиени дози ESE 44 мм.",
      },
      {
        slug: "gaggia-carezza",
        name: "Carezza (ръчна с цедка)",
        system: "ese-pod",
        // Gaggia: "comes with a filter for 1 or 2 cups of ground coffee, and a
        // special filter for coffee pods",
        // https://www.gaggia.com/manual-machines/carezza-deluxe/
        alsoGround: true,
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
        // Smeg: "The ECF01 espresso coffee machine works with paper pods or
        // ground blends" (smeg.com/ie/inspirations/coffee-set---an-unadulterated-luxury.html).
        alsoGround: true,
        note: "С цедката за дози приема хартиени дози ESE 44 мм.",
      },
    ],
  },
  {
    slug: "illy",
    name: "illy",
    aliases: ["или", "илли"],
    summary:
      "Машините Iperespresso приемат само собствените капсули на illy, а Easy работи с хартиени дози ESE.",
    models: [
      { slug: "illy-y3", name: "Y3.3 Iperespresso", system: "illy-iperespresso" },
      { slug: "illy-y5", name: "Y5 Iperespresso", system: "illy-iperespresso" },
      { slug: "illy-x1", name: "X1 Iperespresso", system: "illy-iperespresso" },
      /*
       * illy's own X7.1 page: "designed specifically for our iperEspresso
       * capsules",
       * https://www.illy.com/en-us/coffee-machines/capsule-coffee-machines/x7-1-iperespresso-coffee-machine/coffee-machines-x71-iperespresso-us-P-1.html
       * Until 20 October 2026 this entry was „X7.1 (версия за дози)“ under ESE pods,
       * with no source: illy publishes no E.S.E. version of the X7.1, so an
       * owner was told that pods fit a capsule machine. Its slug is new rather
       * than reused, so the old anchor does not now say the opposite.
       */
      { slug: "illy-x7", name: "X7.1 Iperespresso", system: "illy-iperespresso" },
      /*
       * illy's own page: "Coffee Format E.S.E. Pods", and "the pod is inserted
       * at the top and disposed of into the pod-collection drawer",
       * https://www.illy.com/en-gb/espresso-machines/ese-coffee-machines/coffee-machine-illy-ese-red/coffee-machines-illyese-uk.html
       * No portafilter, so no pod filter either, and no ground coffee.
       */
      {
        slug: "illy-easy",
        name: "Easy (машина за дози)",
        system: "ese-pod",
        note: "Приема хартиени дози ESE: дозата се слага отгоре, а след кафето отива в чекмеджето за използвани дози.",
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

/**
 * Slugs a model was listed under before, and the slug it has now.
 *
 * A model's slug is in wizard links and in anchors on its brand's page, so a
 * model that was listed wrongly and corrected keeps answering under the old
 * slug, as what it really is. `illy-x7-ese` claimed the X7.1 took ESE pods;
 * it now names the Iperespresso machine, so a link that pairs it with the pod
 * system contradicts itself and the wizard drops both halves.
 */
const MOVED_MODEL_SLUGS: Readonly<Record<string, string>> = {
  "illy-x7-ese": "illy-x7",
};

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
  const current = Object.hasOwn(MOVED_MODEL_SLUGS, slug) ? MOVED_MODEL_SLUGS[slug] : slug;
  return MODELS_BY_SLUG.get(current ?? slug) ?? null;
}

/** Every model in the database, flattened. Used by tests and by search. */
export function allMachineModels(): ReadonlyArray<{
  readonly brand: MachineBrand;
  readonly model: MachineModel;
}> {
  return [...MODELS_BY_SLUG.values()];
}
