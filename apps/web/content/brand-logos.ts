import { brandLookupKey } from "../src/lib/catalog/brand-display";

/**
 * Brand logos, and where each one came from.
 *
 * A logo is a brand's trademark. We show it for one reason: to identify the
 * genuine product the shop sells, on the pages where the brand itself is the
 * subject (DESIGN.md, "Brand logo"). So every file here is the brand's own,
 * taken unmodified from the brand's own website, and checked against the mark
 * printed on the packs in our product photographs. The record of that check is
 * kept beside the file, because "may we show this?" is a question somebody
 * will ask again, and the answer should not depend on anybody's memory.
 *
 * Keyed by the brand's source key in lower-case kebab form, like
 * `brand-names.ts`; lookup is forgiving about separators and case, so a brand
 * whose storefront slug is `3bourbons` still finds `3-bourbons`.
 *
 * Three states, all deliberate:
 *
 *  - in `brandLogos`: the logo is shown;
 *  - in `brandsWithoutLogo`: we looked, found nothing we can use, and wrote
 *    down why — the brand is shown as text;
 *  - in neither: a brand the sync added after this file was written. It is
 *    shown as text until someone does the same search for it.
 *
 * The files live in `public/brands/` and are served from our own origin.
 */

export type BrandLogoGround = "light" | "dark";

export interface BrandLogoProvenance {
  /** Where the logo was found: the brand's own site in every case today. */
  readonly sourceType: "official-site" | "official-press-kit" | "wikimedia";
  /** The page the logo was found on. */
  readonly sourcePage: string;
  /** The file that was downloaded, or the page that embeds it (see `note`). */
  readonly assetUrl: string;
  /** ISO date the file was retrieved. */
  readonly retrievedAt: string;
  /** Which product photograph the logo was compared with, and what matched. */
  readonly packagingCheck: string;
  /** Anything a person re-checking this entry needs to know. */
  readonly note?: string;
}

export interface BrandLogo {
  /** Path under `public/`, served as is. */
  readonly file: string;
  readonly format: "svg" | "png";
  /** Intrinsic size: pixels for a PNG, the `viewBox` for an SVG. */
  readonly width: number;
  readonly height: number;
  /**
   * The ground the logo was drawn for. `light` sits on the page's own paper;
   * `dark` sits on an `ink-900` tile, because the brand publishes it only in
   * white (or in a colour that disappears on paper) and we never recolour it.
   */
  readonly ground: BrandLogoGround;
  /**
   * The smallest height, in CSS pixels, at which the brand's name in this
   * file (or, for a pure symbol, the symbol) can still be read — judged by eye
   * from renders at 1x. A stacked lockup whose name is a thin line under an
   * emblem needs far more height than a wordmark that fills the file. Below
   * it a placement shows the name in text instead. Absent: the rule's own
   * minimum (`MIN_HEIGHT` in `brand-logo.tsx`).
   */
  readonly minHeight?: number;
  readonly provenance: BrandLogoProvenance;
}

export interface BrandWithoutLogo {
  /** What was tried, and why nothing was taken. */
  readonly reason: string;
  /** ISO date of the search. */
  readonly checkedAt: string;
}

export const brandLogos: Readonly<Record<string, BrandLogo>> = {
  amann: {
    file: "/brands/amann.png",
    format: "png",
    width: 563,
    height: 267,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.amann-kaffee.at/",
      assetUrl:
        "https://www.amann-kaffee.at/wp-content/uploads/2026/06/cropped-amann_kaffee_logo_smaller_real_size.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Fazenda Rainha 0.5kg pack (a7d8ce08...jpg): "AMANN" in the same grotesque capitals as the website logo, followed by "Kaffee". The pack\'s "Kaffee" is a different, more formal calligraphic script than the website\'s handwritten "Kaffee", and the pack has an extra signature mark above. The same coffees (Fazenda Rainha, Finca Aurora, La Cascada) are sold on amann-kaffee.at, confirming it is the same Austrian roaster, not another Amann.',
      note: "The website's logo is the only official file; its script \"Kaffee\" differs from the pack's (likely a packaging variant). Unmodified download.",
    },
  },
  biancaffe: {
    file: "/brands/biancaffe.png",
    format: "png",
    width: 1204,
    height: 221,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.biancaffe.com/",
      assetUrl: "https://www.biancaffe.com/wp-content/uploads/2023/03/logo-b.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Photo fb6231cf... (Biancaffe Arabica 500 g): navy serif wordmark "Biancaffè" with grave accent, identical letterforms and navy colour to the file.',
      note: "Empty transparent space on the right trimmed (1538x221 to 1204x221); the artwork is untouched.",
    },
  },
  bianchi: {
    file: "/brands/bianchi.png",
    format: "png",
    width: 464,
    height: 276,
    ground: "light",
    minHeight: 24,
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://bianchi.bg/",
      assetUrl: "https://bianchi.bg/image/catalog/Assets/bianchi-logo-black.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Photos d3a18247... (Adore Espresso Bar pod) and cf880dcc... (Adore Grand Espresso): circular emblem (coffee bean with leaves, ring text FINE COFFEE SELECTION / AWAKE THE GOOD MOOD), "BIANCHI" in wide sans capitals, spaced "COFFEE" below. Same lockup (the packs print it in white on dark; file is the black version).',
      note: "The brand shop bianchi.bg is judged official by its brand content; no corporate statement found. Not the bicycle maker.",
    },
  },
  borbone: {
    file: "/brands/borbone.png",
    format: "png",
    width: 1377,
    height: 474,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.caffeborbone.com/it-it",
      assetUrl: "https://www.caffeborbone.com/it-it",
      retrievedAt: "2026-10-09",
      packagingCheck:
        "Product photo 'Капсули DG Borbone Baileys Cappuccino 16 бр.' (0f5632c4...jpg): CAFFÈ with crown above large BORBONE above NAPOLI - same letterforms, crown and layout (pack prints it white on blue, the logo here is the blue version).",
      note: "The file is the schema.org Organization \"logo\" embedded as a data URI (PNG, 1400x492) in that page's JSON-LD, trimmed of transparent margin. The header logo on the site is white-only; this blue one is the brand's own version for light grounds.",
    },
  },
  caffitaly: {
    file: "/brands/caffitaly.png",
    format: "png",
    width: 563,
    height: 242,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://caffitaly.com/international/",
      assetUrl:
        "https://caffitaly.com/international/wp-content/uploads/sites/3/2021/08/logo-caffitaly-trasp.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Photos 077f8c3a... (Cappuccino) and b0a06723... (Corposo): bold black "Caffitaly" wordmark, red-white-green swoosh over the f-i, "system" below right. Same letterforms and swoosh. DIFFERENCE: the file is the logo with a rounded-rectangle frame around the wordmark and a black "system" tab; the packs print the same wordmark and system text without the frame.',
      note: "A 2021 file from the brand's own media library. The 2026 website header uses a new mono wordmark that does not match the packs, so it was not used. Transparent margin trimmed.",
    },
  },
  elia: {
    file: "/brands/elia.png",
    format: "png",
    width: 296,
    height: 276,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://elia-bg.com/",
      assetUrl: "https://elia-bg.com/file/2018/05/elia_new_logo_320.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        '651a63c0...jpg (Dozeti Elia Esclusiva 50) and 21c5e3ed...jpg (Elia Espresso Vending Aroma 1kg): same red lowercase "elia" wordmark with the red swoosh underline and "COFFEE EMOTION / SINCE 1991" below.',
      note: "The official site is no longer live; the file is its header logo, fetched from the Internet Archive copy of 2018-10-28 (https://web.archive.org/web/20181028093846im_/https://elia-bg.com/file/2018/05/elia_new_logo_320.png). Transparent margin trimmed. Soft above about 140 px tall.",
    },
  },
  foodness: {
    file: "/brands/foodness.svg",
    format: "svg",
    width: 140,
    height: 61.3,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://foodness.it/",
      assetUrl: "https://foodness.it/wp-content/uploads/2024/09/logo_foodness_color.svg",
      retrievedAt: "2026-10-09",
      packagingCheck:
        "Product photo 'Капсули DG Foodness Mermaid Latte 10 бр.' (01a61e57...jpg): brown lowercase 'foodness' with a green leaf replacing the n and 'Free From' beneath, with registered mark - same wordmark and leaf (pack prints it vertically; the site's horizontal lockup is used).",
      note: "viewBox tightened from 0 0 140 61.4 to 0 0 140 61.3; no other change.",
    },
  },
  illy: {
    file: "/brands/illy.svg",
    format: "svg",
    width: 50,
    height: 50,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.illy.com/en-us",
      assetUrl:
        "https://www.illy.com/on/demandware.static/Sites-illy_US_SFRA-Site/-/default/dw4d708b82/images/logo-illy.svg",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'fa244ec2...jpg (Dozeti Illy Classico 18): the red square with the white hand-lettered "illy" and the (R) mark at the lower right is identical to the logo on the box.',
      note: "The red square is part of the mark. CSS classes were replaced by the same colours as inline fill attributes; no colour changed.",
    },
  },
  "julius-meinl": {
    file: "/brands/julius-meinl.svg",
    format: "svg",
    width: 198.43,
    height: 198.42,
    ground: "light",
    minHeight: 20,
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.juliusmeinl.com/",
      assetUrl: "https://www.juliusmeinl.com/App_Themes/Emakina/images/jm-logo-red.svg",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Espresso Arabica 1kg pack (e73bb289...jpg): white "Moor" head silhouette with raised coffee pot on a red panel, with serif "Julius Meinl" wordmark - same head and wordmark as the SVG (here on a red square, #d0122e).',
      note: "The red square is part of the mark. Only the <title> element was removed.",
    },
  },
  kimbo: {
    file: "/brands/kimbo.svg",
    format: "svg",
    width: 179,
    height: 56,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://kimbo.it/",
      assetUrl: "https://kimbo.it/cdn/shop/files/logo_lg-white.svg?v=1683639205",
      retrievedAt: "2026-10-09",
      packagingCheck:
        "Product photo 'Дозети Kimbo Amalfi 150бр.' (e6ef543e...jpg): red bold KIMBO wordmark with registered mark and brown italic script \"il Caffè di Napoli\" below - identical letterforms and colours to the SVG.",
      note: "Named 'white' on the site but it is the full-colour logo. Editor comments removed; viewBox tightened to the artwork.",
    },
  },
  lavazza: {
    file: "/brands/lavazza.svg",
    format: "svg",
    width: 4096,
    height: 1032.57,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.lavazza.com/en",
      assetUrl:
        "https://www.lavazza.com/etc.clientlibs/lavazza-athena/clientlibs/clientlib-site/resources/fonts/icons/icomoon.svg",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'c21c95f1...jpg (Dozeti Lavazza Crema e Gusto 100): the pack prints the same heavy LAVAZZA wordmark with the tall central A and the slanted L/Z/A letterforms, with "TORINO, ITALIA, 1895" beneath. The file is the wordmark without that tagline; the glyph "logo-torino" (U+E901) on the same site is the version with the tagline and matches the pack lockup exactly.',
      note: 'The site draws its header logo from an icon font; the file is that font\'s glyph "logo" (U+E900) taken as is, with the y axis flipped by a transform and the viewBox tightened to the artwork.',
    },
  },
  lollocafe: {
    file: "/brands/lollocafe.png",
    format: "png",
    width: 184,
    height: 80,
    ground: "dark",
    minHeight: 20,
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.lollocaffe.it/",
      assetUrl: "https://www.lollocaffe.it/wp-content/uploads/2026/02/logo-lollo-184x80-real.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Photos 2676a774..., c0f4999d..., 24b69701...: packs print a serif "LOLLO" in capitals, small bean mark above, tricolour line and a tagline ("CAFFÈ, GUSTO E PASSIONE" or "golosité"). The 2026 website header logo (184x80) shows exactly this mark, but only as WHITE on transparent.',
      note: 'The brand publishes the current mark only in white and only at 184x80, so it is shown on a dark tile and never above 80 px tall. Every dark-on-light file on the site is the retired 2021 "LOLLOCAFFE" mark, which does not match the packs.',
    },
  },
  "rema-caffe": {
    file: "/brands/rema-caffe.png",
    format: "png",
    width: 240,
    height: 63,
    ground: "dark",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.remacaffe.com/",
      assetUrl: "https://www.remacaffe.com/cdn/shop/files/REMACAFFE_LOGO_White_240px.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Photo b32f1fc3... (Arabica Gold pod): red "rema" + white "caffé" wordmark with acute é, same letterforms as the site logo. The site logo additionally has a leaf/bean emblem in a square at the left that the pack does not show.',
      note: 'The only official file (site header and Organization JSON-LD) has a white "caffé", so it is shown on a dark tile, as on the black pod, and never above 63 px tall.',
    },
  },
  tezzoro: {
    file: "/brands/tezzoro.png",
    format: "png",
    width: 1441,
    height: 405,
    ground: "light",
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://tezzoro.com/",
      assetUrl: "https://tezzoro.com/storage/2015/12/Tezzoro_logo_with_slogan_BLACK_big.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'd58378d3...jpg (Tezzoro Espresso Excellence 1kg): same wide bold TEZZ[sun]RO lettering with the sun/wave roundel as the second O, and the script slogan "Excellence has a taste" under a rule.',
      note: "The site header uses a gold version of the same file; the brand's own black-ink version is used for light grounds.",
    },
  },
  vandino: {
    file: "/brands/vandino.png",
    format: "png",
    width: 244,
    height: 150,
    ground: "dark",
    minHeight: 24,
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://vandinocaffe.com/",
      assetUrl: "https://vandinocaffe.com/templates/default/images/logo_big.png",
      retrievedAt: "2026-10-09",
      packagingCheck:
        "Product photo 'Кафе на зърна Vandino Espresso Aroma 1кг.' (f110d45c...jpg): gold cup-and-V symbol above gold VANDINO wordmark with rule and CAFFÈ beneath - same symbol and letterforms.",
      note: "The only logo is gold (#D2AC67) on transparent, drawn for the dark-green pack: about 2.1:1 on white, under the 3:1 a graphic needs. It is shown on a dark tile, like the pack, and never above 150 px tall.",
    },
  },
  vergnano: {
    file: "/brands/vergnano.svg",
    format: "svg",
    width: 90.367,
    height: 90.361,
    ground: "light",
    minHeight: 20,
    provenance: {
      sourceType: "official-site",
      sourcePage: "https://www.caffevergnano.com/",
      assetUrl: "https://www.caffevergnano.com/",
      retrievedAt: "2026-10-09",
      packagingCheck:
        'Antica Bottega 1kg pack (3643209e...jpg): black roundel with gold ring, white "CAFFÈ VERGNANO" arched over red "1882" - same roundel, letterforms and colours as the website SVG.',
      note: "The site publishes no standalone file: this is the inline <svg> from its header (.site-branding .logo-container), extracted verbatim. The roundel is the brand's only logo.",
    },
  },
};

export const brandsWithoutLogo: Readonly<Record<string, BrandWithoutLogo>> = {
  "3-bourbons": {
    reason:
      "No official source publishes the mark. The maker's site (Atelier del Caffe Terroir) no longer resolves and its archived copies hold no logo file; nothing on Wikimedia Commons. Retailer copies are not used.",
    checkedAt: "2026-10-09",
  },
  este: {
    reason:
      "No official site could be confirmed against the packaging (a gold ESTE wordmark with a coffee-flower symbol): the domains tried are unrelated or parked. Nothing taken from resellers or aggregators.",
    checkedAt: "2026-10-09",
  },
  eurocaf: {
    reason:
      "The roaster's site (eurocafcaffe.it) shows a different mark from the one on our vending packs, and the pack mark is published nowhere official, so neither was taken.",
    checkedAt: "2026-10-09",
  },
  molini: {
    reason:
      "No official brand website publishes the wordmark: the only brand-owned page is password-gated and sets the name as text. Resellers and Wikimedia Commons have nothing usable.",
    checkedAt: "2026-10-09",
  },
};

const LOGOS = new Map(Object.entries(brandLogos).map(([key, logo]) => [brandLookupKey(key), logo]));

/**
 * The logo for a brand, by its source key or storefront slug; null when there
 * is none (no logo found, or a brand this file has not heard of).
 *
 * Never by display name: names are what we print, and two spellings of one
 * name must not decide whether a trademark appears.
 */
export function brandLogoFor(keyOrSlug: string | null | undefined): BrandLogo | null {
  if (!keyOrSlug) return null;
  return LOGOS.get(brandLookupKey(keyOrSlug)) ?? null;
}
