# Search: what Bulgaria types, who wins it, and the page set built on it

Measured **9 October 2026** via DataForSEO (through OpenSEO): Google, location
Bulgaria (2100), language Bulgarian, monthly search volume, keyword difficulty
(KD, 0–100), CPC in euro, desktop SERPs. About 1,070 distinct queries were sized,
seven seeds expanded, 28 result pages read, three domains profiled. Raw results
are in [`seo-data/`](seo-data/). Method and credit spend are at the end.

How to read the numbers:

- **"No data"** means below Google's reporting threshold (under ~10 a month), not
  zero in a strict sense. 574 of the requested queries came back this way; the
  list is in `seo-data/keyword-metrics.json` → `requested_without_data`.
- **Do not add word-order twins.** Google Ads buckets close variants, so
  `капсули долче густо` and `долче густо капсули` both report 3,600 — that is one
  3,600, not 7,200. Cluster totals below ("≈") add distinct volumes and count an
  equal-volume reordered pair once.
- **KD is almost always 0–8 in Bulgaria.** That says the keyword is cheap to
  compete for, not that a new domain will rank. The two established shops in
  this space (§5) each have ~7,000 organic visits a month.

---

## 0. The decisions

1. **Demand is capsules first.** Measured commercial demand for this catalog is
   roughly 29,000 searches a month for capsules (navigational system names
   included), 5,000 for beans, 1,500 for ESE pods, 2,200 for decaf, under 300
   for vending coffee and under 100 for consumables (§2). The page set should
   be weighted the same way.
2. **Slugs follow the measured word order: system first.** In every capsule
   system, and in both alphabets, the brand-first phrase out-searches the
   noun-first one: `nespresso капсули` 1,600 vs `капсули nespresso` 260,
   `caffitaly капсули` 480 vs `капсули caffitaly` 70. Five of the six capsule
   slugs move (§7).
3. **Add five pages** with measured demand the shop does not have:
   - **Капсули Lavazza** (≈ 2,700/mo, ambiguous across three systems)
   - **Кафе на зърна Lavazza** (≈ 1,800/mo)
   - **Безкофеиново кафе** (≈ 2,200/mo, across all formats)
   - **Капсули за Tchibo Cafissimo** (≈ 2,000/mo) — a machine page, which is
     the one place the machine database wins real traffic; Caffitaly capsules
     fit Cafissimo
   - **Най-евтино на чаша** (≈ 450/mo), which is the shop's own differentiator
     stated as a query (§8)
4. **Kafezona is not a search competitor.** It ranks for 8 keywords, best
   position 26, about 6 visits a month, and appears once in the top 20 of the 17
   commercial SERPs read. There are no rankings to cannibalise. The risk is
   duplicate content: same products, names, prices and photos. Keep this site's
   names, slugs, copy and structured data its own (§10).
5. **English: build the capability, switch `/en` off.** Latin-script commercial
   demand from Bulgaria is about 1,000 a month against about 40,000 in Bulgarian.
   DataForSEO has no English index for Bulgaria at all (§11). Keep `/bg/`
   prefixed so `/en/` can be added later without moving a URL.
6. **The journal gets one strong target and loses two weak ones.**
   - `видове капсули за кафе` (≈ 750/mo, shop blogs win) belongs to the existing
     "which capsule" article, retitled.
   - The cup-cost and intensity articles answer questions nobody types; keep
     them as supporting pages.
   - Three new articles have measured demand and fit (§9).
7. **The wizard has no search demand.** Fourteen phrasings were measured and
   none returned data. Index its entry page under a plain slug and expect its
   traffic from inside the site.
8. **Paid search pays only on large packs.** CPCs are €0.23–0.57. That is
   affordable on a €30 box of 100 Lavazza Blue capsules, a 1 kg bag or 150 ESE
   pods. It is not affordable on a €4.60 box of ten (§15).

---

## 1. The keyword map

One page owns each cluster. A page outside the "owns" column may mention the
term but must not carry it in its title or H1.

| Page (`/bg/…`)                  | Owns (head term, volume)                                                      | Also targets                                                                                                                                    | Must not compete with                          |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Home `/bg`                      | `магазин за кафе` 1,000 · `онлайн магазин за кафе` 170 (KD 60)                | `кафе` 22,200 (aspirational), `kafe` 1,000                                                                                                      | every category                                 |
| `kafe-kapsuli`                  | `кафе капсули` 2,400 (KD 21)                                                  | `капсули за кафе` 1,000, `кафе на капсули` 320, `капсули кафе` 260, `капсули за кафемашина` 170                                                 | each system page; the capsule-types article    |
| `dolce-gusto-kapsuli`           | `капсули долче густо` 3,600                                                   | `dolce gusto капсули` 1,900, `кафе капсули долче густо` 1,000, `съвместими капсули за долче густо` 140, `капсули за кафемашина долче густо` 140 | decaf page (decaf DG terms go there)           |
| `nespresso-kapsuli`             | `неспресо капсули` 1,900                                                      | `nespresso капсули` 1,600, `капсули неспресо` 1,300, `капсули за неспресо машина` 140                                                           | Lavazza capsules page                          |
| `lavazza-blue-kapsuli`          | `lavazza blue капсули` 720                                                    | `лаваца блу капсули` 480, `lavazza blue` 480, `капсули лаваца блу` 390                                                                          | Lavazza capsules page, Lavazza brand           |
| `lavazza-a-modo-mio-kapsuli`    | `lavazza a modo mio` 480                                                      | `lavazza a modo mio капсули` 140, `a modo mio капсули` 110, `капсули лаваца а модо мио` 90                                                      | Lavazza capsules page                          |
| `caffitaly-kapsuli`             | `caffitaly капсули` 480                                                       | `caffitaly` 1,600 (navigational), `кафитали` 260, `кафитали капсули` 170, `съвместими капсули за caffitaly` 90                                  | Tchibo machine page                            |
| **new** `lavazza-kapsuli`       | `лаваца капсули` 1,000                                                        | `капсули лаваца` 880, `lavazza капсули` 480, `кафе капсули лаваца` 320                                                                          | Lavazza brand page, Blue, A Modo Mio           |
| `kafe-na-zarna`                 | `кафе на зърна` 2,900                                                         | `кафе на зърна промоция` 720, `италианско кафе на зърна` 210, `кафе на зърна цена` 140, `кафе на зърна 100 арабика` 140                         | Lavazza beans page, beans article              |
| **new** `kafe-na-zarna-lavazza` | `кафе лаваца на зърна` 590                                                    | `лаваца на зърна` 480, `кафе на зърна лаваца` 390, `кафе лаваца на зърна 1 кг цена` 210                                                         | Lavazza brand page                             |
| `kafe-dozi`                     | `кафе дози` 590                                                               | `ese капсули` 140, `кафе на дози` 90, `хартиени дози кафе` 90, `кафе дозети` 50, `ese дози` 50                                                  | —                                              |
| **new** `bezkofeinovo-kafe`     | `безкофеиново кафе` 1,000                                                     | `безкофеиново кафе на зърна` 320, `кафе без кофеин` 210, `безкофеинови капсули долче густо` 170                                                 | system pages (no "без кофеин" in their titles) |
| **new** `nay-evtino-na-chasha`  | `евтино кафе на зърна` 170                                                    | `евтини капсули за кафе` 110, `евтини капсули неспресо` 110, `евтини капсули долче густо` 30                                                    | cup-cost article                               |
| `promotsii`                     | `кафе на зърна промоция` 720 shared with beans                                | `долче густо капсули промоция` 260, `кафе капсули промоция` 110                                                                                 | — (exists only while a reduction exists)       |
| `marki`                         | `марки кафе` 260                                                              | `италиански марки кафе` 170, `кафе марки` 70                                                                                                    | —                                              |
| `marki/<brand>`                 | `<brand> кафе` / `кафе <brand>` (e.g. `бианчи кафе` 880, `kimbo` 590)         | `<brand> капсули` where no brand × format page exists                                                                                           | brand × format pages                           |
| `za-kafemashina/<brand>`        | `капсули за <brand>` long tail; for Tchibo `tchibo cafissimo` 480             | `tchibo капсули` 390, `капсули чибо` 320, `кафе капсули чибо` 210, `cafissimo капсули` 170                                                      | Caffitaly page                                 |
| `kafe-za-vending-mashini`       | `кафе за вендинг машини` 90                                                   | `кафе за вендинг` 50, `кафе за вендинг автомати` 50, `вендинг кафе` 40                                                                          | —                                              |
| `blog/vidove-kapsuli-za-kafe`   | `видове капсули за кафе` 390                                                  | `видове капсули за кафе долче густо` 170, `видове капсули долче густо` 70                                                                       | capsule parent                                 |
| Product `/<slug>`               | the product line, e.g. `lavazza super crema` 260, `lavazza crema e aroma` 720 | `<line> <format>`                                                                                                                               | another product with the same name (§6.1)      |

---

## 2. The demand map

### 2.1 Formats and systems

| Cluster                       | Head term (vol · KD · CPC €)                | Cluster ≈/mo | Notes                                                                                                                       |
| ----------------------------- | ------------------------------------------- | -----------: | --------------------------------------------------------------------------------------------------------------------------- |
| Dolce Gusto capsules          | `капсули долче густо` 3,600 · 0 · 0.28      |        9,000 | Cyrillic leads; Latin `dolce gusto капсули` 1,900. Plus `dolce gusto` 3,600 and `долче густо` 1,600 (mixed with machines)   |
| Nespresso-compatible capsules | `неспресо капсули` 1,900 · 0 · 0.35         |        6,800 | Latin `nespresso капсули` 1,600 is close. `nespresso` 6,600 (KD 22) is the brand and goes to nespresso.bg                   |
| Generic capsules              | `кафе капсули` 2,400 · **21** · 0.57        |        4,500 | The hardest head term measured and the highest CPC. `капсули` 720 alone bleeds into pharmacy capsules (§3)                  |
| Caffitaly                     | `caffitaly` 1,600 · 0 · 0.44 (navigational) |        2,900 | `caffitaly капсули` 480 is the commercial term; caffitaly.bg (the distributor) holds #1 and a local pack                    |
| Lavazza Blue                  | `lavazza blue капсули` 720 · 0 · 0.45       |        2,550 | Office buyers; 100-capsule boxes                                                                                            |
| Tchibo Cafissimo              | `tchibo cafissimo` 480 · 0 · 0.27           |        2,000 | Caffitaly-format machines. Not a category today                                                                             |
| A Modo Mio                    | `lavazza a modo mio` 480 · 0 · 0.47         |        1,250 | Only three products in the catalog                                                                                          |
| Beans                         | `кафе на зърна` 2,900 · 2 · 0.54            |        5,000 | `кафе на зърна промоция` 720 is the second term — a price signal                                                            |
| ESE pods                      | `кафе дози` 590 · 0 · 0.56                  |        1,500 | People also call them `ese капсули` (140) and `дозети` (50). The machines that take them: `кафемашина за хартиени дози` 260 |
| Decaf (all formats)           | `безкофеиново кафе` 1,000 · 0 · 0.59        |        2,200 | Eight decaf products in the catalog: capsules for three systems, ESE pods and beans                                         |
| Vending coffee                | `кафе за вендинг машини` 90 · 11 · 0.33     |          270 | `вендинг машина` 2,900 is machines, the sister site's subject                                                               |
| Consumables                   | `консумативи за вендинг машини` 40          |           90 | Product nouns carry the demand (`картонени чаши за кафе` 320, `бъркалки за кафе` 170), and the catalog has none             |

**Formats we do not stock, measured anyway, because they arrive:**
`tassimo капсули` 260, `тасимо капсули` 260, `капсули тасимо` 140,
`nespresso vertuo` 260, `illy iperespresso капсули` 90, `bialetti капсули` 70,
`мляно кафе` 320, `разтворимо кафе` 260. That is about 1,700 searches a month
the shop cannot serve. They are answered on the machine pages ("Нямаме капсули
за Vertuo") and get no landing page of their own.

### 2.2 Brands and brand × format

| Brand        | Brand terms (vol)                                                                                         | × format (vol)                                                                                                                                                                                                              | Catalog                               | Who wins the brand SERP                           |
| ------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| Lavazza      | `lavazza` 1,900 · `кафе лаваца` 720 · `лаваца` 720 · `кафе lavazza` 210 · `лаваца кафе` 140               | **capsules ≈ 2,700** (`лаваца капсули` 1,000, `капсули лаваца` 880, `lavazza капсули` 480) · **beans ≈ 1,800** (`кафе лаваца на зърна` 590, `лаваца на зърна` 480, `кафе на зърна лаваца` 390) · ESE `кафе дози лаваца` 110 | 21 products, five formats             | mrcoffee.bg brand page #1, lavazza.bg, Wikipedia  |
| Bianchi      | `бианчи кафе` 880 · `кафе бианчи` 480 · `bianchi кафе` 390 · `бианчи` 320                                 | `бианчи капсули` 110 · `bianchi капсули` 110 · `бианчи кафе на зърна` 90 (none stocked)                                                                                                                                     | 18: DG, Nespresso, ESE                | bianchi.bg (a Bulgarian company, knowledge panel) |
| Kimbo        | `kimbo` 590 · `кимбо кафе` 260 · `кафе кимбо` 210                                                         | `кафе кимбо на зърна` 210 · `кимбо капсули` 90 (none stocked) · `кафе дози кимбо` 40                                                                                                                                        | 5: beans, ESE                         | mrcoffee.bg brand page #1                         |
| Julius Meinl | `julius meinl` 1,300 · `julius meinl кафе` 210 · `кафе julius meinl` 170                                  | `julius meinl кафе на зърна` 110                                                                                                                                                                                            | 3 beans                               | mrcoffee.bg #1 on the beans term; kafezona #28    |
| illy         | `кафе illy` 260 · `illy кафе` 170 · `или кафе` 140                                                        | `illy капсули` 260 (mostly Iperespresso) · `illy кафе на зърна` 210 · `капсули illy` 90 · `кафе дози illy` 40                                                                                                               | 6: beans, ESE, Nespresso              | mrcoffee.bg                                       |
| Borbone      | `кафе борбоне` 260 · `кафе borbone` 90                                                                    | `кафе борбоне капсули` 90                                                                                                                                                                                                   | 9: DG, beans                          | mrcoffee.bg brand page #1                         |
| Rema Caffè   | `рема кафе` 170 (`рема` 590 and `rema` 140 are ambiguous)                                                 | `рема кафе капсули` 30                                                                                                                                                                                                      | 34 — the largest brand in the catalog | remacaffe.com                                     |
| Lollo Caffè  | `lollocaffe` 90 · `лоло кафе` 40                                                                          | `lollo caffe капсули` 20                                                                                                                                                                                                    | 32                                    | —                                                 |
| Others       | Molini, Biancaffè, Elia, Amann, Eurocaf, Vergnano, Tezzoro, Este, Vandino, Foodness: no data or ≤ 20 each | —                                                                                                                                                                                                                           | 57 together                           | —                                                 |

Two findings matter for the page plan:

- **Search demand and catalog depth point in opposite directions.** Rema and
  Lollo are 66 of the 187 products and are barely searched. Lavazza, Bianchi and
  Kimbo carry the brand demand. Brand pages for the small brands are cheap to
  keep and earn little. Lavazza is the only brand big enough, and spread across
  enough formats, to justify brand × format pages.
- **Product-line names are real queries; sizes are not.**
  `lavazza crema e gusto` 1,000, `lavazza crema e aroma` 720,
  `lavazza super crema` 260, `lavazza gusto forte` 170, `lavazza gran espresso`
  110, `illy classico` 90, `kimbo aroma gold` 50. But
  `lavazza super crema 1 кг` is 10 and every other size variant returned no
  data. Product titles and slugs lead with brand and line.

### 2.3 Machine-compatibility queries

People name the machine they own, but almost never ask "which capsule fits":

| Query form           | Volume                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `капсули за <brand>` | `капсули за krups`, `капсули за делонги`, `кафе за jura`, `кафе за делонги` — **no data**. `krups капсули` 40, `капсули за кафемашина крупс` 20, `капсули за кафемашина делонги` 20, `капсули за кафемашина бош` 40       |
| `капсули за <model>` | `капсули за пиколо`, `капсули за genio s`, `капсули за essenza mini`, `капсули за inissia` — **no data**                                                                                                                  |
| the machine itself   | `кафемашина делонги` 1,300, `delonghi magnifica` 1,300, `delonghi dedica` 1,000, `кафемашина филипс` 590, `кафемашина крупс` 480, `nespresso essenza mini` 390, `krups dolce gusto` 390, `jura` 480, `gaggia classic` 390 |
| system-level "fits"  | `съвместими капсули за долче густо` 140, `капсули съвместими с долче густо` 110, `съвместими капсули за caffitaly` 90, `съвместими капсули за неспресо` 50                                                                |
| Tchibo Cafissimo     | `tchibo cafissimo` 480, `tchibo капсули` 390, `капсули чибо` 320, `кафе капсули чибо` 210, `cafissimo капсули` 170                                                                                                        |

The SERPs settle what the machine pages can win (§6.3): machine-name SERPs are
manufacturers and appliance retailers, and nobody wins them with a
compatibility page — **except Cafissimo**, where kafemania.bg's
compatible-capsule page is #1 for `tchibo cafissimo`. The machine pages exist to
prevent "that does not fit my machine". As traffic pages they are worth one
cluster, Cafissimo. That is still about 2,000 searches a month, and the shop can
serve them because `content/machines.ts` already records that Cafissimo takes
the Caffitaly format.

### 2.4 Price and value

| Query                                                                                         |       Vol |       CPC € |
| --------------------------------------------------------------------------------------------- | --------: | ----------: |
| `кафе на зърна промоция`                                                                      |       720 |        0.34 |
| `долче густо капсули промоция` · `капсули долче густо промоция`                               | 260 · 210 | 0.32 · 0.25 |
| `евтино кафе на зърна`                                                                        |       170 |        0.39 |
| `кафе на зърна цена`                                                                          |       140 |        0.36 |
| `евтини капсули за кафе` · `евтини капсули неспресо`                                          | 110 · 110 | 0.35 · 0.21 |
| `кафе капсули промоция`                                                                       |       110 |        0.31 |
| `кафе на зърна 1 кг цена` · `капсули долче густо цена`                                        |   70 · 70 | 0.36 · 0.19 |
| `цена на чаша кафе`, `колко струва едно кафе`, `цена на кафе капсула`, `най-евтините капсули` |   no data |           — |

People search "cheap" and "promotion", not "price per cup". The shop's
differentiator answers a question nobody types, so the page that carries it
should use the words people do type (§8).

### 2.5 Latin and Cyrillic

| Pair                                                  | Cyrillic |                       Latin |
| ----------------------------------------------------- | -------: | --------------------------: |
| `долче густо капсули` / `dolce gusto капсули`         |    3,600 |                       1,900 |
| `неспресо капсули` / `nespresso капсули`              |    1,900 |                       1,600 |
| `лаваца блу капсули` / `lavazza blue капсули`         |      480 |                         720 |
| `кафитали капсули` / `caffitaly капсули`              |      170 |                         480 |
| `кафе лаваца` / `кафе lavazza`                        |      720 |                         210 |
| `кимбо кафе` / `kimbo кафе`                           |      260 | no data (`kimbo` alone 590) |
| `бианчи кафе` / `bianchi кафе`                        |      880 |                         390 |
| fully transliterated `kafe kapsuli` / `kafe na zarna` |        — |               140 / no data |

The rule: **both alphabets in every title and H1 where the brand has a common
Cyrillic spelling** — "Dolce Gusto (Долче Густо)", "Lavazza (Лаваца)". The
larger share is Cyrillic for Dolce Gusto, Nespresso, Lavazza and Bianchi, and
Latin for Lavazza Blue and Caffitaly. Fully transliterated Bulgarian is
negligible. Slugs stay ASCII.

### 2.6 Informational questions (measured, not assumed)

| Topic                                         | Queries (vol)                                                                                                                                                         | SERP winner type (§6.4)                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Coffee drinks                                 | `капучино` 1,900 · `макиато` 1,000 · `лате` 880 · `еспресо` 720 · `лате макиато` 590 · `кортадо` 390 · `американо` 260 · `ристрето` 210 · `как се прави капучино` 210 | knowledge panel, Nescafé/Lavazza, recipe blogs      |
| Decaf                                         | `безкофеиново кафе` 1,000 · `кафе без кофеин` 210                                                                                                                     | shop blog posts, two category pages in top 10       |
| Capsule types                                 | `видове капсули за кафе` 390 · `видове капсули за кафе долче густо` 170 · `видове капсули долче густо` 70                                                             | shop guides (coffeepadsbg, kafemania blog)          |
| Caffeine                                      | `кофеин` 720 · `колко кофеин има в едно кафе` 170                                                                                                                     | AI overview, media                                  |
| Arabica / robusta                             | `робуста` 390 (bleeds into Robusta OOD, a bar-equipment firm) · `кафе арабика` 260 · `арабика` 140 · `арабика или робуста` 110 · `кафе робуста` 110                   | kafemania blog #1 on `арабика`                      |
| Best beans                                    | `най-доброто кафе на зърна` 210 · `хубаво кафе на зърна` 110                                                                                                          | shop blogs: kafemania #1, mrcoffee #2, coffeehub #3 |
| Italian coffee / brands                       | `марки кафе` 260 · `италианско кафе` 210 · `италиански марки кафе` 170                                                                                                | mrcoffee blog and brand index                       |
| Cleaning                                      | `почистване на кафемашина` 170 · `декалциране на кафемашина` 90                                                                                                       | dm, forums, cleaning brands                         |
| Beans for an automatic machine                | `хубаво кафе за кафеавтомат` 90 · `кафе на зърна за кафеавтомат` 40                                                                                                   | mrcoffee subcategory #1                             |
| Formats compared                              | `кафемашина с капсули и мляно кафе` 210 · `кафе или капсули` 70 · `nespresso vs dolce gusto` 30                                                                       | —                                                   |
| **The four existing articles' own phrasings** | `коя капсула за коя машина`, `цена на чаша кафе`, `колко струва едно кафе`, `интензивност на кафето` — **no data**; `интензитет на кафе капсули` 10                   | —                                                   |

---

## 3. The intent-bleed traps

As with the sister site's research, a word on its own can measure a different
industry:

| Term                 |       Vol | What it actually is                                                                        |
| -------------------- | --------: | ------------------------------------------------------------------------------------------ |
| `капсули`            |       720 | Seeding it returned 90 rows of pharmacy capsules (`артронол капсули`, `милгама н капсули`) |
| `дневник`            |   110,000 | school e-registers and a national newspaper — the journal's current label and slug         |
| `робуста`            |       390 | Robusta OOD, a Plovdiv bar-equipment company, holds #1, #2, #4, #6 and #10                 |
| `кафе на зърна` seed |         — | `гледане на кафе` 5,400, `гадаене на кафе` 1,300 (fortune-telling from the grounds)        |
| `рема` · `elia`      | 590 · 260 | not the coffee brands                                                                      |
| `кафемашина *`       |    6,600+ | buying a machine; retail SERPs                                                             |
| `кафе <city>`        |   320–390 | cafés, not shops                                                                           |
| `specialty coffee`   |     2,400 | specialty roasters and cafés in Sofia                                                      |

**The rule:** a slug or title carries the coffee word (`kafe-kapsuli`, not
`kapsuli`), and no page is named after a term whose SERP is another industry.

---

## 4. What the result pages show

28 SERPs, desktop, depth 20 for the 17 commercial heads and depth 10 for the
rest (`seo-data/serps.json`).

| Feature         | SERPs (of 28) | Where                                                                                               |
| --------------- | ------------: | --------------------------------------------------------------------------------------------------- |
| Image pack      |            23 | almost everywhere — packshots matter                                                                |
| AI overview     |            14 | heads including `капсули долче густо`, `кафе капсули`, `кафе дози`, decaf, `видове капсули за кафе` |
| Local pack      |             4 | `кафе на зърна`, `кафе дози`, `caffitaly`, `кафе за вендинг автомати`                               |
| Knowledge panel |             3 | `бианчи кафе`, `капучино`, `макиато`                                                                |
| People also ask |             0 | none returned in Bulgaria                                                                           |
| Shopping / paid |             0 | none returned on desktop (the feed counts every element; none were ads)                             |

Top-10 appearances across the 28 SERPs: kapsuli.bg 16, facebook.com 15,
kafemania.bg 12, mrcoffee.bg 11, dolce-gusto.bg 8, coffeehub.bg 8, nespresso.bg 8,
kaffek.bg 6, lavazza.bg 6. **kafezona.com 0** (one appearance, #15 on
`caffitaly`).

### What kind of page wins each head

| Query                                   | #1                                                                            | Winning page types in the top 10                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `капсули долче густо` 3,600             | dolce-gusto.bg (manufacturer)                                                 | manufacturer ×4, shop guide (kapsuli.bg ×3), category (kafemania, coffeeland), retailer (zora)                                    |
| `кафе на зърна` 2,900                   | coffeehub.bg **article**                                                      | categories (freshcoffee, totalpack, kafemarket, coffeespot), Reddit, a promo aggregator, local pack                               |
| `кафе капсули` 2,400                    | mycafe.bg home                                                                | **shop home pages** (mycafe, kaffek, kafemania, kapsuli), categories (coffeehub, mrcoffee), nespresso.bg, a "best brands" article |
| `неспресо капсули` 1,900                | nespresso.bg                                                                  | nespresso.bg ×4, compatible-capsule categories (kafemania #3, mycafe #5, cafemag #7), guides                                      |
| `nespresso капсули` 1,600               | coffee.bg category                                                            | categories and guides; the Latin spelling has a **different, less branded** SERP than the Cyrillic one                            |
| `кафе дози` 590                         | capsulissimo product                                                          | categories (espressimo, dabov, bianchi, coffeetime), an article, OLX, local pack                                                  |
| `lavazza blue капсули` 720              | mrcoffee.bg category                                                          | categories (mrcoffee, coffeehub, kafemania, didico), Metro product, a guide, OLX                                                  |
| `caffitaly` 1,600                       | caffitaly.bg (distributor)                                                    | distributor, categories (cafemag, mrcoffee, coffeehub), Wikipedia, eMAG; kafezona #15                                             |
| `безкофеиново кафе` 1,000               | coffeespot.bg **article**                                                     | articles ×8, categories ×2 (cafeteria.bg #5, arabica.bg #7)                                                                       |
| `видове капсули за кафе` 390            | coffeepadsbg.com **guide** ("Кои капсули са подходящи за моята кафе машина?") | guides and articles, two categories                                                                                               |
| `капсули за кафе` 1,000                 | mycafe.bg home                                                                | same set as `кафе капсули` plus kafemania's capsule-types article #8                                                              |
| `съвместими капсули за долче густо` 140 | dolce-gusto.bg                                                                | categories (kaffek, megaugcoffee, caffitaly.bg, coffeeservice, ebag), guides                                                      |
| `lavazza crema e gusto` 1,000           | mrcoffee.bg **product**                                                       | products and lavazza.bg; the line is mostly ground coffee, which this shop does not sell                                          |
| `бианчи кафе` 880                       | bianchi.bg                                                                    | the brand's own site ×4, company registers, brand category pages (kapsuli, mrcoffee, cafemag)                                     |
| `кафе за вендинг автомати` 50           | zagatto.com category                                                          | vending distributors' categories, articles, local pack                                                                            |
| `кафе лаваца` 720                       | mrcoffee.bg brand page                                                        | brand pages, lavazza.bg, Wikipedia, articles                                                                                      |
| `tchibo cafissimo` 480                  | **kafemania.bg compatible-capsule category**                                  | technopolis, tchibo.bg, YouTube, myness category, mrcoffee brand page                                                             |
| `delonghi magnifica` 1,300              | delonghi.com                                                                  | appliance retailers, OLX, Facebook resellers — no coffee shop                                                                     |
| `krups dolce gusto` 390                 | tefal.bg                                                                      | krups.bg, retailers, YouTube — cafemag's category #7 is the only shop                                                             |

Three patterns follow:

- **Category pages win the system and format heads**, and the manufacturer takes
  #1 where the system is a brand (Dolce Gusto, Nespresso).
- **Articles win broader terms**: `кафе на зърна` #1, decaf, capsule types.
  Both established shops put guides on their own domains.
- **Product pages win product-line queries.**

---

## 5. Kafezona and the two shops that matter

| Domain       | Ranked keywords (BG) | Est. organic visits/mo | Notes                                                                                  |
| ------------ | -------------------: | ---------------------: | -------------------------------------------------------------------------------------- |
| mrcoffee.bg  |                  340 |                  7,956 | Cyrillic URLs; system categories, brand pages, dated blog posts                        |
| kafemania.bg |                  500 |                  6,956 | Latin URLs (`/kafe/kafe-kapsuli/nespresso-savmestimi`, `/kafe/kafe-dozi`, `/blog/...`) |
| kafezona.com |                **8** |                  **6** | brand pages only; best position 26                                                     |

**Everything kafezona.com ranks for** (9 Oct 2026, position in Google Bulgaria):
`бианчи капсули` #26 (/bianchi/), `julius meinl кафе на зърна` #28,
`julius meinl кафе` #33, `este restaurant` #37 (a false match on the Este brand
page), `време за кафе` #37 (/kafe-kapsuli/), `кафе julius meinl` #38,
`julius meinl` #55, `кимбо кафе` #60. None of its category pages ranks for its
category's name.

**What mrcoffee.bg wins with**, from its top 100 keywords by traffic:

| Page type       | Examples (query · position)                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Home            | `coffee` #4, `кафе` #7 (brand-name match: "Mr Coffee")                                                                            |
| System category | `lavazza blue капсули` #2, `лаваца блу` #1, `caffitaly` #5, `lavazza a modo mio` #3, `съвместими капсули за caffitaly` #1         |
| Brand page      | `kimbo` #1, `кимбо кафе` #1, `кафе борбоне` #1, `julius meinl кафе на зърна` #1, `чибо капсули` #2, `tchibo cafissimo капсули` #1 |
| Product         | `lavazza super crema` #1, `lavazza gusto forte` #1, `lavazza crema e aroma` #2, `lavazza qualita oro` #1, `кафе дози лаваца` #1   |
| Blog post       | `кафе без кофеин` #1, `италианско кафе` #1, `видове кафе` #2, `най доброто кафе на зърна` #3, `безкофеиново кафе на зърна` #3     |
| Subcategory     | `хубаво кафе за кафеавтомат` #1 ("за домашни автоматични кафе машини"), `кафе на зърна 100 арабика` #2, `ese капсули` #1          |

**What kafemania.bg wins with**: `долче густо капсули` #5,
`неспресо капсули` #4, `nespresso капсули` #4 (compatible-capsule categories);
`чибо капсули` #1, `cafissimo капсули` #1 (a Tchibo Cafissimo category);
`кафе лаваца капсули` #1 (a Lavazza capsules page); `най доброто кафе на зърна`
#1, `видове капсули за кафе` #2, `арабика` #1 (blog); `кафемашина за хартиени
дози` #1.

The shape is clear and the same in both: **one page per system, one per brand,
one per brand × format where the brand is big, a product page per line, and a
blog that takes the broad informational heads.** This shop has all of those
except brand × format, decaf and the blog topics people actually search.

---

## 6. Detail behind the decisions

### 6.1 Duplicate names inside this catalog

Two products are both named "Кафе на зърна Lavazza Crema E Aroma 1кг."
(`kafe-na-zarna-lavazza-crema-e-aroma-1kg` at €25.05 and `…-1kg-1000g` at
€25.55). The query is 720 a month. With identical titles the two pages compete
with each other and Google picks one at random. **They need distinguishing
names.** mrcoffee.bg sells a "Crema e Aroma Expert", which suggests one of them
is a different line.

### 6.2 The source's naming is not the searchers'

Product names come from the source: "Капсули DG …", "Капсули Blue …",
"Дозети …". The searched words are `долче густо`/`dolce gusto` (`DG` no data),
`lavazza blue`, and `кафе дози` 590 against `кафе дозети` 50. Our own display
names, H1s and slugs should use the searched words (§12). That also makes the
pages less like the source's.

### 6.3 Machine pages: what they can and cannot win

- **Cannot:** model and machine-brand heads (`delonghi magnifica` 1,300,
  `кафемашина делонги` 1,300, `krups dolce gusto` 390). Those SERPs are
  manufacturers and appliance retailers.
- **Can:** Tchibo Cafissimo. Combined ≈ 2,000 a month, with a compatible-capsule
  page at #1.
- **Should:** carry "кафемашина" in title and slug, because that is the word
  owners use for the device (`кафемашина` 6,600, `кафе машина` 8,100). A
  `za-kafemashina/…` slug says plainly that we sell what goes into the machine,
  not the machine.
- **No model-level pages.** Every `капсули за <model>` phrasing measured
  returned no data, and a model page would be one sentence. Models stay as
  anchors on the brand page.

### 6.4 Journal: who wins informational SERPs

- Coffee-drink terms (≈ 6,300 together) go to knowledge panels, Nescafé,
  Lavazza and recipe blogs. The volume is large and the commercial fit is weak.
- Caffeine goes to AI overviews and media, and needs facts the catalog does not
  hold.
- Cleaning goes to dm and forums, and the shop sells no descaler.
- `видове капсули за кафе`, `най-доброто кафе на зърна`, `арабика`, decaf and
  `италианско кафе` all go to coffee shops' own blogs. That is where a shop's
  article can rank.

---

## 7. The URL plan — every row of the provisional plan

Every locale prefixed. ASCII slugs, Bulgarian transliterated by the official
system (ъ → a, ц → ts, щ → sht, я → ya). Only the first segment is a Bulgarian
word; brand, system and product-line names stay as the brand writes them.

| Page                      | Provisional `/bg`                                 | **Decision `/bg`**                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capsule parent            | `kafe-kapsuli`                                    | **`kafe-kapsuli`** (confirmed)                                                                                                                                                                                         | `кафе капсули` 2,400 > `капсули за кафе` 1,000 > `капсули кафе` 260; bare `капсули` bleeds into pharmacy                                                                                                                                                          |
| Nespresso                 | `kapsuli-nespresso`                               | **`nespresso-kapsuli`**                                                                                                                                                                                                | `неспресо капсули` 1,900 > `капсули неспресо` 1,300; `nespresso капсули` 1,600 > `капсули nespresso` 260                                                                                                                                                          |
| Dolce Gusto               | `kapsuli-dolce-gusto`                             | **`dolce-gusto-kapsuli`**                                                                                                                                                                                              | Cyrillic orders tie at 3,600 (one bucket); Latin `dolce gusto капсули` 1,900 > `капсули dolce gusto` 320                                                                                                                                                          |
| Lavazza Blue              | `kapsuli-lavazza-blue`                            | **`lavazza-blue-kapsuli`**                                                                                                                                                                                             | `lavazza blue капсули` 720 > `капсули lavazza blue` 110; `лаваца блу капсули` 480 > `капсули лаваца блу` 390                                                                                                                                                      |
| Lavazza A Modo Mio        | `kapsuli-lavazza-a-modo-mio`                      | **`lavazza-a-modo-mio-kapsuli`**                                                                                                                                                                                       | `lavazza a modo mio капсули` 140 > `a modo mio капсули` 110 > `капсули a modo mio` 50                                                                                                                                                                             |
| Caffitaly                 | `kapsuli-caffitaly`                               | **`caffitaly-kapsuli`**                                                                                                                                                                                                | `caffitaly капсули` 480 > `капсули caffitaly` 70; `кафитали капсули` 170 > `капсули кафитали` 70                                                                                                                                                                  |
| Beans                     | `kafe-na-zarna`                                   | **`kafe-na-zarna`** (confirmed)                                                                                                                                                                                        | 2,900 at KD 2; `кафе зърна` 90                                                                                                                                                                                                                                    |
| ESE pods                  | `kafe-dozi`                                       | **`kafe-dozi`** (confirmed)                                                                                                                                                                                            | `кафе дози` 590 > `кафе на дози` 90 > `дози кафе` 70 > `кафе дозети` 50                                                                                                                                                                                           |
| Vending section           | `kafe-za-vending`                                 | **`kafe-za-vending-mashini`**                                                                                                                                                                                          | `кафе за вендинг машини` 90 (KD 11) > `кафе за вендинг` 50 = `… автомати` 50 > `вендинг кафе` 40                                                                                                                                                                  |
| Consumables               | `konsumativi`                                     | **`konsumativi`** (confirmed; **noindex while it lists no products**)                                                                                                                                                  | the phrasings total ≈ 90/mo; product nouns carry the demand and the catalog has none                                                                                                                                                                              |
| Brands index / brand      | `marki` / `marki/<brand>`                         | **`marki` / `marki/<brand>`** (confirmed)                                                                                                                                                                              | `марки кафе` 260; brand slugs as the brand writes itself: `lollo-caffe` rather than `lollocafe`                                                                                                                                                                   |
| Search                    | `tarsene`                                         | **`tarsene`** (confirmed; disallowed in robots)                                                                                                                                                                        | navigational                                                                                                                                                                                                                                                      |
| Promotions                | `promotsii`                                       | **`promotsii`** (confirmed)                                                                                                                                                                                            | queries use the singular `промоция` (720, 260, 210, 110) as a modifier; the page title carries it                                                                                                                                                                 |
| Delivery and payment      | `dostavka-i-plashtane`                            | **`dostavka-i-plashtane`** (confirmed)                                                                                                                                                                                 | navigational; not measured                                                                                                                                                                                                                                        |
| Contact                   | `kontakti`                                        | **`kontakti`** (confirmed)                                                                                                                                                                                             | matches the sister site                                                                                                                                                                                                                                           |
| Privacy / Terms / Cookies | `poveritelnost` / `obshti-usloviya` / `biskvitki` | confirmed                                                                                                                                                                                                              | matches the sister site                                                                                                                                                                                                                                           |
| Journal / article         | `dnevnik` / `dnevnik/<slug>`                      | **`blog` / `blog/<slug>`**                                                                                                                                                                                             | `дневник` is a 110,000/mo term for school e-registers and a newspaper; no section name has demand (`блог за кафе`, `статии за кафе`: no data); `/blog/` is what kafemania, kapsuli.bg and gourmetkafe use, and it survives into `/en/` unchanged                  |
| Recommendation wizard     | open                                              | **`izbor-na-kafe`**                                                                                                                                                                                                    | 14 phrasings measured, none with data (`какво кафе да избера`, `избор на кафе`, `кафе тест`…). Plain and descriptive; answered states stay disallowed                                                                                                             |
| Machine finder            | open                                              | **`za-kafemashina` / `za-kafemashina/<brand>`**                                                                                                                                                                        | `кафемашина` 6,600 is the owner's word; "за" says we sell for the machine, not the machine; no model pages (§6.3)                                                                                                                                                 |
| Newsletter unsubscribe    | `byuletin/otpisvane`                              | confirmed (noindex)                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                 |
| Product                   | first level `/bg/<product slug>`                  | **first level, with a new slug pattern**: `<brand>-<line>-<format>-<qty>`, e.g. `lavazza-super-crema-kafe-na-zarna-1-kg`, `borbone-crema-classica-kapsuli-dolce-gusto-16-br`, `lavazza-gran-espresso-kafe-dozi-150-br` | product-line queries lead with brand + line (`lavazza super crema` 260; size variants no data); `dg` is not a searched token; both leading shops rank product pages for line names; a reserved-slug list must stop a product slug colliding with a top-level page |
| **New:** Lavazza capsules | —                                                 | **`lavazza-kapsuli`**                                                                                                                                                                                                  | ≈ 2,700/mo; kafemania's equivalent is #1 for `кафе лаваца капсули`                                                                                                                                                                                                |
| **New:** Lavazza beans    | —                                                 | **`kafe-na-zarna-lavazza`**                                                                                                                                                                                            | ≈ 1,800/mo; the noun-first form leads in this pair (`кафе лаваца на зърна` 590, `кафе на зърна лаваца` 390 vs `lavazza кафе на зърна` 90)                                                                                                                         |
| **New:** decaf            | —                                                 | **`bezkofeinovo-kafe`**                                                                                                                                                                                                | ≈ 2,200/mo                                                                                                                                                                                                                                                        |
| **New:** cheapest per cup | —                                                 | **`nay-evtino-na-chasha`**                                                                                                                                                                                             | the measured words are `евтино`/`евтини` (≈ 450/mo); the slug states the shop's claim, the title carries the query                                                                                                                                                |

`/en` slugs in the handoff are fine as a reservation. The equivalent English
reordering is `nespresso-capsules`, which the handoff already has. They do not
ship (§11).

---

## 8. Pages to add, and pages with no demand

### Add (in priority order)

| #   | Page                                                                   | Demand ≈/mo | Why it can win                                                                                                                                           | Built from                                                                                                        |
| --- | ---------------------------------------------------------------------- | ----------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **Капсули Lavazza** `lavazza-kapsuli`                                  |       2,700 | ambiguous query across Blue, A Modo Mio and Nespresso-compatible; the page that disambiguates is what the searcher needs, and kafemania's is #1          | Lavazza products in capsule categories, grouped by system, with machine notes                                     |
| 2   | **Капсули за Tchibo Cafissimo** (machine page `za-kafemashina/tchibo`) |       2,000 | a compatible-capsule page is #1 for `tchibo cafissimo` today; the compatibility is already in `machines.ts`                                              | the Caffitaly category's products, plus the model list                                                            |
| 3   | **Безкофеиново кафе** `bezkofeinovo-kafe`                              |       2,200 | two category pages are in the top 10 of an article-led SERP; the commercial long tail (`… на зърна` 320, `… долче густо` 170) has no article competition | products whose record says decaf (8 today: Nespresso 2, Dolce Gusto 1, Blue 1, ESE 3, beans 1), grouped by system |
| 4   | **Кафе на зърна Lavazza** `kafe-na-zarna-lavazza`                      |       1,800 | mrcoffee's brand page ranks for these with a mixed-format page; a format-pure page fits the query better                                                 | Lavazza beans (8)                                                                                                 |
| 5   | **Най-евтино на чаша** `nay-evtino-na-chasha`                          |         450 | `евтини капсули неспресо` is held by a thin kapsuli.bg post; nobody else can show a real price per cup                                                   | the cheapest per cup in each system, from `@catalog/shared/serving`                                               |

Each new listing must disappear (404 and leave the sitemap) when its query
returns no products, like every other data-driven section.

### Exists, little or no demand — keep, do not invest

| Page                                                                                                | Measured demand                                        | Recommendation                                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Article: cup cost                                                                                   | `цена на чаша кафе`, `колко струва едно кафе`: no data | keep; link to it from the cheapest-per-cup page; it is the explanation, not the target    |
| Article: intensity                                                                                  | `интензитет на кафе капсули` 10                        | keep as support; no SEO expectation                                                       |
| Article: formats                                                                                    | `кафе или капсули` 70, `nespresso vs dolce gusto` 30   | keep; retitle toward `кафемашина с капсули или на зърна` (210, but machine-buying intent) |
| Wizard                                                                                              | no data on 14 phrasings                                | keep (conversion); index the entry page only                                              |
| Consumables                                                                                         | ≈ 90                                                   | noindex until it lists products                                                           |
| Brand pages for Molini, Biancaffè, Elia, Amann, Eurocaf, Vergnano, Tezzoro, Este, Vandino, Foodness | ≤ 20 each or no data                                   | keep (cheap, internal linking); no copy investment                                        |

### Do not build

- Landings for Tassimo, Vertuo, Iperespresso or Bialetti (≈ 1,700/mo). Those
  visitors cannot be served. The machine pages already say no.
- Model pages (`капсули за пиколо`…: no data).
- Generic coffee-culture articles: drinks, caffeine, cleaning (§6.4).

---

## 9. Journal topics, ranked by demand × fit

| Rank | Article (title matched to the query)                                                                             | Target (vol)                                                                                            | Fit                                                          | Status                                                                                        |
| ---: | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
|    1 | **Видове капсули за кафе: коя пасва на вашата машина**                                                           | `видове капсули за кафе` 390 + DG variants 240                                                          | exact: systems, drawings, the machine database               | **retitle the existing "Коя капсула пасва на коя кафемашина"**; slug `vidove-kapsuli-za-kafe` |
|    2 | **Как да изберете кафе на зърна** (by composition, roast and price per kg — no "best" ranking, per `PRODUCT.md`) | `най-доброто кафе на зърна` 210, `хубаво кафе на зърна` 110, `хубаво кафе за кафеавтомат` 90            | high; shop blogs hold all three top places                   | new                                                                                           |
|    3 | **Арабика и робуста: каква е разликата**                                                                         | `кафе арабика` 260, `арабика` 140, `арабика или робуста` 110, `кафе робуста` 110, `кафе 100 арабика` 90 | high; the catalog records arabica share                      | new                                                                                           |
|    4 | **Италиански марки кафе** (what each brand in the catalog makes, from the data)                                  | `италианско кафе` 210, `италиански марки кафе` 170                                                      | high; the catalog's brands are mostly Italian (`PRODUCT.md`) | new — or the brands index carries it (decide one, not both)                                   |
|    5 | **Еспресо, лунго, ристрето, кортадо: какво има в капсулата**                                                     | `кортадо` 390, `ристрето` 210, `лунго` 50 (the drink names on our packs)                                | medium; the SERP is knowledge panels and brand blogs         | later                                                                                         |
|    — | Cup cost, intensity, formats                                                                                     | no data / 10 / 70                                                                                       | —                                                            | existing; support only                                                                        |

Decaf is **not** a journal topic. It is page 3 in §8. One page per cluster.

---

## 10. The shared catalog

Measured on 9 October 2026, kafezona.com has 8 ranked keywords and about 6
visits a month. This site does not take traffic from it and cannot cannibalise
its rankings, because there are none. The risk runs the other way: identical
products, identical names, identical prices and identical packshots on two
domains look like a copy. Google then picks one URL per product to show, and
not necessarily this one.

1. **Names, H1s and slugs are this site's own** (§6.2, §12). Slugs already
   differ from the source paths (0 of 187 match). The display names do not
   differ yet.
2. **Copy is already our own**: 187 rewritten descriptions, enforced by
   `pnpm check:originality`. Keep it so. Never publish the source's text.
3. **Each page carries data the source's does not**: price per cup, the system
   badge, the machine-fit statement, intensity with its own scale. That makes
   the pages different documents, not reworded copies.
4. **Each site canonicalises to itself.** No cross-domain canonical and no links
   between the two; `PRODUCT.md` forbids naming the source in any case.
5. **This domain is the search property.** Kafezona can stay the fulfilment
   shop. If the owner ever invests in kafezona's SEO, the two must split by
   intent, not compete for the same heads.
6. Packshots are the same files. Google Images will cluster them and may show
   the source's copy. That is minor; cropping or re-encoding the images would
   not change it in any way worth the effort.

---

## 11. English in Bulgaria

**DataForSEO has no English index for Bulgaria.** The request with language `en`
for location 2100 was refused: "Available: bg". Latin-script English queries
typed in Bulgaria sit in the Bulgarian index. Measured there:

| English query                                                                                                                                                                                   |                    Vol | Note                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: | --------------------------------- |
| `coffee` · `coffee shop` · `specialty coffee`                                                                                                                                                   | 33,100 · 4,400 · 2,400 | cafés and roasters, not this shop |
| `espresso` · `cortado` · `ristretto`                                                                                                                                                            |        720 · 590 · 590 | drinks                            |
| `nespresso capsules`                                                                                                                                                                            |                    260 | the one sizeable commercial term  |
| `coffee beans`                                                                                                                                                                                  |                    170 |                                   |
| `coffee pods` · `ese pods`                                                                                                                                                                      |              110 · 110 |                                   |
| `kimbo coffee` · `italian coffee` · `nespresso bulgaria`                                                                                                                                        |           90 · 70 · 70 |                                   |
| `nespresso pods` · `nespresso sofia` · `nespresso vertuo capsules`                                                                                                                              |                40 each |                                   |
| `best coffee beans` · `coffee beans 1kg` · `a modo mio capsules`                                                                                                                                |                10 each |                                   |
| `dolce gusto capsules`, `lavazza blue capsules`, `caffitaly capsules`, `decaf coffee`, `coffee for vending machines`, `cheap nespresso capsules`, `buy coffee beans`, `coffee delivery sofia` … |                no data |                                   |

Commercial English demand for this catalog is **about 1,000 searches a month,
2–3 % of the Bulgarian equivalent**. Part of it is Bulgarians typing English
brand words, and the `/bg/` pages already serve them, because their titles
carry the Latin brand names. The shop delivers only within Bulgaria.

**Decision:** keep the locale capability (prefixed routes, `hreflang` plumbing,
a locale-keyed dictionary) and **ship English switched off**: no `/en/` routes,
no `/en/` in the sitemap, no `hreflang` alternates, until a real second market
exists. Shipping it now would cost 187 product translations, the legal
documents and every page's copy, for about 1,000 searches a month that `/bg/`
mostly serves already. A half-translated `/en/` would also be thin duplicate
content on the same domain.

**If the business ever delivers abroad**, measure these first, with native
keyword sets written in each language, as the sister site did (not measured
here):

| Market                  | Why                                                                                          | Est. cost to measure                       |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Romania (`ro`)          | EU, neighbouring, same couriers, large capsule market                                        | ~60 credits (200 kw + 8 SERPs)             |
| Greece (`el` and `en`)  | EU, neighbouring; the sister site found native Greek returns no data, so measure English too | ~70 credits                                |
| North Macedonia, Serbia | close, but outside the EU: customs on every parcel                                           | ~60 each — only after the customs question |

---

## 12. Titles and H1s

Fifty to sixty characters, query first, both alphabets where §2.5 says so,
brand last. No "оригинални", no exclamation marks, the advisor's voice.
Third-party capsules are always "за" or "съвместими с" a system, never "<system>
капсули" as if made by its owner. That is a `PRODUCT.md` rule, and the H1
carries it while the title leads with the searched words.

| Page type              | `<title>`                                                                                            | H1                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Home                   | `Онлайн магазин за кафе: капсули, зърна и дози \| Buy-a-Coffee`                                      | free (the title carries the query), e.g. `Кафе за вашата машина`           |
| Capsule parent         | `Кафе капсули за Nespresso, Dolce Gusto, Lavazza и Caffitaly \| Buy-a-Coffee`                        | `Кафе капсули`                                                             |
| System (compatible)    | `Капсули за Dolce Gusto (Долче Густо) — цена на чаша \| Buy-a-Coffee`                                | `Капсули за Dolce Gusto`                                                   |
|                        | `Капсули за Nespresso (Неспресо) — цена на чаша \| Buy-a-Coffee`                                     | `Капсули, съвместими с Nespresso`                                          |
| System (own brand)     | `Капсули Lavazza Blue (Лаваца Блу) — 100 бр., цена на чаша \| Buy-a-Coffee`                          | `Капсули за Lavazza Blue`                                                  |
|                        | `Капсули Caffitaly (Кафитали) — стават и за Tchibo Cafissimo \| Buy-a-Coffee`                        | `Капсули Caffitaly`                                                        |
| Brand × format         | `Капсули Lavazza (Лаваца): Blue, A Modo Mio и за Nespresso \| Buy-a-Coffee`                          | `Капсули Lavazza`                                                          |
|                        | `Кафе на зърна Lavazza (Лаваца) — 1 кг, цена на чаша \| Buy-a-Coffee`                                | `Кафе на зърна Lavazza`                                                    |
| Format                 | `Кафе на зърна — цена за кг и на чаша \| Buy-a-Coffee`                                               | `Кафе на зърна`                                                            |
|                        | `Кафе дози ESE (хартиени дози 44 мм) \| Buy-a-Coffee`                                                | `Кафе дози ESE`                                                            |
| Decaf                  | `Безкофеиново кафе — капсули, дози и зърна \| Buy-a-Coffee`                                          | `Безкофеиново кафе`                                                        |
| Cheapest per cup       | `Евтини капсули и кафе на зърна — подредени по цена на чаша \| Buy-a-Coffee`                         | `Най-евтино на чаша`                                                       |
| Brand                  | `Кафе <Brand> (<Кирилица>): <formats> \| Buy-a-Coffee`, e.g. `Кафе Bianchi (Бианчи): капсули и дози` | `<Brand>`                                                                  |
| Brands index           | `Марки кафе — италиански и други \| Buy-a-Coffee`                                                    | `Марки кафе`                                                               |
| Machine brand          | `Капсули и кафе за кафемашини Krups — кой модел какво приема \| Buy-a-Coffee`                        | `Кафемашини Krups: какво им пасва`                                         |
| Machine brand (Tchibo) | `Капсули за Tchibo Cafissimo (Чибо Кафисимо) — пасват капсулите Caffitaly \| Buy-a-Coffee`           | `Капсули за Tchibo Cafissimo`                                              |
| Product                | `<Brand> <Line> — <format>, <qty> \| Buy-a-Coffee`, e.g. `Lavazza Super Crema — кафе на зърна, 1 кг` | `<Brand> <Line>`, then the format and quantity line: `Кафе на зърна, 1 кг` |
| Product (capsule)      | `Borbone Crema Classica — капсули за Dolce Gusto, 16 бр.`                                            | `Borbone Crema Classica` / `Капсули за Dolce Gusto, 16 бр.`                |
| Product (ESE)          | `Lavazza Gran Espresso — кафе дози ESE, 150 бр.`                                                     | `Lavazza Gran Espresso` / `Кафе дози ESE, 150 бр.`                         |
| Article                | the measured question, e.g. `Видове капсули за кафе: коя пасва на вашата машина`                     | same                                                                       |

The meta description carries the price per cup range and the phone callback.
Those are the two things a SERP snippet can show that no competitor's can.

---

## 13. Internal linking

1. **One owner per cluster, one anchor per owner.** Whenever a page mentions a
   cluster, it links to the §1 owner, using the owner's head term or a natural
   variant as the anchor ("капсули за Dolce Gusto", "кафе на зърна Lavazza").
   No other page uses that anchor for a different URL.
2. **Breadcrumbs follow the format, not the brand.** A product's breadcrumb runs
   Начало › Кафе капсули › Капсули за Dolce Gusto › product. Its brand, and its
   brand × format page where one exists, are linked in the facts table.
3. **Up, sideways, never round in circles.** Product → system or format →
   parent. Brand → brand × format → system. Machine brand → the system page for
   each model group. A system page links back to the machine finder only once
   ("Не знаете системата? Намерете машината си").
4. **Articles feed categories.** Each article links to the listings it explains.
   Each listing links to at most one article, the one that answers its question
   (capsule parent → capsule types; beans → how to choose beans; cheapest per
   cup → cup cost).
5. **Separate pages that must not compete:**
   - `/marki/lavazza` (brand), `lavazza-kapsuli`, `lavazza-blue-kapsuli` and
     `lavazza-a-modo-mio-kapsuli` each say what the others are and link to them.
     Only one of them may say "лаваца капсули" in its title.
   - The same goes for `caffitaly-kapsuli` and `za-kafemashina/tchibo`.
6. **Nothing crawlable points at filtered, sorted or answered-wizard URLs.**
   `robots.txt` already disallows them, and a link to a disallowed URL wastes
   the equity.
7. **The decaf and cheapest-per-cup pages** are linked from every system page
   ("Без кофеин в тази система", "Най-евтино на чаша") and from the footer.

---

## 14. Local SEO and Google Business Profile

- A local pack appeared on 4 of the 28 SERPs, all commercial: `кафе на зърна`,
  `кафе дози`, `caffitaly`, `кафе за вендинг автомати`. Local intent is real for
  beans and ESE.
- **A Google Business Profile needs a place customers can visit, or a business
  that travels to them.** An online shop that confirms by phone and ships by
  courier qualifies as neither, and four storefronts of one company cannot each
  claim the same address. Do not create a profile for Buy-a-Coffee unless it
  gets a staffed point customers can visit. If the legal entity already has a
  profile, that is the company's, not this brand's.
- What is in reach: consistent name, address and phone in `Organization`
  structured data and the footer (from `siteConfig.legal`, already built). Also
  city words in the delivery page's copy, where the terms really cover those
  cities: `магазин за кафе софия` 140, `магазин за кафе пловдив` 170,
  `магазин за кафе варна` 90.

---

## 15. Paid search: what the CPCs imply

Measured top-of-page CPCs, 9 October 2026:

| Cluster                           | CPC €                                                                                                         | Competition | Typical pack, price          | At €0.40 a click                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------- | ------------------------------------------ |
| Lavazza Blue                      | 0.37–0.45                                                                                                     | 0.57–0.60   | 100 capsules, €30–33.25      | **viable**                                 |
| Beans                             | 0.31–0.54                                                                                                     | 0.43–0.60   | 1 kg, €13.45–32              | viable on 1 kg                             |
| ESE pods                          | 0.50–0.56                                                                                                     | 0.67–0.74   | 100–150 pods, €28–42         | viable on bulk                             |
| Generic capsules (`кафе капсули`) | 0.57                                                                                                          | **0.71**    | mixed                        | expensive and vague                        |
| Nespresso-compatible              | 0.30–0.41                                                                                                     | 0.58–0.65   | 10 capsules, €3.35–5.50      | **not viable** on single boxes             |
| Dolce Gusto                       | 0.23–0.36                                                                                                     | 0.50–0.63   | 16 capsules, €4.90–6.65      | not viable on single boxes                 |
| Brand and product line            | 0.29–0.55                                                                                                     | 0.16–0.66   | varies                       | product-line exact match, large packs only |
| Outliers                          | `прясно изпечено кафе` 3.76, `спешълти кафе` 1.54, `кафе кимбо на зърна кауфланд` 2.17, `кафе дози illy` 1.07 | —           | specialty and retail intents | avoid                                      |

What follows:

- **Clicks are cheap; baskets are small.** At €0.40 a click and an assumed 2–4 %
  of visits leaving a phone number, one order request costs about €10–20 in
  clicks. That is a sensible price for a €30–40 box of 100 capsules, 1 kg of
  beans or 150 ESE pods. It is not one for a €4.60 box of ten. **Start with
  Lavazza Blue (office buyers), 1 kg beans and bulk ESE**, exact and phrase
  match only.
- **The owner must supply the margin per order** before any campaign. Prices
  mirror the source, so the margin is the commercial arrangement, and the
  maximum cost per request follows from it, not from these CPCs.
- **Negative keywords**, from the bleed found above: `кауфланд`, `лидл`, `метро`,
  `технополис`, `емаг`, `olx`, `втора ръка`, `гледане`, `гадаене`, `рецепта`,
  `мляно`, `разтворимо`, `vertuo`, `вертуо`, `tassimo`, `тасимо`,
  `iperespresso`, `кафемашина` (unless the ad is the machine page), the pharmacy
  terms.
- No shopping results appeared on any of the 28 SERPs. A Merchant Center feed
  is possible, but there is no checkout to land on, so it is low priority.

---

## 16. Needs from others (exact changes; none made here)

| #   | Change                                                                                                                              | Where                   | Why      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------- |
| 1   | Route slugs per §7, `/bg/` prefix, `/en/` off                                                                                       | routing                 | §7, §11  |
| 2   | Product slug pattern `<brand>-<line>-<format>-<qty>`, ASCII, `dolce-gusto` not `dg`; reserved list of top-level slugs               | slug generator, catalog | §7, §6.2 |
| 3   | Display names: "Капсули за Dolce Gusto", "Кафе дози", not "DG", "Дозети"                                                            | product naming          | §6.2     |
| 4   | Distinguish the two "Lavazza Crema E Aroma 1кг." products                                                                           | catalog data            | §6.1     |
| 5   | Five new listings, §8, each 404 and absent from the sitemap when empty; a decaf flag on the product record rather than a name match | queries, routes         | §8       |
| 6   | Tchibo machine page leads with the Cafissimo cluster and lists the Caffitaly products                                               | `za-kafemashina/tchibo` | §6.3     |
| 7   | Titles and H1s per §12                                                                                                              | metadata                | §12      |
| 8   | Retitle and reslug the "which capsule" article; journal at `/bg/blog/`                                                              | journal                 | §9       |
| 9   | `konsumativi` noindex while empty                                                                                                   | metadata                | §8       |

---

## 17. Method, sources and credit spend

**Source.** DataForSEO Labs via OpenSEO (project "Default", location 2100, language
bg), 9 October 2026. Volumes are Google Ads monthly averages, KD is DataForSEO's,
CPC is top-of-page in euro. SERPs are live desktop Google Bulgaria. Domain
figures are DataForSEO estimates of organic traffic, not analytics.

**Steps.**

1. Read the catalog (`catalog_w4_seo`: 187 products, 20 brands, 8 categories),
   the machine database (`apps/web/src/content/machines.ts`), the routes and the
   four articles.
2. `research_keywords` on seven seeds: `кафе на зърна`, `кафе капсули`,
   `долче густо капсули`, `неспресо капсули`, `кафе дози`,
   `кафе за кафеавтомат`, `съвместими капсули`. That produced ≈ 590 related
   queries, mostly to discover phrasing and bleed.
3. `get_keyword_metrics` in five batches: ≈ 520 formats, brands, machines, price
   and informational terms; ≈ 330 machine models, product lines, competitor
   brands and drinks; 87 English/Latin; 75 wizard, machine-finder and slug
   phrasings; 30 section names and product-size variants. 494 returned data.
4. `get_serp_results` for 28 queries.
5. `get_domain_overview` for kafezona.com, mrcoffee.bg and kafemania.bg.
6. `get_ranked_keywords` for kafezona.com (all 8), mrcoffee.bg and kafemania.bg
   (top 100 each, by estimated traffic).

**Raw data** in `docs/seo-data/`:

- `keyword-metrics.json`: every sized query, plus the requested-without-data
  list
- `research-seeds.json`: the seed expansions
- `serps.json`: organic rows and features per query
- `domains.json`: overviews and ranked keywords

**Credits.** `whoami` read **9,980** before the first call and **9,292** after
the last measurement: **688 credits** against a budget of 1,800. Other agents
share the account, so this is an upper bound on this study's spend.

**Proposed next steps, with cost (not run):**

| Step                                                                                                      |                            Est. credits |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------: |
| Mobile SERPs for the 17 commercial heads (mobile is most of this traffic; features may differ)            |                                     ~85 |
| Monthly trends for the 50 head terms (seasonality: summer dip, December gifting)                          |                                     ~20 |
| Backlink profiles of mrcoffee.bg and kafemania.bg (the authority gap a new domain faces)                  |                                ~200–400 |
| A rank tracker on the ~40 owner terms in §1, weekly after launch                                          | price with `estimate_rank_tracker_cost` |
| After launch: Search Console replaces most of this; re-run §2 only for pages it shows as under-performing |                                       0 |
| Romania / Greece, only if delivery abroad becomes real (§11)                                              |                             ~60–70 each |

---

## 18. What was built from this

Added after the work, and the only part of this file that describes code. The
sections above are the study as it was measured and are left as written, so
where they say "Buy-a-Coffee", "four articles" or "eight decaf products" they
record what was true or proposed on the day. How the pieces work is in
[architecture.md](architecture.md); the reasons are in
[decisions.md](decisions.md#addresses-and-names).

### The decisions in §0

| §0  | Decision                                 | Status                 | Where it lives                                                                                                                                                                                                          |
| --- | ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Demand is capsules first                 | Built into the frame   | The navigation leads with the capsule systems (`apps/web/src/components/layout/navigation.ts`); four of the five added pages are capsule or brand × format pages                                                        |
| 2   | Slugs put the system first               | Done                   | `categories` in `apps/web/src/i18n/slugs/bg.ts`; a category's stored slug answers 308 to its landing slug (`apps/web/src/lib/catalog/resolve-slug.ts`)                                                                  |
| 3   | Add five pages                           | Done                   | Four landing listings (`apps/web/src/lib/catalog/landings.ts`, `apps/web/content/landing-copy.ts`) and the Tchibo machine page (`machineBrandFeatures` in the same copy file)                                           |
| 4   | Keep names, slugs, copy and data our own | Done                   | `productName()` in `packages/shared/src/product-name.ts`; slugs in `packages/shared/src/product-slug.ts`; copy in `apps/web/content/product-copy.ts`, enforced by `pnpm check:originality`                              |
| 5   | Build English, switch `/en` off          | Done                   | `LOCALE_READY` in `apps/web/src/i18n/config.ts`; `apps/web/src/proxy.ts`; `apps/web/src/lib/seo/alternates.ts`                                                                                                          |
| 6   | Journal: one strong target, new articles | Done, with a deviation | Six articles in `apps/web/content/journal/articles/`. The capsule article is retitled and moved; two of the three proposed articles are written (choosing beans; arabica and robusta). See the deviations for the third |
| 7   | The wizard: index the entry page only    | Done                   | `/bg/izbor-na-kafe` is in the sitemap; an answered state is `noindex` and disallowed in `apps/web/src/app/robots.ts`                                                                                                    |
| 8   | Paid search pays only on large packs     | Not a code change      | Nothing in the repository runs or configures a campaign                                                                                                                                                                 |

### The changes in §16

| #   | Change                                                                      | Status                 | Where it lives                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Route slugs per §7, `/bg/` prefix, `/en/` off                               | Done                   | `apps/web/src/i18n/slugs/` (every row of §7 as decided), `apps/web/src/lib/routes.ts`, `apps/web/src/proxy.ts`; the pre-locale URLs answer 308 (`apps/web/src/lib/legacy-routes.ts`)                                               |
| 2   | Product slug pattern; reserved list of top-level slugs                      | Done                   | `<brand>-<line>-<format>-<qty>` from `productName().slugBase`; `RESERVED_PRODUCT_SLUGS` in `packages/shared/src/storefront-data.ts`; stored products moved by `catalog:reslug`, old slugs kept in `products.previous_slugs`        |
| 3   | Display names in the searched words                                         | Done                   | `productName()`: "Капсули за Dolce Gusto", "Кафе дози ESE". The source's name is shown only to the owner                                                                                                                           |
| 4   | Distinguish the two "Lavazza Crema E Aroma 1кг." products                   | Done                   | One override in `apps/web/content/product-names.ts`: the bag from the Expert range is "Crema e Aroma Expert"                                                                                                                       |
| 5   | Five new listings, each 404 and out of the sitemap when empty; a decaf flag | Done, with a deviation | `LandingAvailability` in `apps/web/src/lib/catalog/landings.ts` drives the 404, the sitemap, `llms.txt` and every link. Decaf reads `attributes.decaf`, which the record already held. The fifth page is the machine page in row 6 |
| 6   | Tchibo machine page leads with Cafissimo and lists the Caffitaly products   | Done                   | `apps/web/src/app/(site)/[lang]/za-kafemashina/[brand]/page.tsx`, `machineBrandFeatures`                                                                                                                                           |
| 7   | Titles and H1s per §12                                                      | Done, with deviations  | `apps/web/src/lib/seo/title.ts`, `apps/web/src/lib/seo/listing-meta.ts`, `apps/web/content/category-copy.ts`, `apps/web/content/landing-copy.ts`; §1 is held by `apps/web/test/keyword-map.test.ts`                                |
| 8   | Retitle and reslug the "which capsule" article; journal at `/bg/blog/`      | Done                   | `apps/web/content/journal/articles/which-capsule.ts`, with its old slug in `previousSlugs`; the section is called „Блог“ (`JOURNAL_NAME` in `apps/web/src/lib/journal.ts`)                                                         |
| 9   | `konsumativi` noindex while empty                                           | Done                   | `apps/web/src/app/(site)/[lang]/konsumativi/page.tsx`; left out of the sitemap and `llms.txt` on the same test                                                                                                                     |

The internal-linking rules of §13 are built too: breadcrumbs by format
(`categoryCrumbs` in `apps/web/src/lib/seo/json-ld.ts`), one link from a
system's listing to the machine finder, one article per listing (`article` in
`category-copy.ts`), and the links between pages that must not compete
(`apps/web/src/lib/catalog/related-landings.ts`).

### Deliberate deviations

- **The shop's name is printed "Buy a Coffee", not "Buy-a-Coffee".** Every
  title in §12 ends with the hyphenated form; the built titles end
  `| Buy a Coffee`, from `siteConfig.name`.
- **The Caffitaly listing's title does not mention Tchibo Cafissimo.** §12
  gives it "стават и за Tchibo Cafissimo"; §1 gives that term to the Tchibo
  machine page, so the two tables of this study pull against each other. The
  built title is "Капсули Caffitaly (Кафитали) — цена на чаша"; the listing's
  description and introduction say it fits Cafissimo and link to that page.
- **Titles are not held to sixty characters.** §12 asks for fifty to sixty,
  and its own examples run longer once the name is added. Nothing enforces a
  length. The one place the figure is used is the brand title, which adds
  "— цена на чаша" only while the whole title stays within sixty.
- **No figure is typed into a title.** §12 writes "100 бр." into the Lavazza
  Blue title, "1 кг" into the Lavazza beans title, a list of systems into the
  Lavazza capsules title and a list of formats into the decaf title. Each is
  computed from the catalog when the page renders, and left out when it is not
  true of everything on the page.
- **Decaf lists more products than §8 counted.** §8 says eight, counted by
  name. The page lists by the record's flag, which eleven products in the
  reference snapshot carry.
- **Two new articles, not three.** §9 leaves „Италиански марки кафе“ to either
  an article or the brands index, "one, not both". The brands index carries
  it: its title is "Марки кафе — италиански и други" and its introduction
  names the brands recorded as Italian (`apps/web/content/brand-facts.ts`).
- **The promotions page does not disappear.** §1 has it exist only while a
  reduction exists. It answers 200 so no link to it breaks, and is `noindex`
  and out of the sitemap, `llms.txt` and the navigation while nothing is
  reduced.
- **A Modo Mio has a title §12 does not list:** "Капсули Lavazza A Modo Mio
  (Лаваца А Модо Мио)".
