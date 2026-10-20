/**
 * Brewing systems.
 *
 * The single hard constraint in this shop. Everything else a customer might
 * tell us is a preference that can be traded off; a Dolce Gusto capsule in a
 * Nespresso machine is simply an unusable purchase, so compatibility is
 * decided before any scoring happens and is never relaxed.
 *
 * A system is bound to catalog categories by *both* our storefront slug and
 * the source key behind it. The slug is derived from the category's Bulgarian
 * name, so a rename upstream would silently change it; the source key is
 * stable. Matching either means a rename degrades to "we found it by the other
 * key" instead of to an empty wizard.
 *
 * Nothing here is scraped. It is our own editorial data, which is what makes
 * it the part of the storefront the source does not have.
 */

export type BrewMethod = "capsule" | "beans" | "pod";

export type BrewingSystemId =
  | "nespresso-original"
  | "dolce-gusto"
  | "a-modo-mio"
  | "caffitaly"
  | "lavazza-blue"
  | "ese-pod"
  | "beans";

export interface BrewingSystem {
  readonly id: BrewingSystemId;
  readonly name: string;
  /** How the customer would describe it out loud. */
  readonly summary: string;
  /** What to look for, for someone who does not know what they own. */
  readonly recognise: string;
  /**
   * The machines it fits, where „машини <name>“ would promise too much: the
   * Dolce Gusto name is also on the NEO machines, which take none of these
   * capsules. Completes „Става за …“.
   */
  readonly fits?: string;
  readonly method: BrewMethod;
  /** Storefront category slugs that hold this system's products. */
  readonly categorySlugs: readonly string[];
  /** Source keys for the same categories; stable across a rename upstream. */
  readonly categorySourceKeys: readonly string[];
}

export const BREWING_SYSTEMS: readonly BrewingSystem[] = [
  {
    id: "nespresso-original",
    name: "Nespresso Original",
    summary: "Малки капсули с форма на пресечен конус за класическите машини Nespresso.",
    recognise:
      "Капсулата е малка, с формата на пресечен конус, който завършва с тесен плосък връх: 37 мм в диаметър при ръба и 28 мм висока. Може да е алуминиева или пластмасова.",
    method: "capsule",
    categorySlugs: ["nespresso"],
    categorySourceKeys: ["nespresso"],
  },
  {
    id: "dolce-gusto",
    name: "Dolce Gusto",
    summary: "Големи пластмасови капсули с фолио отгоре.",
    fits: "класическите машини Dolce Gusto (не NEO)",
    recognise:
      "Капсулата е голяма и пластмасова: 54 мм в диаметър и 36 мм висока, с фолио отгоре и малък накрайник в средата на дъното.",
    method: "capsule",
    categorySlugs: ["dolce-gusto"],
    categorySourceKeys: ["dolce-gusto"],
  },
  {
    id: "a-modo-mio",
    name: "Lavazza A Modo Mio",
    summary: "Капсули за домашните машини на Lavazza.",
    recognise:
      "Капсулата е широка и плитка: 47 мм в диаметър при ръба и само 17 мм висока, пластмасова.",
    method: "capsule",
    categorySlugs: ["a-modo-mio"],
    categorySourceKeys: ["a-modo-mio"],
  },
  {
    id: "caffitaly",
    name: "Caffitaly",
    summary: "Капсули за машините Caffitaly System; същият формат използва и Tchibo Cafissimo.",
    recognise:
      "Капсулата е пластмасова, 45 мм в диаметър и 27 мм висока, с почти прави стени, жлеб в долната част и заоблено дъно. Цветът ѝ зависи от марката и кафето.",
    method: "capsule",
    categorySlugs: ["caffitaly"],
    categorySourceKeys: ["caffitaly"],
  },
  {
    id: "lavazza-blue",
    name: "Lavazza Blue",
    summary: "Капсули за професионалните машини Lavazza Blue, най-често в офиси.",
    recognise:
      "Капсулата е пластмасова и широка 47 мм като A Modo Mio, но е по-дълбока — 26 мм — и тялото ѝ се стеснява надолу. Машината обикновено носи означение LB.",
    method: "capsule",
    categorySlugs: ["lavazza-blue"],
    categorySourceKeys: ["lavazza-blue"],
  },
  {
    id: "ese-pod",
    name: "Дози ESE",
    summary: "Хартиени дози 44 мм за машини с цедка за дози.",
    recognise:
      "Дозата е плоска възглавничка от филтърна хартия: кафето в нея е 44 мм в диаметър, а хартиеният ръб около него е по-широк. Пасва на еспресо машина с цедка за дози или на машина само за дози.",
    method: "pod",
    categorySlugs: ["kafe-dozi"],
    categorySourceKeys: ["kafe-dozi"],
  },
  {
    id: "beans",
    name: "Кафе на зърна",
    summary: "За автоматична кафемашина с вградена мелачка или за собствена мелачка.",
    recognise: "Машината мели зърната сама — сипвате зърна в контейнер отгоре, не капсула.",
    method: "beans",
    categorySlugs: ["kafe-na-zarna", "kafe-na-zyrna"],
    categorySourceKeys: ["kafe-na-zyrna"],
  },
];

const SYSTEMS_BY_ID = new Map(BREWING_SYSTEMS.map((system) => [system.id, system]));

/** „Става за …“: the machines a capsule system fits, as a sentence. */
export function fitsSentence(system: BrewingSystem): string {
  return `Става за ${system.fits ?? `машини ${system.name}`}.`;
}

export function getBrewingSystem(id: string | null | undefined): BrewingSystem | null {
  if (!id) return null;
  return SYSTEMS_BY_ID.get(id as BrewingSystemId) ?? null;
}

export function systemsForMethod(method: BrewMethod): readonly BrewingSystem[] {
  return BREWING_SYSTEMS.filter((system) => system.method === method);
}

/**
 * Systems we do not stock.
 *
 * These exist in the machine finder for one reason: someone with a Vertuo
 * machine must be told plainly that nothing here fits it. Leaving them out
 * would leave that person clicking through a wizard that ends in a shrug, and
 * listing them as if they were supported would sell them a capsule that does
 * not go in.
 */
export type UnsupportedSystemId =
  | "nespresso-vertuo"
  | "nespresso-professional"
  | "dolce-gusto-neo"
  | "k-fee"
  | "tchibo-qbo"
  | "caffitaly-professional"
  | "lavazza-espresso-point"
  | "lavazza-firma"
  | "tassimo"
  | "illy-iperespresso"
  | "k-cup"
  | "bialetti-i-caffe"
  | "ground";

export interface UnsupportedSystem {
  readonly id: UnsupportedSystemId;
  readonly name: string;
  /** Said to the customer, in their own terms. */
  readonly explanation: string;
}

export const UNSUPPORTED_SYSTEMS: readonly UnsupportedSystem[] = [
  {
    id: "nespresso-vertuo",
    name: "Nespresso Vertuo",
    explanation:
      "Vertuo чете баркод по ръба на капсулата и приема само капсули Vertuo. Капсулите за класическите машини Nespresso не пасват, а ние нямаме Vertuo в асортимента си.",
  },
  {
    id: "nespresso-professional",
    name: "Nespresso Professional",
    explanation:
      "Професионалните машини Nespresso използват по-голяма капсула от домашните. Нямаме такива капсули.",
  },
  {
    /* Nescafé Dolce Gusto's own FAQ: NEO takes only NEO pods and sachets, and
       NEO pods do not go in the Original machines either. */
    id: "dolce-gusto-neo",
    name: "Dolce Gusto NEO",
    explanation:
      "NEO е отделна система на Dolce Gusto с хартиени дози и различна технология. Класическите капсули Dolce Gusto не пасват в NEO, а дози NEO нямаме.",
  },
  {
    /* k-fee.com: compatible with K-fee's own capsules and Aldi Süd's EXPRESSI.
       Caffitaly: its capsules are for Caffitaly System machines only. */
    id: "k-fee",
    name: "K-fee",
    explanation:
      "K-fee е собствена система: машините приемат капсулите на K-fee и EXPRESSI на Aldi. Капсулите Caffitaly са само за машини Caffitaly System, а капсули K-fee нямаме.",
  },
  {
    id: "tchibo-qbo",
    name: "Tchibo Qbo",
    explanation:
      "Машините Qbo приемат само капсулите Qbo на Tchibo, различни от Cafissimo. Нямаме капсули Qbo.",
  },
  {
    // Caffitaly's own FAQ: these machines do not take Caffitaly System capsules.
    id: "caffitaly-professional",
    name: "Caffitaly Professional и Coffee For You",
    explanation:
      "Професионалните машини Caffitaly и машините Coffee For You не приемат капсулите Caffitaly System, които предлагаме. Нямаме капсули за тях.",
  },
  {
    id: "lavazza-espresso-point",
    name: "Lavazza Espresso Point",
    explanation:
      "Espresso Point е отделна офис система на Lavazza: капсулите ѝ не пасват в Blue и обратно. Нямаме капсули Espresso Point.",
  },
  {
    id: "lavazza-firma",
    name: "Lavazza Firma",
    explanation:
      "Firma е отделна офис система на Lavazza, различна от Blue и Espresso Point. Нямаме капсули Firma.",
  },
  {
    id: "tassimo",
    name: "Tassimo",
    explanation:
      "Tassimo използва дискове с баркод, различни от всичко останало. Нямаме дискове за Tassimo.",
  },
  {
    id: "illy-iperespresso",
    name: "illy Iperespresso",
    explanation:
      "Машините Iperespresso приемат само капсулите на illy с двукамерна форма. Нямаме такива капсули.",
  },
  {
    id: "k-cup",
    name: "Keurig K-Cup",
    explanation:
      "K-Cup е американски формат, който не се среща в тези машини. Нямаме K-Cup капсули.",
  },
  {
    id: "bialetti-i-caffe",
    name: "Bialetti i Caffè d'Italia",
    explanation:
      "Капсулите на Bialetti са собствен формат и не се заменят с друг. Нямаме такива капсули.",
  },
  {
    id: "ground",
    name: "Мляно кафе",
    explanation:
      "В момента предлагаме кафе на зърна, капсули и дози, но не и предварително мляно кафе в пакет.",
  },
];

const UNSUPPORTED_BY_ID = new Map(UNSUPPORTED_SYSTEMS.map((system) => [system.id, system]));

export function getUnsupportedSystem(id: string | null | undefined): UnsupportedSystem | null {
  if (!id) return null;
  return UNSUPPORTED_BY_ID.get(id as UnsupportedSystemId) ?? null;
}

/** Every system id the machine database is allowed to point at. */
export type AnySystemId = BrewingSystemId | UnsupportedSystemId;

export function isSupportedSystem(id: AnySystemId): id is BrewingSystemId {
  return SYSTEMS_BY_ID.has(id as BrewingSystemId);
}
