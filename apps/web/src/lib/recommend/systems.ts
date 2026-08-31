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
    summary: "Малки алуминиеви капсули за класическите машини Nespresso.",
    recognise:
      "Капсулата е малка, с формата на пресечен конус, около 37 мм в диаметър, най-често алуминиева.",
    method: "capsule",
    categorySlugs: ["nespresso"],
    categorySourceKeys: ["nespresso"],
  },
  {
    id: "dolce-gusto",
    name: "Dolce Gusto",
    summary: "Големи пластмасови капсули с фолио отгоре.",
    recognise:
      "Капсулата е широка и плоска, пластмасова, със сребристо фолио и баркод по ръба, който машината разчита.",
    method: "capsule",
    categorySlugs: ["dolce-gusto"],
    categorySourceKeys: ["dolce-gusto"],
  },
  {
    id: "a-modo-mio",
    name: "Lavazza A Modo Mio",
    summary: "Капсули за домашните машини на Lavazza.",
    recognise: "Капсулата е малка и пластмасова, обикновено черна, с широк ръб отгоре.",
    method: "capsule",
    categorySlugs: ["a-modo-mio"],
    categorySourceKeys: ["a-modo-mio"],
  },
  {
    id: "caffitaly",
    name: "Caffitaly",
    summary: "Капсули Caffitaly — същият формат работи и в Tchibo Cafissimo и K-fee.",
    recognise:
      "Капсулата е пластмасова, с прозрачна или бяла основа и лека форма на чашка с пръстен отгоре.",
    method: "capsule",
    categorySlugs: ["caffitaly"],
    categorySourceKeys: ["caffitaly"],
  },
  {
    id: "lavazza-blue",
    name: "Lavazza Blue",
    summary: "Капсули за професионалните машини Lavazza Blue, най-често в офиси.",
    recognise:
      "Капсулата е по-голяма и по-твърда от A Modo Mio; машината обикновено носи означение LB.",
    method: "capsule",
    categorySlugs: ["lavazza-blue"],
    categorySourceKeys: ["lavazza-blue"],
  },
  {
    id: "ese-pod",
    name: "Дози ESE",
    summary: "Хартиени дози 44 мм за машини с цедка за дози.",
    recognise:
      "Дозата е плоска хартиена възглавничка с диаметър 44 мм. Пасва на еспресо машина с цедка за дози.",
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
