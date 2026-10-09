/**
 * Where each brand logo came from, and why the ones we lack are missing.
 *
 * A logo is a brand's trademark. We show it for one reason: to identify the
 * genuine product the shop sells, on the pages where the brand itself is the
 * subject (DESIGN.md, "Brand logo"). So every file in `public/brand-logos/` is the
 * brand's own, published by the brand itself — its website, the website of
 * the company that owns the label, or the brand's own social media page —
 * and checked against the mark printed on the packs in our product
 * photographs. Each record says what, if anything, was done to the file. The
 * record of that check is kept here, because "may we show this?" is a
 * question somebody will ask again, and the answer should not depend on
 * anybody's memory.
 *
 * Keyed exactly like `brandLogos` in `brand-logos.ts`, which holds what a page
 * needs to draw each logo. Three states, all deliberate:
 *
 *  - in both files: the logo is shown, and this is where it came from;
 *  - in `brandsWithoutLogo`: we looked, found nothing we can use, and wrote
 *    down why — the brand is shown as text;
 *  - in neither: a brand the sync added after these files were written. It is
 *    shown as text until someone does the same search for it.
 *
 * Kept out of the page code on purpose: `brand-logos.ts` reaches the browser,
 * this file is imported only by tests, and nothing a visitor sees renders it.
 * `test/brand-logo.test.ts` checks that every logo has a record here and every
 * record a logo.
 */

/**
 * Where a logo was found, in the order a source is preferred:
 *
 *  - `official-site` / `official-press-kit`: the brand's own website;
 *  - `owner-company`: the website of the company that owns the label (for a
 *    house brand with no site of its own), with the ownership recorded in
 *    `note`;
 *  - `official-social`: the brand's own social media page (its profile
 *    picture or its own post);
 *  - `wikimedia`: Wikimedia Commons.
 *
 * Logo libraries and other retailers' copies are a last resort that no
 * record uses today.
 */
export type BrandLogoSourceType =
  "official-site" | "official-press-kit" | "owner-company" | "official-social" | "wikimedia";

export interface BrandLogoProvenance {
  /** Where the logo was found. */
  readonly sourceType: BrandLogoSourceType;
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

export interface BrandWithoutLogo {
  /** What was tried, and why nothing was taken. */
  readonly reason: string;
  /** ISO date of the search. */
  readonly checkedAt: string;
}

export const brandLogoProvenance: Readonly<Record<string, BrandLogoProvenance>> = {
  "3-bourbons": {
    sourceType: "official-social",
    sourcePage: "https://www.facebook.com/3Bourbons/",
    assetUrl: "https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=100063595568051",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'b713a0fd...jpg (Дозети 3bourbons 50бр.): the large brush-stroke "3" whose tail sweeps under the script "Bourbons" (looped B, the same brushed "ourbons") is the same mark, letter for letter. DIFFERENCES: the profile picture draws the "3" in a gold gradient where the pod prints it in dark brown, and its tagline is "тероарно кафе" where the pod has "blend of terroir coffees".',
    note: 'The brand\'s own Facebook page ("3 Bourbons - тероарно, порционно кафе, еспресо дозети"); the file is its profile picture, the page\'s og:image, a 1181x1181 JPEG on white. It was made transparent by exact colour-to-alpha against white (drawn over white it gives back the JPEG to within 3/255 per channel; pixels within 3/255 of white, JPEG noise in the ground, became fully transparent) and its margin trimmed, then scaled down losslessly from 776x657 to 400x339, which is still sharp in the largest box at twice the pixel density and a third of the weight; the artwork is otherwise untouched. No brand website exists: the maker named by retailers, "Atelier del caffe terroir", has no site that resolves. Below 28 px tall the script name cannot be read.',
  },
  amann: {
    sourceType: "official-site",
    sourcePage: "https://www.amann-kaffee.at/",
    assetUrl:
      "https://www.amann-kaffee.at/wp-content/uploads/2026/06/cropped-amann_kaffee_logo_smaller_real_size.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Fazenda Rainha 0.5kg pack (a7d8ce08...jpg): "AMANN" in the same grotesque capitals as the website logo, followed by "Kaffee". The pack\'s "Kaffee" is a different, more formal calligraphic script than the website\'s handwritten "Kaffee", and the pack has an extra signature mark above. The same coffees (Fazenda Rainha, Finca Aurora, La Cascada) are sold on amann-kaffee.at, confirming it is the same Austrian roaster, not another Amann.',
    note: "The website's logo is the only official file; its script \"Kaffee\" differs from the pack's (likely a packaging variant). Unmodified download.",
  },
  biancaffe: {
    sourceType: "official-site",
    sourcePage: "https://www.biancaffe.com/",
    assetUrl: "https://www.biancaffe.com/wp-content/uploads/2023/03/logo-b.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Photo fb6231cf... (Biancaffe Arabica 500 g): navy serif wordmark "Biancaffè" with grave accent, identical letterforms and navy colour to the file.',
    note: "Empty transparent space on the right trimmed (1538x221 to 1204x221); the artwork is untouched.",
  },
  bianchi: {
    sourceType: "official-site",
    sourcePage: "https://bianchi.bg/",
    assetUrl: "https://bianchi.bg/image/catalog/Assets/bianchi-logo-black.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Photos d3a18247... (Adore Espresso Bar pod) and cf880dcc... (Adore Grand Espresso): circular emblem (coffee bean with leaves, ring text FINE COFFEE SELECTION / AWAKE THE GOOD MOOD), "BIANCHI" in wide sans capitals, spaced "COFFEE" below. Same lockup (the packs print it in white on dark; file is the black version).',
    note: "The brand shop bianchi.bg is judged official by its brand content; no corporate statement found. Not the bicycle maker.",
  },
  borbone: {
    sourceType: "official-site",
    sourcePage: "https://www.caffeborbone.com/it-it",
    assetUrl: "https://www.caffeborbone.com/it-it",
    retrievedAt: "2026-10-09",
    packagingCheck:
      "Product photo 'Капсули DG Borbone Baileys Cappuccino 16 бр.' (0f5632c4...jpg): CAFFÈ with crown above large BORBONE above NAPOLI - same letterforms, crown and layout (pack prints it white on blue, the logo here is the blue version).",
    note: "The file is the schema.org Organization \"logo\" embedded as a data URI (PNG, 1400x492) in that page's JSON-LD, trimmed of transparent margin. The header logo on the site is white-only; this blue one is the brand's own version for light grounds.",
  },
  caffitaly: {
    sourceType: "official-site",
    sourcePage: "https://caffitaly.com/international/",
    assetUrl:
      "https://caffitaly.com/international/wp-content/uploads/sites/3/2021/08/logo-caffitaly-trasp.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Photos 077f8c3a... (Cappuccino) and b0a06723... (Corposo): bold black "Caffitaly" wordmark, red-white-green swoosh over the f-i, "system" below right. Same letterforms and swoosh. DIFFERENCE: the file is the logo with a rounded-rectangle frame around the wordmark and a black "system" tab; the packs print the same wordmark and system text without the frame.',
    note: "A 2021 file from the brand's own media library. The 2026 website header uses a new mono wordmark that does not match the packs, so it was not used. Transparent margin trimmed.",
  },
  elia: {
    sourceType: "official-site",
    sourcePage: "https://elia-bg.com/",
    assetUrl: "https://elia-bg.com/file/2018/05/elia_new_logo_320.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      '651a63c0...jpg (Dozeti Elia Esclusiva 50) and 21c5e3ed...jpg (Elia Espresso Vending Aroma 1kg): same red lowercase "elia" wordmark with the red swoosh underline and "COFFEE EMOTION / SINCE 1991" below.',
    note: "The official site is no longer live; the file is its header logo, fetched from the Internet Archive copy of 2018-10-28 (https://web.archive.org/web/20181028093846im_/https://elia-bg.com/file/2018/05/elia_new_logo_320.png). Transparent margin trimmed. Soft above about 140 px tall.",
  },
  este: {
    sourceType: "owner-company",
    sourcePage: "https://cafeshop.bg/produkt-kategoriya/vending/",
    assetUrl: "https://cafeshop.bg/wp-content/uploads/2025/03/este_coffee_logo.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      '36cb2aa7...jpg (Este Aroma 1kg): ring of eight coffee beans above "ESTE" in wide gold capitals with a dark offset shadow, thin rules either side, spaced "COFFEE" below. Same symbol, letterforms and gold; the pack sets the lockup on a red band, the file on transparent.',
    note: 'Este is a house brand of Европейски Кафе Експерти ООД (Enco Vending until 2025): its company history (https://www.enco-vending.com/about/history) records launching "собствена марка кафе за вендинг автомати с наименование Este Vending" in 2007, and the side panel of its own Este Aroma packshot carries the ENCO mark. cafeshop.bg is that company\'s shop (its terms name "ЕВРОПЕЙСКИ КАФЕ ЕКСПЕРТИ" ООД as the trader); the file is the brand image on its vending page, taken unmodified. enco-vending.com shows only an older grey "Este vending" script mark at 78x70, which does not match the packs. The gold fill alone is about 2.6:1 on white, but every letter carries a dark shadow and "COFFEE" is near-black, so it sits on paper; a dark tile would lose both. Below 24 px tall the gold "ESTE" is too faint to read.',
  },
  foodness: {
    sourceType: "official-site",
    sourcePage: "https://foodness.it/",
    assetUrl: "https://foodness.it/wp-content/uploads/2024/09/logo_foodness_color.svg",
    retrievedAt: "2026-10-09",
    packagingCheck:
      "Product photo 'Капсули DG Foodness Mermaid Latte 10 бр.' (01a61e57...jpg): brown lowercase 'foodness' with a green leaf replacing the n and 'Free From' beneath, with registered mark - same wordmark and leaf (pack prints it vertically; the site's horizontal lockup is used).",
    note: "viewBox tightened from 0 0 140 61.4 to 0 0 140 61.3; no other change.",
  },
  illy: {
    sourceType: "official-site",
    sourcePage: "https://www.illy.com/en-us",
    assetUrl:
      "https://www.illy.com/on/demandware.static/Sites-illy_US_SFRA-Site/-/default/dw4d708b82/images/logo-illy.svg",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'fa244ec2...jpg (Dozeti Illy Classico 18): the red square with the white hand-lettered "illy" and the (R) mark at the lower right is identical to the logo on the box.',
    note: "The red square is part of the mark. CSS classes were replaced by the same colours as inline fill attributes; no colour changed.",
  },
  "julius-meinl": {
    sourceType: "official-site",
    sourcePage: "https://www.juliusmeinl.com/",
    assetUrl: "https://www.juliusmeinl.com/App_Themes/Emakina/images/jm-logo-red.svg",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Espresso Arabica 1kg pack (e73bb289...jpg): white "Moor" head silhouette with raised coffee pot on a red panel, with serif "Julius Meinl" wordmark - same head and wordmark as the SVG (here on a red square, #d0122e).',
    note: "The red square is part of the mark. Only the <title> element was removed.",
  },
  kimbo: {
    sourceType: "official-site",
    sourcePage: "https://kimbo.it/",
    assetUrl: "https://kimbo.it/cdn/shop/files/logo_lg-white.svg?v=1683639205",
    retrievedAt: "2026-10-09",
    packagingCheck:
      "Product photo 'Дозети Kimbo Amalfi 150бр.' (e6ef543e...jpg): red bold KIMBO wordmark with registered mark and brown italic script \"il Caffè di Napoli\" below - identical letterforms and colours to the SVG.",
    note: "Named 'white' on the site but it is the full-colour logo. Editor comments removed; viewBox tightened to the artwork.",
  },
  lavazza: {
    sourceType: "official-site",
    sourcePage: "https://www.lavazza.com/en",
    assetUrl:
      "https://www.lavazza.com/etc.clientlibs/lavazza-athena/clientlibs/clientlib-site/resources/fonts/icons/icomoon.svg",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'c21c95f1...jpg (Dozeti Lavazza Crema e Gusto 100): the pack prints the same heavy LAVAZZA wordmark with the tall central A and the slanted L/Z/A letterforms, with "TORINO, ITALIA, 1895" beneath. The file is the wordmark without that tagline; the glyph "logo-torino" (U+E901) on the same site is the version with the tagline and matches the pack lockup exactly.',
    note: 'The site draws its header logo from an icon font; the file is that font\'s glyph "logo" (U+E900) taken as is, with the y axis flipped by a transform and the viewBox tightened to the artwork.',
  },
  lollocafe: {
    sourceType: "official-site",
    sourcePage: "https://www.lollocaffe.it/",
    assetUrl: "https://www.lollocaffe.it/wp-content/uploads/2026/02/logo-lollo-184x80-real.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Photos 2676a774..., c0f4999d..., 24b69701...: packs print a serif "LOLLO" in capitals, small bean mark above, tricolour line and a tagline ("CAFFÈ, GUSTO E PASSIONE" or "golosité"). The 2026 website header logo (184x80) shows exactly this mark, but only as WHITE on transparent.',
    note: 'The brand publishes the current mark only in white and only at 184x80, so it is shown on a dark tile and never above 80 px tall. Every dark-on-light file on the site is the retired 2021 "LOLLOCAFFE" mark, which does not match the packs.',
  },
  "rema-caffe": {
    sourceType: "official-site",
    sourcePage: "https://www.remacaffe.com/",
    assetUrl: "https://www.remacaffe.com/cdn/shop/files/REMACAFFE_LOGO_White_240px.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Photo b32f1fc3... (Arabica Gold pod): red "rema" + white "caffé" wordmark with acute é, same letterforms as the site logo. The site logo additionally has a leaf/bean emblem in a square at the left that the pack does not show.',
    note: 'The only official file (site header and Organization JSON-LD) has a white "caffé", so it is shown on a dark tile, as on the black pod, and never above 63 px tall.',
  },
  tezzoro: {
    sourceType: "official-site",
    sourcePage: "https://tezzoro.com/",
    assetUrl: "https://tezzoro.com/storage/2015/12/Tezzoro_logo_with_slogan_BLACK_big.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'd58378d3...jpg (Tezzoro Espresso Excellence 1kg): same wide bold TEZZ[sun]RO lettering with the sun/wave roundel as the second O, and the script slogan "Excellence has a taste" under a rule.',
    note: "The site header uses a gold version of the same file; the brand's own black-ink version is used for light grounds.",
  },
  vandino: {
    sourceType: "official-site",
    sourcePage: "https://vandinocaffe.com/",
    assetUrl: "https://vandinocaffe.com/templates/default/images/logo_big.png",
    retrievedAt: "2026-10-09",
    packagingCheck:
      "Product photo 'Кафе на зърна Vandino Espresso Aroma 1кг.' (f110d45c...jpg): gold cup-and-V symbol above gold VANDINO wordmark with rule and CAFFÈ beneath - same symbol and letterforms.",
    note: "The only logo is gold (#D2AC67) on transparent, drawn for the dark-green pack: about 2.1:1 on white, under the 3:1 a graphic needs. It is shown on a dark tile, like the pack, and never above 150 px tall.",
  },
  vergnano: {
    sourceType: "official-site",
    sourcePage: "https://www.caffevergnano.com/",
    assetUrl: "https://www.caffevergnano.com/",
    retrievedAt: "2026-10-09",
    packagingCheck:
      'Antica Bottega 1kg pack (3643209e...jpg): black roundel with gold ring, white "CAFFÈ VERGNANO" arched over red "1882" - same roundel, letterforms and colours as the website SVG.',
    note: "The site publishes no standalone file: this is the inline <svg> from its header (.site-branding .logo-container), extracted verbatim. The roundel is the brand's only logo.",
  },
};

export const brandsWithoutLogo: Readonly<Record<string, BrandWithoutLogo>> = {
  eurocaf: {
    reason:
      'The owner of the label on our packs (the round "EUROCAF" badge over a bean, "ESPRESSO VENDING"; Crema Vivace, Piacere d\'Oro, Piacere d\'Oro Green, Rosso Fuoco) was not found. Tried: eurocafcaffe.it (EUROCAF SRL, Druento, Turin: its home, vending, brand-history and logo-history pages; its marks are a star-ringed oval, never this badge, and it lists none of these coffees), its ICE agrifood profile, EUROCAF trademark records; Bulgarian sellers coffeprint.bg (Kardzhali), the RiO vending site (introbg.wixsite.com/rio2012coffee, Ruse), 100caffeine.com and bestcoffee.bg, none of which names a maker or publishes the badge (they pair Eurocaf with Eurodrinks instant drinks; ЕВРОДРИНКС ЕООД, Sliven, is registered but shows no link to the coffee); Turkish listings (trendyol, cimri) of Eurocaf Piacere d\'Oro, with no maker named; Facebook and Instagram handles (eurocaf, eurocaf.bg, eurocafbg: none is this brand); seeklogo and other logo libraries (nothing). Web searches in Bulgarian, Italian, English and Turkish.',
    checkedAt: "2026-10-09",
  },
  molini: {
    reason:
      'The label appears to be REMACAFFE\'s (РЕМА КАФЕ ЕООД, Plovdiv): its own shop, remacaffe.com, sells the Molini Dolce Gusto range under the vendor "MOLINI", and its 2024 exhibitor profile on food-exhibitions.bg is reported to call MOLINI its budget line (that page refused a direct fetch). The brand\'s own store, molini.coffee, is a Shopify shop in Bulgarian still behind a password, with no logo file reachable. Neither site, nor any Molini or REMACAFFE social page that could be found, publishes the "molini" wordmark (red "l") as a file. Also tried: nicecompany.bg, cafemag.bg, espressimo.bg (its brand image is a blurred 150 px copy upscaled to 400, on a grey band: not usable), plausible molini domains (.bg, .com, molinicoffee, molinicaffe: none resolve), Wikimedia Commons and seeklogo (nothing). Web searches in Bulgarian, Italian and English.',
    checkedAt: "2026-10-09",
  },
};
