import type { LocaleSlugs } from "./types";

/**
 * Every English slug, ready for the day English ships (`LOCALE_READY.en`).
 * Until then nothing links here and the proxy serves nothing under `/en`.
 *
 * The words are the ones an English speaker searches with — `coffee capsules`,
 * `nespresso capsules` — rather than renderings of the Bulgarian, and the
 * section names follow the provisional table in the slug research. Product
 * slugs are not here: products keep one stored slug, and the English one is
 * answered by `productSlug()` in `lib/routes.ts`.
 */
export const en: LocaleSlugs = {
  segments: {
    kategorii: "categories",
    marki: "brands",
    tarsene: "search",
    promotsii: "offers",
    "kafe-za-vending-mashini": "vending-coffee",
    konsumativi: "consumables",
    "dostavka-i-plashtane": "delivery-and-payment",
    kontakti: "contact",
    poveritelnost: "privacy",
    "obshti-usloviya": "terms",
    biskvitki: "cookies",
    blog: "journal",
    "izbor-na-kafe": "which-coffee",
    "izbor-na-kafe/rezultat": "result",
    "za-kafemashina": "by-machine",
    byuletin: "newsletter",
    "byuletin/otpisvane": "unsubscribe",
  },
  categories: {
    "kafe-kapsuli": "coffee-capsules",
    nespresso: "nespresso-capsules",
    "dolce-gusto": "dolce-gusto-capsules",
    "lavazza-blue": "lavazza-blue-capsules",
    "a-modo-mio": "lavazza-a-modo-mio-capsules",
    caffitaly: "caffitaly-capsules",
    "kafe-na-zyrna": "coffee-beans",
    "kafe-dozi": "ese-coffee-pods",
  },
  // As in Bulgarian: a brand's name is the same in every language.
  brands: {
    lollocafe: "lollo-caffe",
    "3-bourbons": "3-bourbons",
  },
};
