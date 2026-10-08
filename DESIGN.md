---
name: Buy-a-Coffee
description: Bulgarian coffee shop for beans, capsules and pods, organised by the machine the customer owns.
colors:
  ink-900: "#23180f"
  ink-700: "#463b32"
  ink-500: "#5f544c"
  ink-300: "#726860"
  paper: "#faf6ee"
  paper-raised: "#ffffff"
  paper-sunken: "#f2ece1"
  well: "#ffffff"
  pine-900: "#002c1d"
  pine-700: "#0b4f38"
  pine-500: "#237356"
  pine-200: "#b7dbca"
  pine-100: "#d8f0e5"
  gold-600: "#ac7c26"
  gold-500: "#bc8a35"
  gold-300: "#e0b76c"
  gold-100: "#f9ebcf"
  clay-600: "#963912"
  clay-500: "#d67047"
  clay-100: "#fee5db"
  line: "#ded8cf"
  line-strong: "#8d8579"
  positive: "#17653c"
  caution: "#794d0b"
  caution-100: "#f9edc8"
  critical: "#b7191c"
  critical-100: "#fde7e4"
  sys-nespresso-original: "#7a2b56"
  sys-nespresso-original-100: "#fce3ee"
  sys-dolce-gusto: "#0e5a65"
  sys-dolce-gusto-100: "#d5f1f6"
  sys-a-modo-mio: "#543a8b"
  sys-a-modo-mio-100: "#ece8fe"
  sys-caffitaly: "#475b1d"
  sys-caffitaly-100: "#e4f1d1"
  sys-lavazza-blue: "#154d8c"
  sys-lavazza-blue-100: "#dfedfe"
  sys-ese-pod: "#444e5b"
  sys-ese-pod-100: "#e3e8f0"
  sys-beans: "#5d381e"
  sys-beans-100: "#f7e4d4"
typography:
  hero:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "52px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  hero-sm:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: "-0.015em"
  page-title:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  page-title-sm:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  section-title:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: "-0.015em"
  section-title-sm:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  panel-title:
    fontFamily: "Literata, Georgia, 'Times New Roman', serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  price-lg:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "31px"
    fontWeight: 600
    lineHeight: 1.19
    fontFeature: "tnum 1"
  price:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.53
    fontFeature: "tnum 1"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.54
  card-title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.54
  control:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.6
  input:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.06em"
rounded:
  xs: "2px"
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  section: "64px"
  section-sm: "48px"
components:
  button-primary:
    backgroundColor: "{colors.pine-900}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.pine-700}"
  button-accent:
    backgroundColor: "{colors.gold-500}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.sm}"
    padding: "12px 24px"
  button-accent-hover:
    backgroundColor: "{colors.gold-600}"
  button-secondary:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.sm}"
    padding: "10px 20px"
  card-product:
    backgroundColor: "{colors.paper-raised}"
    rounded: "{rounded.md}"
    padding: "12px"
  input-text:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "48px"
  badge-reduction:
    backgroundColor: "{colors.clay-600}"
    textColor: "{colors.paper-raised}"
    rounded: "{rounded.xs}"
    padding: "2px 6px"
  announcement-bar:
    backgroundColor: "{colors.pine-900}"
    textColor: "{colors.paper}"
---

# Design System: Buy-a-Coffee

This document is the standard that components are reviewed against. Where it
names a Tailwind class, the class is the specification. Where a component in
the repository disagrees with it, the component is wrong.

Tokens live in `apps/web/src/app/globals.css`. Token names are an interface used
across the storefront and the admin panel: a name is never renamed or removed.

## Overview

**North star: the counter of a well-stocked espresso bar.** The shelf behind the
counter is loud — twenty brands, every pack a different colour. The counter is
dark green, the walls are cream, the price list is set in one typeface, and the
person behind it asks one question first: _what machine do you have?_

Three layers carry that, and they must agree:

1. **Navigation is machine first.** The catalog is entered by brewing system and
   by machine model, ahead of brand and ahead of product type.
2. **The interface is quiet; the packs carry the colour.** Warm neutrals, pine as
   the structural anchor, one gold accent, hairlines instead of shadows.
3. **The voice is a plain-spoken advisor.** See `PRODUCT.md`, "Voice".

**Key characteristics**

- Pine green, cream paper, one gold. Clay appears only where a price was reduced.
- Seven brewing-system colours, each one always beside the system's name.
- A serif display face for headings, a sans face for everything a customer reads
  to decide: names, prices, facts.
- Squared geometry: radii of 2 to 10 px. Nothing is pill-shaped.
- Flat. Structure comes from hairlines and three paper tones. Shadows are for
  things that float over the page.
- Every figure a customer compares is tabular and carries its unit.
- Packshots sit on pure white, because that is what they were photographed on.

**What was wrong before, and what this fixes.** The first build had no imagery
on the home page and read closer to a law firm than a coffee shop; the logo was
gold and brown and shared no colour with a green-and-grey interface; and the
catalog was organised by product type when customers shop by the machine they
own. The identity — pine, cream, Literata over Inter, small radii — was coherent
and stays.

## Colors

All values are OKLCH in `globals.css`. The hex in the front matter is the sRGB
value Chromium paints, to within one step per channel.

### Neutral — ink and paper

Warm, on the hue of the wordmark's brown lettering (`#291500`), so text and logo
read as one material.

| Token          | Value                   | Hex       | Role                                                                                       |
| -------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `ink-900`      | `oklch(0.22 0.025 60)`  | `#23180f` | Body text, headings, prices, text on gold.                                                 |
| `ink-700`      | `oklch(0.36 0.022 60)`  | `#463b32` | Secondary text: descriptions, navigation links at rest, neutral badge text.                |
| `ink-500`      | `oklch(0.455 0.02 60)`  | `#5f544c` | Meta: brand line, captions, table labels, helper text.                                     |
| `ink-300`      | `oklch(0.525 0.018 60)` | `#726860` | The floor: counts, struck-through old price, placeholder text, separators, quiet icons.    |
| `paper`        | `oklch(0.975 0.012 85)` | `#faf6ee` | The page.                                                                                  |
| `paper-raised` | `oklch(1 0 0)`          | `#ffffff` | Cards, panels, inputs, dropdowns, the drawer.                                              |
| `paper-sunken` | `oklch(0.945 0.016 85)` | `#f2ece1` | Bands, the footer, neutral badges, hover fill, skeletons, the image placeholder.           |
| `well`         | `oklch(1 0 0)`          | `#ffffff` | The ground behind a packshot. Equal to `paper-raised` today; a separate name on purpose.   |
| `line`         | `oklch(0.885 0.014 80)` | `#ded8cf` | Dividers and the edges of cards and panels. Decorative: carries no meaning by itself.      |
| `line-strong`  | `oklch(0.62 0.02 75)`   | `#8d8579` | The edge of a control: inputs, selects, checkboxes, secondary buttons, chips. 3:1 or more. |

### Primary — pine

The anchor. Structure, primary actions, links and focus.

| Token      | Value                   | Hex       | Role                                                                                       |
| ---------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `pine-900` | `oklch(0.26 0.055 165)` | `#002c1d` | Announcement bar, hero band, Vending Zone band, primary button, selected chip and page.    |
| `pine-700` | `oklch(0.38 0.075 165)` | `#0b4f38` | Link text, price per cup, the focus ring, primary-button hover, filled intensity segments. |
| `pine-500` | `oklch(0.5 0.09 165)`   | `#237356` | Hover and selected borders. Not a fill.                                                    |
| `pine-200` | `oklch(0.86 0.045 165)` | `#b7dbca` | Secondary text and ghost-button border on `pine-900`. Never on paper.                      |
| `pine-100` | `oklch(0.935 0.03 165)` | `#d8f0e5` | Wash: positive badge, selected option, success panel, text selection.                      |

### Accent — gold

Sampled from the mark: the modal pixel of `apps/web/public/logo-icon-only.png`
is `#bb8936`; `gold-500` paints `#bc8a35`.

| Token      | Value                     | Hex       | Role                                                                                     |
| ---------- | ------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `gold-500` | `oklch(0.667 0.117 77.5)` | `#bc8a35` | Fill under `ink-900`: the accent button, the step numeral. A rule or icon on `pine-900`. |
| `gold-600` | `oklch(0.62 0.115 78)`    | `#ac7c26` | Hover of the accent button on a light ground.                                            |
| `gold-300` | `oklch(0.8 0.105 82)`     | `#e0b76c` | Text, links and the focus ring on `pine-900`; hover of the accent button on `pine-900`.  |
| `gold-100` | `oklch(0.945 0.04 85)`    | `#f9ebcf` | Wash for one advisory panel per page (the wizard entry).                                 |

### Reduction — clay

| Token      | Value                  | Hex       | Role                                                                     |
| ---------- | ---------------------- | --------- | ------------------------------------------------------------------------ |
| `clay-600` | `oklch(0.47 0.135 40)` | `#963912` | The reduced price, the reduction badge fill, the "Промоции" link.        |
| `clay-500` | `oklch(0.655 0.14 42)` | `#d67047` | A 1 px rule or border on `paper` or `paper-raised` around reduced goods. |
| `clay-100` | `oklch(0.94 0.03 45)`  | `#fee5db` | Wash behind the promotions band.                                         |

### Status

| Token          | Value                   | Hex       | Role                                                         |
| -------------- | ----------------------- | --------- | ------------------------------------------------------------ |
| `positive`     | `oklch(0.45 0.1 155)`   | `#17653c` | Positive text where `pine-900` on `pine-100` is not used.    |
| `caution`      | `oklch(0.46 0.095 70)`  | `#794d0b` | Caution text: "По поръчка", a caveat, the title of a notice. |
| `caution-100`  | `oklch(0.945 0.05 92)`  | `#f9edc8` | Wash for a caution badge or notice.                          |
| `critical`     | `oklch(0.5 0.19 27)`    | `#b7191c` | Form errors, invalid borders, the danger button. Forms only. |
| `critical-100` | `oklch(0.945 0.025 25)` | `#fde7e4` | Wash for an error summary.                                   |

### Brewing systems

One hue per system, keyed by `BrewingSystemId` in
`apps/web/src/lib/recommend/systems.ts`. Each has a solid and a wash.

| System id            | Shown as           | Solid `sys-<id>`        | Hex       | Wash `sys-<id>-100`     | Hex       |
| -------------------- | ------------------ | ----------------------- | --------- | ----------------------- | --------- |
| `nespresso-original` | Nespresso Original | `oklch(0.42 0.12 350)`  | `#7a2b56` | `oklch(0.94 0.03 350)`  | `#fce3ee` |
| `dolce-gusto`        | Dolce Gusto        | `oklch(0.43 0.07 210)`  | `#0e5a65` | `oklch(0.94 0.03 210)`  | `#d5f1f6` |
| `a-modo-mio`         | Lavazza A Modo Mio | `oklch(0.42 0.13 295)`  | `#543a8b` | `oklch(0.94 0.03 295)`  | `#ece8fe` |
| `caffitaly`          | Caffitaly          | `oklch(0.44 0.09 125)`  | `#475b1d` | `oklch(0.94 0.045 125)` | `#e4f1d1` |
| `lavazza-blue`       | Lavazza Blue       | `oklch(0.42 0.12 255)`  | `#154d8c` | `oklch(0.94 0.027 255)` | `#dfedfe` |
| `ese-pod`            | Дози ESE           | `oklch(0.42 0.025 255)` | `#444e5b` | `oklch(0.93 0.012 255)` | `#e3e8f0` |
| `beans`              | Кафе на зърна      | `oklch(0.38 0.065 55)`  | `#5d381e` | `oklch(0.93 0.03 65)`   | `#f7e4d4` |

The hues are chosen to be distinct from each other and from pine (165), gold
(78), clay (40) and critical (27). They are not the system owners' brand
colours and are not meant to be.

**Using them.** A system id arrives at runtime, and Tailwind cannot generate a
class assembled from one. Put `data-system={system.id}` on the element instead.
`globals.css` then sets two custom properties on it and its children:

- `--system` — the solid. Use as `text-(--system)`, `bg-(--system)`,
  `border-(--system)`.
- `--system-wash` — the wash. Use as `bg-(--system-wash)`.

An unknown id resolves to `ink-700` on `paper-sunken`, so a system added before
it has a colour still renders legibly.

Sanctioned uses of a system colour, and no others:

| Use                                    | Foreground     | Background      | Lowest measured ratio |
| -------------------------------------- | -------------- | --------------- | --------------------- |
| System badge                           | `--system`     | `--system-wash` | 6.39 (Caffitaly)      |
| System name as text on a page or card  | `--system`     | any paper tone  | 6.41 (Caffitaly)      |
| Solid tile edge or swatch + white text | `paper-raised` | `--system`      | 7.54 (Caffitaly)      |
| Body text on a system tile             | `ink-900`      | `--system-wash` | 14.06 (beans)         |

### Named rules

**The One Gold Rule.** Gold is a fill under `ink-900`, used for the single most
important action in a viewport. At most one `gold-500` control is visible at a
time. Gold is never text on a paper tone: `gold-500` on `paper` measures 2.85:1.
On `pine-900` it may be text, as `gold-300` (8.09:1).

**The Gold Ground Rule.** The accent button sits on `pine-900` (edge 4.95:1) or
on `paper-raised` (edge 3.07:1). It never sits directly on `paper` or
`paper-sunken`, where its edge falls under 3:1.

**The Clay Means Reduced Rule.** Clay marks a price that went down: the reduced
price, the reduction badge, the promotions link and band. It is not a caution
colour, a brand flourish or a hover state. Cautions use `caution`.

**The Critical Stays In Forms Rule.** `critical` appears on a form error and a
destructive admin action. "Изчерпан" is not an error and is a neutral badge.
This keeps red and clay from ever sitting side by side on a product.

**The Named Colour Rule.** A system colour never appears without the system's
name in text beside it. A swatch alone, a coloured border alone, a legend
somewhere else on the page: none of these is enough.

**The White Well Rule.** A packshot sits on `well`. The photographs have white
grounds; any tinted ground draws a rectangle around the photograph.

**The Measured Contrast Rule.** A text and background pairing is allowed only if
it is in the table below. Adding one means measuring it and adding the row.
Opacity is not used to lighten text; use the next ink step.

### Measured contrast

Method: each OKLCH value is converted to linear sRGB, clipped to gamut (no token
is out of gamut), encoded to 8-bit sRGB, and the WCAG 2.x relative-luminance
contrast ratio is computed from the 8-bit values. Ratios are truncated to two
decimals, never rounded up. The 8-bit values were checked against what Chromium
paints for every token (41 of 41 within one step per channel). `a/NN/b` means
`a` at NN% alpha composited over `b`.

Required: 4.5 for text, 3 for the edge of a control or a graphic that carries
meaning. Rows marked PROHIBITED and LEGACY fail on purpose and are listed so
that nobody measures them again; see "Migration" at the end.

| Foreground               | Background                   | Ratio | Required | Result | Use                                                                                        |
| ------------------------ | ---------------------------- | ----- | -------- | ------ | ------------------------------------------------------------------------------------------ |
| `ink-900`                | `paper`                      | 16.11 | 4.5      | pass   | body text, headings                                                                        |
| `ink-900`                | `paper-raised`               | 17.36 | 4.5      | pass   | text on cards, inputs                                                                      |
| `ink-900`                | `paper-sunken`               | 14.77 | 4.5      | pass   | text in wells, footer                                                                      |
| `ink-700`                | `paper`                      | 10.08 | 4.5      | pass   | secondary text                                                                             |
| `ink-700`                | `paper-raised`               | 10.86 | 4.5      | pass   | secondary text on cards                                                                    |
| `ink-700`                | `paper-sunken`               | 9.24  | 4.5      | pass   | neutral badge, notices                                                                     |
| `ink-500`                | `paper`                      | 6.81  | 4.5      | pass   | meta, captions                                                                             |
| `ink-500`                | `paper-raised`               | 7.34  | 4.5      | pass   | meta on cards                                                                              |
| `ink-500`                | `paper-sunken`               | 6.24  | 4.5      | pass   | meta in wells, footer                                                                      |
| `ink-300`                | `paper`                      | 5.04  | 4.5      | pass   | counts, struck-through old price, placeholder                                              |
| `ink-300`                | `paper-raised`               | 5.43  | 4.5      | pass   | same, on cards and inputs                                                                  |
| `ink-300`                | `paper-sunken`               | 4.62  | 4.5      | pass   | same, in wells                                                                             |
| `paper`                  | `pine-900`                   | 14.13 | 4.5      | pass   | primary button, utility strip, footer band                                                 |
| `paper-raised`           | `pine-900`                   | 15.23 | 4.5      | pass   | text on pine                                                                               |
| `paper`                  | `pine-700`                   | 8.89  | 4.5      | pass   | primary button hover                                                                       |
| `pine-200`               | `pine-900`                   | 10.15 | 4.5      | pass   | secondary text on pine                                                                     |
| `gold-300`               | `pine-900`                   | 8.09  | 4.5      | pass   | eyebrow, links and focus ring on pine                                                      |
| `gold-500`               | `pine-900`                   | 4.95  | 3        | pass   | gold rule or icon on pine (non-text)                                                       |
| `pine-900`               | `paper`                      | 14.13 | 4.5      | pass   | emphasised text                                                                            |
| `pine-900`               | `pine-100`                   | 12.71 | 4.5      | pass   | positive badge, selected option                                                            |
| `pine-700`               | `paper`                      | 8.89  | 4.5      | pass   | links, price per cup, focus ring                                                           |
| `pine-700`               | `paper-raised`               | 9.59  | 4.5      | pass   | links on cards, focus ring                                                                 |
| `pine-700`               | `paper-sunken`               | 8.15  | 4.5      | pass   | links in wells, focus ring                                                                 |
| `pine-700`               | `pine-100`                   | 7.99  | 4.5      | pass   | link on hover wash                                                                         |
| `pine-500`               | `paper`                      | 5.32  | 3        | pass   | hover and selected border (non-text)                                                       |
| `pine-500`               | `paper-raised`               | 5.74  | 3        | pass   | selected border on cards (non-text)                                                        |
| `pine-500`               | `paper`                      | 5.32  | 4.5      | pass   | text (one existing use)                                                                    |
| `ink-900`                | `gold-500`                   | 5.64  | 4.5      | pass   | accent button, announcement bar, step numeral                                              |
| `ink-900`                | `gold-600`                   | 4.68  | 4.5      | pass   | accent button hover                                                                        |
| `pine-900`               | `gold-500`                   | 4.95  | 4.5      | pass   | pine text on accent fill                                                                   |
| `ink-900`                | `gold-300`                   | 9.23  | 4.5      | pass   | accent button hover on pine                                                                |
| `ink-900`                | `gold-100`                   | 14.73 | 4.5      | pass   | text on gold wash                                                                          |
| `ink-700`                | `gold-100`                   | 9.21  | 4.5      | pass   | secondary text on gold wash                                                                |
| `gold-500`               | `paper`                      | 2.85  | 4.5      | FAIL   | PROHIBITED: gold text on cream                                                             |
| `gold-600`               | `paper`                      | 3.43  | 3        | pass   | gold graphic on paper (non-text)                                                           |
| `paper-raised`           | `clay-600`                   | 7.26  | 4.5      | pass   | reduction badge                                                                            |
| `paper`                  | `clay-600`                   | 6.73  | 4.5      | pass   | reduction badge                                                                            |
| `paper`                  | `clay-500`                   | 3.10  | 4.5      | FAIL   | LEGACY: Badge accent (failed before this change too); use clay-600                         |
| `clay-600`               | `paper`                      | 6.73  | 4.5      | pass   | reduction text                                                                             |
| `clay-600`               | `paper-raised`               | 7.26  | 4.5      | pass   | reduction text on cards                                                                    |
| `clay-600`               | `paper-sunken`               | 6.17  | 4.5      | pass   | reduction text in wells                                                                    |
| `clay-600`               | `clay-100`                   | 6.03  | 4.5      | pass   | reduction text on wash                                                                     |
| `clay-600`               | `clay-100/60/paper`          | 6.31  | 4.5      | pass   | existing promotions band                                                                   |
| `ink-900`                | `clay-100`                   | 14.42 | 4.5      | pass   | text on reduction wash                                                                     |
| `ink-700`                | `clay-100`                   | 9.02  | 4.5      | pass   | secondary text on reduction wash                                                           |
| `clay-500`               | `paper`                      | 3.10  | 3        | pass   | reduction border (non-text)                                                                |
| `ink-900`                | `clay-500`                   | 5.18  | 4.5      | pass   | existing hero CTA and step squares (replaced by gold in F4)                                |
| `clay-500`               | `pine-900`                   | 4.54  | 4.5      | pass   | existing hero eyebrow (replaced by gold-300 in F4)                                         |
| `line-strong`            | `paper`                      | 3.38  | 3        | pass   | control border                                                                             |
| `line-strong`            | `paper-raised`               | 3.64  | 3        | pass   | control border on cards                                                                    |
| `line-strong`            | `paper-sunken`               | 3.09  | 3        | pass   | control border in wells                                                                    |
| `positive`               | `paper`                      | 6.57  | 4.5      | pass   | positive text                                                                              |
| `positive`               | `paper-raised`               | 7.08  | 4.5      | pass   | positive text on cards                                                                     |
| `positive`               | `pine-100`                   | 5.91  | 4.5      | pass   | positive text on wash                                                                      |
| `caution`                | `paper`                      | 6.76  | 4.5      | pass   | caution text                                                                               |
| `caution`                | `paper-raised`               | 7.29  | 4.5      | pass   | caution text on cards                                                                      |
| `caution`                | `caution-100`                | 6.24  | 4.5      | pass   | caution badge, notice title                                                                |
| `ink-900`                | `caution-100`                | 14.86 | 4.5      | pass   | notice body                                                                                |
| `ink-700`                | `caution-100`                | 9.30  | 4.5      | pass   | notice body, secondary                                                                     |
| `critical`               | `paper`                      | 6.14  | 4.5      | pass   | error text, invalid border                                                                 |
| `critical`               | `paper-raised`               | 6.62  | 4.5      | pass   | error text in forms                                                                        |
| `critical`               | `critical-100`               | 5.59  | 4.5      | pass   | critical badge, error notice                                                               |
| `critical`               | `critical/10/paper`          | 5.19  | 4.5      | pass   | existing critical badge                                                                    |
| `critical`               | `critical/10/paper-raised`   | 5.58  | 4.5      | pass   | existing critical badge on card                                                            |
| `paper`                  | `critical`                   | 6.14  | 4.5      | pass   | danger button                                                                              |
| `paper/80/pine-900`      | `pine-900`                   | 9.49  | 4.5      | pass   | existing hero text (alpha)                                                                 |
| `paper/60/pine-900`      | `pine-900`                   | 5.91  | 4.5      | pass   | existing hero small text (alpha)                                                           |
| `pine-900/80/pine-100`   | `pine-100`                   | 7.21  | 4.5      | pass   | existing order-success text (alpha)                                                        |
| `gold-500`               | `paper-raised`               | 3.07  | 3        | pass   | accent button edge against a card (non-text)                                               |
| `gold-500`               | `paper`                      | 2.85  | 3        | FAIL   | PROHIBITED: accent button directly on paper (edge under 3:1)                               |
| `pine-900`               | `paper`                      | 14.13 | 3        | pass   | primary button edge (non-text)                                                             |
| `pine-200`               | `pine-900`                   | 10.15 | 3        | pass   | ghost button border on pine (non-text)                                                     |
| `pine-700`               | `line`                       | 6.77  | 1        | pass   | intensity scale, filled against empty segment (informative; the numeral carries the value) |
| `ink-500`                | `gold-100`                   | 6.23  | 4.5      | pass   | meta text on gold wash                                                                     |
| `ink-500`                | `pine-100`                   | 6.12  | 4.5      | pass   | meta text on pine wash                                                                     |
| `ink-700`                | `pine-100`                   | 9.06  | 4.5      | pass   | secondary text on pine wash                                                                |
| `ink-500`                | `clay-100`                   | 6.10  | 4.5      | pass   | meta text on reduction wash                                                                |
| `ink-300`                | `paper-raised`               | 5.43  | 4.5      | pass   | old price beside a reduced price                                                           |
| `sys-nespresso-original` | `sys-nespresso-original-100` | 7.52  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-nespresso-original` | `paper-raised`               | 9.10  | 4.5      | pass   | system name on card                                                                        |
| `sys-nespresso-original` | `paper`                      | 8.44  | 4.5      | pass   | system name on page                                                                        |
| `sys-nespresso-original` | `paper-sunken`               | 7.74  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-nespresso-original`     | 9.10  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-nespresso-original-100` | 14.35 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-dolce-gusto`        | `sys-dolce-gusto-100`        | 6.64  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-dolce-gusto`        | `paper-raised`               | 7.86  | 4.5      | pass   | system name on card                                                                        |
| `sys-dolce-gusto`        | `paper`                      | 7.29  | 4.5      | pass   | system name on page                                                                        |
| `sys-dolce-gusto`        | `paper-sunken`               | 6.69  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-dolce-gusto`            | 7.86  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-dolce-gusto-100`        | 14.67 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-a-modo-mio`         | `sys-a-modo-mio-100`         | 7.44  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-a-modo-mio`         | `paper-raised`               | 8.91  | 4.5      | pass   | system name on card                                                                        |
| `sys-a-modo-mio`         | `paper`                      | 8.27  | 4.5      | pass   | system name on page                                                                        |
| `sys-a-modo-mio`         | `paper-sunken`               | 7.58  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-a-modo-mio`             | 8.91  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-a-modo-mio-100`         | 14.50 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-caffitaly`          | `sys-caffitaly-100`          | 6.39  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-caffitaly`          | `paper-raised`               | 7.54  | 4.5      | pass   | system name on card                                                                        |
| `sys-caffitaly`          | `paper`                      | 7.00  | 4.5      | pass   | system name on page                                                                        |
| `sys-caffitaly`          | `paper-sunken`               | 6.41  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-caffitaly`              | 7.54  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-caffitaly-100`          | 14.72 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-lavazza-blue`       | `sys-lavazza-blue-100`       | 7.15  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-lavazza-blue`       | `paper-raised`               | 8.49  | 4.5      | pass   | system name on card                                                                        |
| `sys-lavazza-blue`       | `paper`                      | 7.88  | 4.5      | pass   | system name on page                                                                        |
| `sys-lavazza-blue`       | `paper-sunken`               | 7.22  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-lavazza-blue`           | 8.49  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-lavazza-blue-100`       | 14.62 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-ese-pod`            | `sys-ese-pod-100`            | 6.86  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-ese-pod`            | `paper-raised`               | 8.44  | 4.5      | pass   | system name on card                                                                        |
| `sys-ese-pod`            | `paper`                      | 7.83  | 4.5      | pass   | system name on page                                                                        |
| `sys-ese-pod`            | `paper-sunken`               | 7.18  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-ese-pod`                | 8.44  | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-ese-pod-100`            | 14.11 | 4.5      | pass   | ink text on system wash                                                                    |
| `sys-beans`              | `sys-beans-100`              | 8.29  | 4.5      | pass   | system badge: name on wash                                                                 |
| `sys-beans`              | `paper-raised`               | 10.24 | 4.5      | pass   | system name on card                                                                        |
| `sys-beans`              | `paper`                      | 9.50  | 4.5      | pass   | system name on page                                                                        |
| `sys-beans`              | `paper-sunken`               | 8.71  | 4.5      | pass   | system name in well                                                                        |
| `paper-raised`           | `sys-beans`                  | 10.24 | 4.5      | pass   | white text on solid system fill                                                            |
| `ink-900`                | `sys-beans-100`              | 14.06 | 4.5      | pass   | ink text on system wash                                                                    |

## Typography

**Display:** Literata, weight 600, `letter-spacing: -0.015em`, `text-wrap:
balance`. Headings only: `h1`, `h2`, `h3` in page chrome, panel titles, wizard
option labels.

**Body:** Inter. Everything a customer reads to decide: product names, prices,
facts, labels, controls, paragraphs.

Both carry Cyrillic. That is a requirement, not a preference.

### Scale

The token scale in `globals.css` is the only one. Root size is 16 px.

| Token        | Size  | Line height |
| ------------ | ----- | ----------- |
| `text-2xs`   | 11 px | 16 px       |
| `text-xs`    | 12 px | 18 px       |
| `text-sm`    | 13 px | 20 px       |
| `text-base`  | 15 px | 24 px       |
| `text-input` | 16 px | 24 px       |
| `text-lg`    | 17 px | 26 px       |
| `text-xl`    | 20 px | 28 px       |
| `text-2xl`   | 24 px | 31.2 px     |
| `text-3xl`   | 31 px | 36.8 px     |
| `text-4xl`   | 40 px | 44 px       |
| `text-5xl`   | 52 px | 54.4 px     |

### Hierarchy

| Role                   | Classes                                                                           | Where                                                |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Hero title             | `font-display text-3xl md:text-5xl font-semibold leading-[1.1]`                   | Home `h1` only.                                      |
| Page title             | `font-display text-2xl md:text-4xl font-semibold`                                 | `h1` on listing, product, wizard, content pages.     |
| Section title          | `font-display text-2xl md:text-3xl font-semibold`                                 | `h2` (the `SectionHeading` primitive).               |
| Panel title            | `font-display text-lg md:text-xl font-semibold`                                   | `h2`/`h3` inside a panel, tile or empty state.       |
| Lead                   | `text-lg text-ink-700`, max 60ch                                                  | One paragraph under a page or hero title.            |
| Body                   | `text-base text-ink-700`, max `--container-measure` (68ch)                        | Paragraphs, descriptions.                            |
| Product name (card)    | `font-sans text-sm font-medium text-ink-900`                                      | `h3` in a product card.                              |
| Price                  | `text-lg font-semibold tabular-nums text-ink-900`                                 | Card.                                                |
| Price, product page    | `text-3xl font-semibold tabular-nums text-ink-900` (Inter, not Literata)          | Product page.                                        |
| Price per cup / per kg | `text-xs font-medium tabular-nums text-pine-700` (card), `text-sm` (product page) | Directly under the price.                            |
| Control                | `text-base font-medium` (`text-sm` at size `sm`)                                  | Buttons, navigation links.                           |
| Field text             | `text-input`                                                                      | `input`, `select`, `textarea`.                       |
| Meta                   | `text-xs text-ink-500`                                                            | Captions, helper text, breadcrumbs.                  |
| Label                  | `text-2xs font-semibold tracking-[0.06em] uppercase text-ink-500`                 | Eyebrows, brand line, badge text, table group heads. |
| Count                  | `text-2xs tabular-nums text-ink-300`                                              | Facet and navigation counts.                         |

### Named rules

**The Sans For Deciding Rule.** Product names and prices are Inter. Product
names mix Cyrillic, Latin and numerals in one string ("Капсули Nespresso Rema
Caffè Arabica Gold 10 бр.") and run to three lines on a phone; a serif at 13 px
does not survive that. Literata is for the shop's own voice — headings.

**The Tabular Rule.** Every price, price per cup, price per kilogram, count,
intensity numeral and pack size is `tabular-nums`.

**The Unit Rule.** A figure is never shown without its unit or its scale:
"5,60 €", "0,35 € на чаша", "39,80 € / кг", "8 от 12", "16 бр.", "1 кг".

**The Eleven Pixel Floor Rule.** Nothing is set below `text-2xs` (11 px).

**The Sixteen Pixel Field Rule.** Form fields use `text-input` (16 px). Below
that, iOS Safari zooms the page when the field takes focus.

**The No Uppercase Sentences Rule.** Uppercase is for labels of one to three
words. A reason phrase, a caveat or a system name is never uppercased. System
and brand names keep their own capitalisation everywhere.

**The Heading Order Rule.** One `h1` per page. Levels are never skipped. A
product name in a grid is an `h3` when the grid has an `h2` above it and an
`h2` when it does not.

## Layout

**Shell.** `.shell`: max width 1180 px (`--container-shell`), centred, side
padding 16 px below `md` and 32 px from `md`. Every band's content sits in a
shell; band backgrounds run edge to edge.

**Breakpoints.** Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280.
Designs are specified at 390 px (phone) and 1366 px (desktop) and must not
scroll horizontally at 320 px.

**Vertical rhythm.**

| Use                        | Value                                      |
| -------------------------- | ------------------------------------------ |
| Section padding            | `py-12` (48 px), `md:py-16` (64 px)        |
| Hero padding               | `py-10`, `md:py-16`                        |
| Section title to content   | `mb-6` (24 px)                             |
| Between panels in a column | `gap-6` below `md`, `gap-8` from `md`      |
| Inside a panel             | `p-4` below `md`, `p-5` or `p-6` from `md` |
| Inside a product card body | `p-3` below `md`, `p-4` from `md`          |

Spacing uses the 4 px Tailwind scale. No arbitrary pixel values for spacing.

**Bands.** Sections alternate by tone, not by box: `paper` by default,
`paper-sunken` for the wizard entry and the footer, `pine-900` for the hero and
the Vending Zone band, `clay-100` for promotions. Adjacent bands of the same
tone are separated by a `border-t border-line`.

**Grids.**

| Grid                              | Columns                      | Gap                                        |
| --------------------------------- | ---------------------------- | ------------------------------------------ |
| Product grid, full width          | 2, `md:` 3, `lg:` 4          | `gap-x-3 gap-y-6`, `md:gap-x-5 md:gap-y-8` |
| Product grid beside a filter rail | 2, `md:` 3, `lg:` 3, `xl:` 3 | same                                       |
| System tiles                      | 2, `md:` 3, `lg:` 4          | `gap-3`, `md:gap-4`                        |
| Product page top                  | 1, `lg:` 2 equal columns     | `gap-8`, `lg:gap-12`                       |
| Listing                           | 1, `lg:` `240px 1fr`         | `lg:gap-8`                                 |

Grid children are `li` elements with `h-full` cards, so every card in a row is
the height of the tallest.

**Measure.** Running text is capped at `--container-measure` (68ch). Lead
paragraphs at 60ch.

**The Reserved Space Rule.** Anything that arrives late or may be absent keeps
its box: images carry an aspect ratio, optional card rows keep their height,
buttons keep their width while pending. Layout shift is a defect with a budget
(CLS under 0.1).

**The Min Height Rule.** Controls are sized with `min-h-*` and padding, not a
fixed `h-*`, so a wrapped label or enlarged text grows the control instead of
overflowing it.

## Elevation

Flat by default. Three devices, in order of preference:

1. **Tone.** `paper-sunken` → `paper` → `paper-raised`.
2. **Hairline.** `border border-line` around cards and panels; `border-line-strong`
   around controls.
3. **Shadow**, only for things that sit above the page:

| Token          | Value                                          | Use                                                                  |
| -------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `shadow-raise` | `0 1px 2px oklch(0.22 0.025 60 / 0.07)`        | A product card or tile on hover and focus-within. Nothing at rest.   |
| `shadow-float` | `0 8px 28px -12px oklch(0.22 0.025 60 / 0.24)` | Dropdown panel, typeahead list, mobile drawer, filter sheet, dialog. |

Overlays that cover the page (drawer, sheet, dialog) add a scrim of
`bg-ink-900/40`.

Z-order: sticky header 40; dropdown and typeahead 50; drawer, sheet and dialog
50 with their scrim; skip link 100.

**The No Resting Shadow Rule.** Nothing on the page has a shadow until the
customer interacts with it.

**The No Nested Cards Rule.** A bordered panel does not go inside a bordered
panel. Use a hairline divider or a tone step.

## Shape

| Token        | Radius | Use                                                                        |
| ------------ | ------ | -------------------------------------------------------------------------- |
| `rounded-xs` | 2 px   | Badges, the system badge, checkboxes, step numerals, intensity track ends. |
| `rounded-sm` | 4 px   | Buttons, inputs, selects, chips, navigation rows, thumbnails.              |
| `rounded-md` | 6 px   | Cards, packshot wells, panels, tiles, dropdown panels.                     |
| `rounded-lg` | 10 px  | The top corners of the filter sheet, dialogs. Nothing else.                |

- Nothing is pill-shaped and nothing is circular.
- Borders are 1 px. The only 2 px strokes are the focus ring, the selected
  gallery thumbnail and the underline of the active navigation item. The only
  thicker stroke is the 4 px system edge on a system tile.
- Icons are 1.5 to 2 px stroked line drawings on a 16, 20 or 24 px grid, in
  `currentColor`, inline SVG with `aria-hidden`. No icon font, no emoji, no
  filled or two-tone icons.
- A selected state swaps fill or border colour. It does not add a ring, grow or
  move.

## Motion

- Colour, border and background: `transition-colors`, 150 ms.
- Drawer and sheet: translate plus opacity, 200 ms, `ease-out`.
- No transform on hover. No image zoom, no lift, no parallax, no autoplay, no
  carousel that moves by itself.
- The global rule in `globals.css` reduces every animation and transition to
  nothing under `prefers-reduced-motion: reduce`. Do not add motion that
  bypasses it (no JavaScript-driven animation without the same check).

## Components

Each component lists its anatomy, tokens, states, phone behaviour, and what it
must never do. "Phone" means below `md` (768 px).

### Buttons

`Button` and `ButtonLink` in `primitives.tsx`. One shape, six variants.

**Shape.** `inline-flex items-center justify-center gap-2 rounded-sm font-medium
transition-colors`. Icon, when present, is 16 px and precedes the label.

| Size | Min height       | Padding       | Type        | Use                                               |
| ---- | ---------------- | ------------- | ----------- | ------------------------------------------------- |
| `sm` | `min-h-9` 36 px  | `px-3 py-1.5` | `text-sm`   | Section actions, toolbar, card control from `md`. |
| `md` | `min-h-11` 44 px | `px-5 py-2.5` | `text-base` | Default.                                          |
| `lg` | `min-h-12` 48 px | `px-6 py-3`   | `text-base` | Hero and order form.                              |

| Variant     | Rest                                                     | Hover                                | Use                                                          |
| ----------- | -------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `primary`   | `bg-pine-900 text-paper`                                 | `bg-pine-700`                        | The main action of a section on a light ground.              |
| `accent`    | `bg-gold-500 text-ink-900 font-semibold`                 | `bg-gold-600`; on pine `bg-gold-300` | The single most important action in a viewport. New variant. |
| `secondary` | `border border-line-strong bg-paper-raised text-ink-900` | `bg-paper-sunken`                    | Alternative actions; the card's quick-order control.         |
| `ghost`     | `text-ink-700`                                           | `bg-paper-sunken text-ink-900`       | Tertiary actions, icon buttons.                              |
| `danger`    | `bg-critical text-paper`                                 | `bg-critical` at 90% opacity         | Destructive admin actions only.                              |
| `on-pine`   | `border border-pine-200 text-paper`                      | `bg-pine-700`                        | The secondary action on a `pine-900` band.                   |

`on-pine` is the secondary action on `pine-900`, as a named variant rather than
something `secondary` turns into inside `.on-pine`: a white card can sit on a
pine band, and its secondary button must stay dark on white.

**States.**

- _Focus:_ the global ring — 2 px `pine-700`, 2 px offset. Inside `.on-pine` it
  is `gold-300`. Never removed.
- _Active:_ same as hover. No scale.
- _Disabled:_ `bg-paper-sunken text-ink-500 cursor-not-allowed` (6.24:1), with
  its edge an inset ring in `line` rather than a border, so a button that goes
  disabled while its form submits keeps its exact width. Not opacity. Prefer not rendering a control that
  can never be used.
- _Pending:_ the label changes to "Изпраща се…", `aria-busy="true"`, the button
  is disabled and keeps its width (`min-w-40` on the order button).

**Phone.** A lone primary or accent action is `w-full`. Two actions stack, the
main one first.

**Never.** Two `accent` buttons in one viewport. An `accent` button on `paper`
or `paper-sunken`. A button without a text label, unless it has `aria-label`
and is at least 40 by 40 px. A `<div>` or `<span>` acting as a button. A link
styled as a button that performs an action, or the reverse.

### Inputs

**Anatomy.** Label above, field, then helper or error text below.

- _Label:_ `mb-1 block text-sm font-medium text-ink-900`. A required field adds
  `<span aria-hidden class="text-critical"> *</span>` and the field carries
  `required`.
- _Field:_ `min-h-12 w-full rounded-sm border border-line-strong bg-paper-raised
px-3 text-input text-ink-900 placeholder:text-ink-300`. A secondary field
  inside a disclosure may be `min-h-11`. `textarea` adds `py-2`.
- _Helper:_ `mt-1 text-xs text-ink-500`.
- _Select:_ the native element with the same classes. No custom listbox.
- _Checkbox as a link_ (filters): an 18 px box, `rounded-xs border
border-line-strong bg-paper-raised`; checked `border-pine-900 bg-pine-900
text-paper` with a 2.5 px check mark.

**States.**

- _Hover:_ `border-ink-500`.
- _Focus:_ `border-pine-700` and the global focus ring. `outline-none` is not
  used on a field.
- _Invalid:_ `aria-invalid="true"`, `border-critical`, and beneath it
  `<p id="…-error" class="mt-1 text-sm text-critical">` tied by
  `aria-describedby`. The message says what to do: "Въведете телефонен номер с
  поне 9 цифри."
- _Disabled:_ `bg-paper-sunken text-ink-500`.

**Phone.** Fields are full width and stack. `type`, `inputMode` and
`autoComplete` are always set (`tel`, `email`, `name`).

**Never.** A placeholder used as the label. An error shown by colour alone. A
field below 16 px text. Validation that exists only in the browser.

### Chips

Three kinds. All: `inline-flex items-center gap-1.5 rounded-sm border text-sm`,
`min-h-9` (36 px), `px-3`.

| Kind          | Rest                                                                         | Hover                         | Selected                                                        |
| ------------- | ---------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- |
| Choice        | `border-line bg-paper-raised text-ink-900 font-medium`                       | `border-pine-500`             | `border-pine-900 bg-pine-900 text-paper`, `aria-current="page"` |
| Active filter | `border-line-strong bg-paper-raised text-ink-700`                            | `border-ink-900 text-ink-900` | —                                                               |
| Answer        | as active filter, with a `label` prefix in `text-2xs uppercase text-ink-500` | same                          | —                                                               |

- A choice chip is a link to another listing: a system under "Капсули", a brand
  on the home page. A count follows the label as `text-2xs tabular-nums
text-ink-300` (`text-pine-200` when selected).
- An active-filter chip is a link that removes one filter. It ends in a 12 px
  "×" icon and `<span class="sr-only">— премахни филтъра</span>`.
- An answer chip (wizard) links back to the question that set it and ends in
  `<span class="sr-only">— промяна на отговора</span>`.

**Phone.** Chips wrap. A row of choice chips longer than two lines becomes a
single scrolling row (`overflow-x-auto`, `snap-x`), with the selected chip
scrolled into view by being first in source order.

**Never.** A hover that turns a chip red: removing a filter is not destructive.
A chip that is not a link or a button. A system chip without the system's name.

### Badges

`Badge` in `primitives.tsx`. `inline-flex items-center rounded-xs px-1.5
min-h-5 text-2xs font-semibold tracking-[0.06em] uppercase`. Not interactive.

| Tone        | Classes                         | Ratio | Use                                              |
| ----------- | ------------------------------- | ----- | ------------------------------------------------ |
| `neutral`   | `bg-paper-sunken text-ink-700`  | 9.24  | Pack size, "Изчерпан", "Попитайте ни".           |
| `positive`  | `bg-pine-100 text-pine-900`     | 12.71 | "В наличност".                                   |
| `caution`   | `bg-caution-100 text-caution`   | 6.24  | "По поръчка".                                    |
| `critical`  | `bg-critical-100 text-critical` | 5.59  | Admin only.                                      |
| `reduction` | `bg-clay-600 text-paper-raised` | 7.26  | "−15%". The existing tone name `accent` is this. |

A **reason** (wizard) is a phrase, not a label: same shape, `bg-pine-100
text-pine-900`, sentence case, `font-medium`, no letter-spacing, `text-xs`.

Availability, one mapping everywhere:

| Value          | Text         | Tone       | On a card                     |
| -------------- | ------------ | ---------- | ----------------------------- |
| `in_stock`     | В наличност  | `positive` | Not shown — it is the norm.   |
| `preorder`     | По поръчка   | `caution`  | Shown, top right of the well. |
| `out_of_stock` | Изчерпан     | `neutral`  | Shown, top right of the well. |
| `unknown`      | Попитайте ни | `neutral`  | Shown, top right of the well. |

**Never.** A badge for a claim the data does not hold ("Ново", "Топ",
"Препоръчано", "Био"). More than two badges over one packshot. A badge as the
only carrier of a fact a screen reader needs — it is real text, so it is read.

### System badge

Names the brewing system a product belongs to. The most important label in the
shop: it answers "does this go in my machine?"

**Anatomy.** `<span data-system={id}>`: a 6 px square swatch, then the system's
name.

```
[■ Dolce Gusto]
```

- _Container:_ `inline-flex max-w-full items-center gap-1.5 rounded-xs
bg-(--system-wash) px-1.5 text-(--system)`.
- _Swatch:_ `h-1.5 w-1.5 shrink-0 bg-(--system)`, `aria-hidden`.
- _Name:_ `truncate font-semibold`, the system's `name` from
  `BREWING_SYSTEMS`, in its own capitalisation. Never uppercased.

| Size | Min height | Type       | Where                                        |
| ---- | ---------- | ---------- | -------------------------------------------- |
| `sm` | 20 px      | `text-2xs` | Product card, typeahead row, recommendation. |
| `md` | 24 px      | `text-xs`  | Product page, facts table, listing header.   |

**States.** Static on a card (the card is already one link). On the product
page it is a link to the system's listing: hover adds `underline`, focus shows
the global ring.

**Data.** The system is resolved from the product's categories through
`BREWING_SYSTEMS` (`categorySlugs` and `categorySourceKeys`). A product that
resolves to no system shows no badge; the row keeps its height on a card.

**Phone.** Same. It truncates with an ellipsis before it wraps.

**Never.** The swatch or the colour without the name. A system owner's logo,
logotype or trade dress. The word "оригинални". A system badge on a product
whose system was guessed from its name.

### Intensity scale

The source states intensity on five scales — out of 5, 9, 10, 12 and 13 —
depending on the brand. `parseIntensity()` in `lib/catalog/attributes.ts`
returns `{ value, max, fraction }`.

**The rule the component exists for:** a customer must never be able to read
"8" on two cards and conclude they are equally strong. So the component always
shows the scale's own maximum, twice — once as a count of segments and once as
text.

**Anatomy.** A segmented track and a numeral.

```
▮▮▮▮▮▮▮▮▯▯▯▯  8 от 12          ▮▮▮▮▮▮▮▮▯▯  8 от 10
```

- _Track:_ a flex row of exactly `max` segments, `gap-px`, each `flex-1 h-1.5`.
  The first `value` segments are `bg-pine-700`; the rest are `bg-line`. First
  and last segment carry `rounded-xs` on their outer corners. `aria-hidden`.
- _Track width is fixed_ per size, whatever the scale: 64 px on a card, 120 px
  on the product page. The filled length is therefore `value / max` of the same
  width on every product — the fraction is what is comparable, and the fraction
  is what the eye reads — while the number of segments shows which scale the
  brand used.
- _Numeral:_ `text-2xs tabular-nums text-ink-500` (card), `text-sm text-ink-900`
  (product page): "8 от 12". Always both numbers, always "от".
- _Accessible text:_ `<span class="sr-only">Интензивност </span>` before the
  numeral, so it reads "Интензивност 8 от 12".

**Variants.**

- _Card:_ track 64 px, then the numeral, on one line, 16 px high.
- _Product page (facts table row "Интензивност"):_ the band word when the data
  has `strength` ("Слабо", "Средно", "Силно"), then the track at 120 px, then
  the numeral: `Силно  ▮▮▮▮▮▮▮▮▮▮▯▯  10 от 12`.

**States.**

- _No intensity in the data_ (true of about a fifth of the catalog): the
  component renders nothing. On a card the row keeps its 16 px height.
- _A value that does not parse:_ the raw text only, no track.
- _`value` greater than `max`:_ treated as unparsed.

**Filtering and sorting** use the band (`strength`: weak, medium, strong), never
the numeral.

**Phone.** Same sizes.

**Never.** The numeral without its maximum ("Интензивност 8"). A percentage, a
rescaled figure ("6,7 / 10") or stars. A track whose segment count is anything
other than the product's own `max`. A track whose width varies with the scale,
so that a 13-step track looks longer than a 5-step one. Colour that changes
with strength (no green-to-red). Sorting a listing by the raw numeral.

### Product card

`components/catalog/product-card.tsx`. The unit the whole catalog is built
from. Two engineers building it from this section must produce the same card.

**Anatomy,** top to bottom:

```
┌──────────────────────────┐
│ [−15%]          [Изчерпан]│  1  packshot well, 1:1
│                          │
│        packshot          │
│                          │
├──────────────────────────┤
│ [■ Dolce Gusto]          │  2  system badge        20 px
│ BIANCHI · 16 бр.         │  3  brand · pack        16 px
│ Капсули DG Bianchi Gusto │  4  name, up to 3 lines 60 px
│ Forte Espresso 16 бр.    │
│                          │
│ ▮▮▮▮▮▮▮▮▮▮▯▯ 10 от 12    │  5  intensity           16 px
│ 5,60 €  ~~6,60 €~~       │  6  price               26 px
│ 0,35 € на чаша           │  7  price per cup       18 px
│ [    Бърза поръчка     ] │  8  quick order         40 px
└──────────────────────────┘
```

**Container.** `<article class="group relative flex h-full flex-col
overflow-hidden rounded-md border border-line bg-paper-raised
transition-colors">`.

1. **Packshot well.** `relative aspect-square border-b border-line bg-well`.
   - Image: `next/image` with `fill`, `object-contain`, no padding (the
     photographs carry their own margin), `sizes={IMAGE_SIZES.card}`.
     `priority` for the first row of a page (4 cards) and `loading="lazy"` for
     the rest. `alt` is the image's stored alt text, else the product name.
   - No photo: the image placeholder (below) fills the well.
   - Top left, `absolute top-2 left-2`: the reduction badge, only when
     `discountPercent` and `oldPrice` are both present.
   - Top right, `absolute top-2 right-2`: the availability badge, only when
     availability is not `in_stock`.
2. **Body.** `flex flex-1 flex-col p-3 md:p-4`. Rows 2 to 5 are separated by
   `mt-1.5`.
3. **System badge**, size `sm`. Row height 20 px, kept when there is no badge.
4. **Brand line.** `flex items-center gap-1.5 text-2xs font-semibold
tracking-[0.06em] uppercase text-ink-500`: brand name (`truncate`), a
   `aria-hidden` "·", then the pack size in `shrink-0 font-normal normal-case
tracking-normal`. Either part may be absent; the row keeps 16 px.
5. **Name.** `<h3 class="line-clamp-3 min-h-[3.75rem] text-sm font-medium
text-ink-900">` containing the one link of the card: `<a
href="/products/{slug}" class="after:absolute after:inset-0">`. The stretched
   link makes the whole card the target.
6. **Intensity scale**, card variant. Row height 16 px, kept when absent.
7. **Price block.** `mt-auto pt-3` — pushed to the bottom so prices align
   across a row.
   - Price row, `flex flex-wrap items-baseline gap-x-2`: price in `text-lg
font-semibold tabular-nums text-ink-900`.
   - Reduced: the price is `text-clay-600`, preceded by `<span
class="sr-only">Намалена цена </span>`; the old price follows in `text-sm
tabular-nums text-ink-300 line-through`, preceded by `<span
class="sr-only">Стара цена </span>`.
   - No price: `<span class="text-sm text-ink-500">Цена при запитване</span>`.
     Never "0,00 €".
   - Price per cup, directly under: `text-xs font-medium tabular-nums
text-pine-700`, the string from `toPerServingView()` — "0,35 € на чаша", or
     "≈ 0,12 € на чаша" when estimated from weight. Row height 18 px, kept when
     absent.
8. **Quick-order control.** `mt-3`. A `secondary` button, `w-full`, `min-h-10`
   (40 px), `text-sm`, `relative z-10` so it sits above the stretched link.
   Label "Бърза поръчка" plus `<span class="sr-only">: {name}</span>`.
   - It is `<a href="/products/{slug}#order">`. With JavaScript it opens the
     order form in a dialog; without, it goes to the form on the product page.
   - `out_of_stock`: the control is replaced by a `secondary` link "Виж
     продукта" of the same size, so heights still match.

**States.**

- _Rest:_ `border-line`, no shadow.
- _Hover and focus-within:_ `border-line-strong shadow-raise`. The name gains
  `underline underline-offset-2`. The image does not move.
- _Focus:_ the ring is drawn on the name link and, separately, on the
  quick-order control. Two tab stops per card, in that order.
- _Loading:_ see "Loading" — a skeleton with the same boxes.

**Equal heights.** Every row above has a fixed or minimum height and the price
block is pinned with `mt-auto`, so all cards in a grid row are the same height
and their prices and buttons line up, whatever is missing.

**Phone.** Two columns from 320 px up. At 390 px a card is about 173 px wide;
the body has 12 px padding. Nothing is hidden on a phone: system, intensity and
price per cup are the reasons to shop here. The name clamps at three lines.

**Data the card needs** beyond today's `ProductCardView`: the resolved system
id, the parsed intensity, and `pricePerServing` with `servingsEstimated`.

**Never.** A description paragraph. More than one price per cup. A star, a
rating, a "bestseller" ribbon. A second link to the same product. A gold
button — twenty-four gold buttons are not an accent. A tinted or padded well. A
hover zoom. A card whose height depends on which optional rows it has.

### Image placeholder

For a product with no photograph, or whose image URL is not on our own host.

**Anatomy.** Fills the well it replaces, same aspect ratio: `flex flex-col
items-center justify-center gap-2 bg-paper-sunken`.

- A line drawing of a coffee pack, 40% of the well's width, stroke 1.5 px in
  `line-strong`, inline SVG or `/placeholder-product.svg`, `aria-hidden`.
- Beneath it: `<span class="text-2xs text-ink-500">Няма снимка</span>`. Omitted
  where the well is under 96 px wide (typeahead, thumbnails).

`alt=""` — the product name is already the card's heading. It is served from
our own origin with explicit dimensions and is never `priority`.

**Never.** Another product's photograph. A brand logo standing in for a
product. A stock photograph of coffee. A broken-image icon. A blank white box,
which reads as a photograph that failed to load.

### Announcement bar

One sentence about delivery or ordering, above the header on every storefront
page. It replaces the header's utility strip.

**Anatomy.** `<aside aria-label="Доставка и поръчка" class="on-pine bg-pine-900
text-paper">` (`components/commerce/announcement-bar.tsx`) containing a shell
row: `flex min-h-9 items-center justify-center gap-x-6 py-1.5 text-xs`,
`md:justify-between`.

- _Message_: `<p class="font-medium">`, the free-delivery sentence the product
  page also prints. The figure in it is wrapped in
  `<strong class="font-semibold text-gold-300">`: "Безплатна доставка за поръчки
  над **49 €**".
- _Contact_ (`md` and up): opening hours in `text-pine-200`, then the phone
  number as `<a href="tel:…" class="font-medium underline-offset-4
hover:underline">`.

**Content** comes from `siteConfig.commerce` and `siteConfig.contact`. One
message. **With no free-delivery threshold configured the bar is not rendered
at all** — absent, not empty, because the bar exists to carry that promise — and
the masthead then shows the phone number on every width instead.

**States.** Static. Not dismissible, not sticky (it scrolls away; the masthead
stays). Links show the `gold-300` focus ring.

**Phone.** The message only, centred, wrapping to at most two lines. The phone
number is in the masthead ("Обадете се").

**Never.** A close button — it would move the page and need state to remember.
Rotating or scrolling messages. A countdown. Emoji. A gold or clay bar: the bar
is pine, and gold marks one figure inside it. A promise configuration does not
hold.

### Header navigation

`components/layout/site-header.tsx`. Sticky (`sticky top-0 z-40`), `bg-paper`
at 95% with backdrop blur, `border-b border-line`. Two rows inside the shell.

**Row 1 — masthead.** `flex flex-wrap items-center gap-x-4 gap-y-2 py-2
md:gap-y-3 md:py-4`. The phone's spacing is tighter than the desktop's because
of the 116 px ceiling below: two 44 px rows with 8 px above, between and below
them, plus the border, come to 113 px. (`gap-y-3 py-3` on every width, as this
section first said, comes to 125 px on a phone and could not meet it.)

- Menu button (phone only), wordmark (links home, `aria-label="{name} —
начало"`), then the search field taking the remaining width on `md` and up
  (`max-w-md`, pushed right) and its own full-width second line on a phone.
- Phone only, right of the wordmark: `<a href="tel:…">Обадете се</a>` in
  `text-sm font-medium text-pine-700`.

**Row 2 — the rail** (`md` and up). `<nav aria-label="Основна навигация">`, one
`ul`, `flex items-center gap-x-6`. Organised by what the customer owns.

| #   | Label                           | Target                  | Notes                                                    |
| --- | ------------------------------- | ----------------------- | -------------------------------------------------------- |
| 1   | Капсули ▾                       | `/categories/kapsuli`   | Opens the systems panel.                                 |
| 2   | Дози ESE                        | `/categories/kafe-dozi` |                                                          |
| 3   | Кафе на зърна                   | beans category          |                                                          |
| 4   | Намери по машина                | `/wizard/machines`      | First-class, with a 16 px machine icon before the label. |
| 5   | Вендинг зона                    | its page                | Shown once the page exists.                              |
| —   | _(pushed right with `ml-auto`)_ |                         |                                                          |
| 6   | Кое кафе е за вас               | `/wizard`               |                                                          |
| 7   | Марки                           | `/brands`               |                                                          |
| 8   | Промоции                        | `/promotions`           | `text-clay-600`. Shown only when a promotion exists.     |

Categories and systems with no products are not listed. Slugs come from
`BREWING_SYSTEMS` and the category tree, never typed into the header.

- _Rail link:_ `inline-flex items-center gap-1.5 border-b-2 border-transparent
py-3 text-sm font-medium text-ink-700`.
- _Hover:_ `border-pine-500 text-ink-900`.
- _Current section:_ `border-pine-900 text-ink-900`, `aria-current="page"` (or
  `"true"` on an ancestor).

**The systems panel** (under "Капсули"). Opens on hover and on `focus-within`,
with CSS alone, so it works without JavaScript; the parent label is itself a
link, so a touch on a tablet navigates. `absolute left-0 top-full z-50 w-[34rem]
rounded-md border border-line bg-paper-raised p-2 shadow-float`, two columns:

- _Left, the systems:_ a heading in the Label style, "Капсули по система", then
  one row per capsule system that has products. Row: `flex min-h-11 items-center
gap-2.5 rounded-sm px-3 text-sm text-ink-900 hover:bg-paper-sunken`, carrying
  `data-system`: an 8 px `bg-(--system)` square (`aria-hidden`), the system
  name, and the product count right-aligned in the Count style. Last row: "Всички
  капсули" in `font-medium text-pine-700`.
- _Right, the way out for someone who does not know their system:_ a
  `bg-pine-100 rounded-sm p-4` block — title "Не знаете коя е вашата система?"
  (`text-sm font-semibold text-pine-900`), one line "Намерете машината си по
  марка и модел и ще ви кажем какво пасва." (`text-sm text-ink-700`), and a link
  "Намери по машина →" (`text-sm font-medium text-pine-700 underline`).

**Search field.** Existing behaviour stays: a real `GET` form to `/search`,
typeahead layered on top. Field per "Inputs" at `min-h-11`; the submit is a
`primary` button attached to its right edge. A typeahead product row shows a
40 px well, the name, the system badge (`sm`) and the price.

**Phone.** Row 2 is hidden; the menu button opens the drawer. The sticky header
is two lines — masthead and search — and must not exceed 116 px.

**Never.** Brand ahead of system in the rail. A rail that wraps to two lines at
1024 px — if it does, "Вендинг зона" moves into the drawer and footer first. A
panel that opens only on hover. A second, hidden copy of the search field. Pill
buttons or icons-in-circles for categories.

### Mobile drawer

`components/layout/mobile-nav.tsx`. The same structure as the rail, in the same
order, with nothing left out.

**Trigger.** In the masthead, left of the wordmark: a 44 by 44 px `ghost` icon
button, `aria-label="Меню"`, `aria-expanded`, `aria-controls`. Rendered as `<a
href="/categories">` so that without JavaScript it leads to a page with the
same structure.

**Panel.** `role="dialog" aria-modal="true" aria-label="Меню на сайта"`, fixed,
left edge, `w-[86%] max-w-sm`, full height, `bg-paper`, `shadow-float`, over a
`bg-ink-900/40` scrim. It scrolls internally; the page behind does not.

Contents, top to bottom:

1. **Head.** The wordmark and a 44 px close button (`aria-label="Затвори
менюто"`), `border-b border-line`.
2. **Two entry points,** as full-width rows with a border, `min-h-14`:
   "Намери по машина" (icon, then label, then one line of `text-xs
text-ink-500`: "По марка и модел") and "Кое кафе е за вас" ("Няколко въпроса,
   три предложения").
3. **"Капсули по система"** — a Label-style heading, then one row per system,
   always expanded (no accordion): 8 px system square, name, count. Then
   "Всички капсули".
4. **Дози ESE, Кафе на зърна, Вендинг зона** — plain rows.
5. A hairline, then **Марки, Промоции** (clay, only when one exists),
   **Дневник, Контакти**.
6. **Foot,** `border-t border-line bg-paper-sunken p-4`: the phone number as a
   `tel:` link in `text-base font-medium text-pine-700`, and the opening hours
   in `text-sm text-ink-500`.

Row: `flex min-h-12 items-center gap-2.5 rounded-sm px-3 text-base text-ink-900
hover:bg-paper-sunken`. The current page's row is `bg-pine-100 font-medium
text-pine-900` with `aria-current="page"`.

**Behaviour.** Focus moves to the close button on open, is trapped inside, and
returns to the trigger on close. Escape, the scrim and any navigation close it.
Slides in over 200 ms.

**Never.** A drawer whose order differs from the rail. Systems hidden behind a
second tap. A full-screen takeover that hides the page entirely. Search inside
the drawer — it is already in the header.

### Home page

`app/(site)/page.tsx`. Sections in this order. Every section is driven by data
and is omitted entirely when it has nothing to show; no section renders an
empty shell or a placeholder message.

| #   | Section            | Ground         | What it is for                                                             |
| --- | ------------------ | -------------- | -------------------------------------------------------------------------- |
| 1   | Hero               | `pine-900`     | Say what the shop is and start the customer from their machine.            |
| 2   | Delivery promise   | `paper`        | Answer "what does delivery cost and how do I pay" before anything else.    |
| 3   | Shop by system     | `paper`        | The main way into the catalog.                                             |
| 4   | Wizard entry       | `paper-sunken` | Catch the customer who does not know their system or what they like.       |
| 5   | Promotions         | `clay-100`     | Reduced products. Only when there are any.                                 |
| 6   | New arrivals       | `paper`        | Show the shelf: real packs, real prices.                                   |
| 7   | How ordering works | `paper`        | Explain that there is no cart, in three steps.                             |
| 8   | Brands             | `paper`        | A route in for the customer who shops by brand.                            |
| 9   | Journal            | `paper-sunken` | Latest articles. Only when there are any.                                  |
| 10  | Vending Zone       | `pine-900`     | Send the business buyer to the page written for them. Only when it exists. |

**1. Hero.** `<section class="on-pine bg-pine-900 text-paper">`, shell, `grid
gap-8 py-10 md:grid-cols-12 md:items-center md:py-16`.

- _Text, `md:col-span-6`:_
  - Eyebrow, Label style in `text-gold-300`: "{brands} марки · {products}
    продукта", both counted from the database.
  - `h1`, Hero title: the shop's tagline.
  - Lead in `text-pine-200`, max 48ch: one sentence on what is sold and how
    ordering works.
  - Actions, `mt-6 flex flex-wrap gap-3`: an `accent` button, size `lg`,
    "Намерете кафе за вашата машина" → `/wizard`; then the on-pine secondary
    button, "Разгледайте по система" → the tiles (`#systems`).
  - Under them, `mt-4 text-sm text-pine-200`: "Не знаете каква система е
    машината ви? " and a `text-gold-300 underline` link "Намерете я по марка и
    модел" → `/wizard/machines`.
- _Shelf, `md:col-span-6`:_ six real packshots in a `grid grid-cols-3 gap-3`.
  Each is a link to its product: a `aspect-square rounded-md bg-well` well with
  the image `object-contain`, `alt` the product name. Selection is
  deterministic and from data — the newest product with a photograph in each
  system, in `BREWING_SYSTEMS` order, the first six — never a hand-typed list.
  The first image is `priority`; `sizes="(min-width: 768px) 16vw, 30vw"`.
  Fewer than three products with photographs: the shelf is omitted and the text
  spans the row.
- _Phone:_ text first, then the first three wells in one row; the other three
  are not rendered. Buttons are full width and stacked.

**2. Delivery promise.** A `border-b border-line` strip, `py-5`. Up to four
facts in a `grid grid-cols-2 gap-4 md:grid-cols-4`: delivery (fee and
free-delivery threshold), delivery time, payment methods, and "Потвърждаваме по
телефона". Each: a 20 px icon in `text-pine-700`, a title in `text-sm
font-semibold text-ink-900`, one line in `text-xs text-ink-500`. Each fact
comes from `siteConfig.commerce` and is omitted when unset. Fewer than two
facts: the strip is omitted.

**3. Shop by system.** `id="systems"`. `SectionHeading`: "Изберете по машината
си", description "Всяка система приема само своите капсули." Then the tile
grid: one tile per system with products, in `BREWING_SYSTEMS` order, and a last
tile that is the machine finder.

- _System tile:_ `<a data-system={id} class="group flex h-full flex-col
rounded-md border border-line border-t-4 border-t-(--system)
bg-(--system-wash) p-4 transition-colors hover:border-(--system)">`.
  - Name: Panel title, `text-ink-900`.
  - `summary` from `BREWING_SYSTEMS`: `mt-1 line-clamp-2 text-sm text-ink-700`.
  - Foot, `mt-auto pt-4 flex items-center justify-between`: "{n} продукта" in
    `text-xs font-semibold tabular-nums text-(--system)`, and "→"
    (`aria-hidden`).
- _Finder tile:_ `bg-pine-900 text-paper` (inside `.on-pine`), same shape,
  title "Не знаете системата?", line "Намерете машината си по марка и модел."
  in `text-pine-200`, foot "Намери по машина →" in `text-gold-300`. Always
  shown, always last.
- _Phone:_ two columns; the summary clamps to two lines.

**4. Wizard entry.** A band, `bg-paper-sunken`. Inside the shell, one
`bg-gold-100 rounded-md p-6 md:p-8` panel, `md:grid md:grid-cols-2 md:gap-10`.
Left: Section title "Кое кафе е за вас?", a paragraph ("Няколко въпроса и три
предложения — с причините за всяко."), and a `primary` button "Започнете" →
`/wizard`. Right: the wizard's step labels (`STEP_LABELS`) as a numbered list,
each numeral in a 24 px `bg-gold-500 text-ink-900 rounded-xs` square. On a
phone the list is hidden.

**5. Promotions.** `bg-clay-100`, `border-y border-line`. `SectionHeading`
"Намалени в момента" with a `secondary` `sm` action "Всички промоции". Four
cards (`priorityCount={0}`).

**6. New arrivals.** `SectionHeading` "Ново в асортимента", action "Всичко".
Eight cards; on a phone, four. None is `priority` — the hero holds the LCP
element.

**7. How ordering works.** `SectionHeading` "Поръчката е на една стъпка". Three
steps in `grid gap-4 md:grid-cols-3`, each a `rounded-md border border-line
bg-paper-raised p-5` panel: a 28 px `bg-gold-500 text-ink-900 rounded-xs`
numeral, then one sentence in `text-base text-ink-900`. Under the grid, in
`text-sm text-ink-500`: "Без регистрация и без количка. Предпочитате да
говорим?" and the phone number as a `text-pine-700 underline` link.

**8. Brands.** `SectionHeading` "Марките, които предлагаме", action "Всички
марки". Choice chips, one per brand with products, each with its count. A logo
replaces the text only when a file we are permitted to use exists.

**9. Journal.** Up to three article cards: title (Panel title), date (Meta),
one-line summary. No image unless the article has its own.

**10. Vending Zone.** `on-pine bg-pine-900 text-paper`, one row: Section title,
one sentence in `text-pine-200`, the on-pine secondary button. No `accent`
button here; the hero has the page's gold.

**Never.** A carousel or slider. A hero photograph of beans, cups or people. A
"featured" or "bestseller" row chosen by hand. Review or trust-badge strips. A
section that shows a heading over nothing. A second gold button below the hero
within the same viewport as the first.

### Listing page

Category, brand, promotions and search share `CatalogListing`.

**Page head,** inside the shell:

1. Breadcrumbs.
2. `h1`, Page title. On a system's listing the system badge (`md`) sits above
   it.
3. Introduction: the category's own text, `text-base text-ink-700`, max 68ch.
   Omitted when empty.
4. On a system's listing, one line linking to machine pages: "Става за машини
   {system}. " and "Проверете вашата машина" → `/wizard/machines`.
5. On "Капсули": a row of choice chips, one per system with products, each
   carrying `data-system`, an 8 px system square and its count.

**Body.** `lg:grid lg:grid-cols-[240px_1fr] lg:gap-8`.

**Filter rail** (`lg` and up). `sticky top-[header height + 16px]`,
`max-h-[calc(100dvh-…)] overflow-y-auto`. `FilterPanel`:

- Head: "Филтри" in the Label style; when filters are active, a link "Изчисти
  всички (n)" in `text-xs text-pine-700 underline`.
- Groups, in this order, each a `<details open>` with a `summary` in `text-sm
font-semibold text-ink-900` and a chevron that rotates when open:
  1. **Система** — on listings that mix systems (search, brand, promotions,
     "Капсули"). Each option carries `data-system` and shows the 8 px square
     before the name.
  2. **Марка** — hidden on a brand page. Scrolls internally past 8 options
     (`max-h-64 overflow-y-auto`).
  3. **Интензивност** — the three bands: Слабо, Средно, Силно. Never numerals.
  4. **Кофеин** — С кофеин, Без кофеин.
  5. **Ароматизирано.**
- An option is a link (works without JavaScript), `flex min-h-9 items-center
gap-2.5 rounded-sm px-1 text-sm hover:bg-paper-sunken`: the 18 px checkbox,
  the label (`text-ink-700`; `font-medium text-ink-900` when checked), the
  count in the Count style. `aria-pressed` reflects the state.
- An option with no matching products is not rendered. A group with no options
  is not rendered.

**Toolbar,** above the grid: `mb-4 flex flex-wrap items-center justify-between
gap-3`.

- Left: "**{n}** продукта" — the number in `font-medium text-ink-900`, the word
  in `text-sm text-ink-500`; `aria-live="polite"`.
- Right: the "Филтри" button (below `lg`; `secondary`, `min-h-10`, a filter
  icon, and the active count in a `bg-pine-900 text-paper rounded-xs px-1.5
text-2xs` box), then the sort control.
- Sort: a visible label "Подреди:" (`text-sm text-ink-500`, hidden below `sm`
  where it becomes `sr-only`) and a native `select`, `min-h-10`, inside a `GET`
  form with a submit button in `<noscript>`. Options, in order: Най-подходящи;
  Цена на чаша: ниска към висока; Цена: ниска към висока; Цена: висока към
  ниска; Първо най-новите; Име А–Я; Име Я–А.
  When sorted by price per cup, products with no per-cup figure come last.

**Active filters.** Directly under the toolbar: `<ul aria-label="Активни
филтри" class="mb-4 flex flex-wrap items-center gap-2">` of active-filter
chips, in the order of the groups above, ending in a text link "Изчисти
всички". Not rendered when no filter is active. A system chip carries the 8 px
system square.

**Grid.** `ProductGrid`: 2 columns, 3 from `md`. The first four cards are
`priority`.

**Pagination.** The `Pagination` primitive: real links, `rel="prev"` and
`rel="next"`, the current page `bg-pine-900 text-paper` with
`aria-current="page"`. Items are `min-h-10 min-w-10`.

**Indexing.** Filtered, sorted and paginated URLs are `noindex` with the
canonical on the clean first page. New parameters (system, sort by price per
cup) join the same rule.

**Phone.**

- No rail. The baseline is a `<details>` disclosure titled "Филтри" above the
  grid, containing the same `FilterPanel` — this is what works without
  JavaScript.
- With JavaScript the "Филтри" button opens a bottom sheet instead:
  `role="dialog" aria-modal="true"`, `max-h-[85dvh] overflow-y-auto
rounded-t-lg bg-paper p-5 shadow-float`, over the scrim. Head: "Филтри"
  (Panel title) and a 44 px close button. Foot, `sticky bottom-0`: a `primary`
  `lg` full-width button "Покажи {n} продукта". Focus is trapped and returns to
  the trigger; Escape and the scrim close it.
- Toolbar: count on the first line; "Филтри" and the sort select share the
  second line, each half width.
- The grid stays two columns.

**States.**

- _No products match the filters:_ the empty state, title "Няма продукти с тези
  филтри", description "Махнете някой филтър и опитайте пак.", action "Изчисти
  филтрите" (`primary`). The toolbar, chips and rail stay.
- _Empty category:_ title "Тук още няма продукти", action "Кое кафе е за вас" →
  `/wizard`.
- _Search with no results:_ title "Не намерихме „{term}“", description
  "Проверете изписването или опитайте с марка или система.", actions: the
  search field, and "Намери по машина".
- _Loading:_ skeleton grid (see "Loading").

**Never.** Filtering in the browser by hiding nodes. A filter that needs
JavaScript. An intensity filter by numeral. A price slider. Infinite scroll. A
filter option that leads to zero results. A sticky toolbar on a phone — the
header already holds 116 px.

### Product page

`app/(site)/products/[slug]/page.tsx`. Order on the page is the order a
customer decides in: does it fit, what does it cost, how do I get it, then the
details.

**Top,** `grid gap-8 lg:grid-cols-2 lg:gap-12`, under the breadcrumbs.

**Left — gallery** (`lg:sticky lg:top-[header height + 16px] lg:self-start`).

- Main well: `relative aspect-square rounded-md border border-line bg-well`,
  image `object-contain`, `priority` (it is the LCP element),
  `sizes="(min-width: 1024px) 560px, 100vw"`.
- Thumbnails, when there is more than one image: a row of 64 px `rounded-sm
border border-line bg-well` buttons, `gap-2`, under the well. Selected:
  `border-2 border-pine-700`, `aria-current="true"`. Each has `aria-label="Снимка
{i} от {n}"`.
- Phone: the images are a horizontal `snap-x snap-mandatory` scroller of
  full-width wells with a counter "1 / 3" (`text-xs text-ink-500`) beneath. No
  thumbnails.
- No image: the image placeholder in the same well.

**Right — summary,** in this order:

1. System badge, `md`, linking to the system's listing; then the brand as a
   Label-style link in `text-pine-700`.
2. `h1`, Page title.
3. Badge row, `mt-3 flex flex-wrap gap-2`: availability, pack size (`neutral`).
4. For a capsule or pod, the compatibility line, `mt-3 text-sm text-ink-700`:
   "Става за машини {system}. " and a link "Проверете вашата машина" →
   `/wizard/machines`. Wording is "става за" or "съвместими с", never
   "оригинални".
5. Price block, `mt-5`:
   - Price: `text-3xl font-semibold tabular-nums text-ink-900` (Inter).
     Reduced: `text-clay-600`, followed by the old price in `text-lg
tabular-nums text-ink-300 line-through` and the reduction badge; the same
     `sr-only` prefixes as on the card.
   - Directly under, `mt-1 flex flex-wrap gap-x-4 text-sm font-medium
tabular-nums text-pine-700`: the price per cup ("0,35 € на чаша", or
     "≈ …" when estimated) and, for goods sold by weight, the unit price
     ("39,80 € / кг").
   - No price: "Цена при запитване — обадете ни се и ще ви я кажем." in
     `text-lg text-ink-500`.
6. Short description, `mt-4 text-base text-ink-700`, max 60ch. Omitted when
   empty.
7. **Order panel,** `mt-6`, `id="order"` (below).

**Order panel.** One `rounded-md border border-line bg-paper-raised` panel
holding the order form and, beside it, the delivery-and-payment block.

- From `sm` up: `grid grid-cols-[1fr_13rem]`; the form in the first column
  (`p-5`), the block in the second (`border-l border-line bg-paper-sunken p-5`,
  right corners rounded).
- _Order form_ (`QuickOrderForm`): title "Поръчка на една стъпка" (Panel
  title); one sentence, `text-sm text-ink-500`; the phone field (label
  "Телефонен номер", required, `type="tel"`); the submit — the page's one
  `accent` button, size `lg`, full width, "Поискай обаждане"; a `<details>`
  "Добавете име, количество или бележка (по избор)"; the result line
  (`aria-live="polite"`); the privacy sentence in `text-xs text-ink-500`.
- _Delivery-and-payment block:_ a `dl`, `space-y-3 text-sm`. Rows, each with a
  16 px icon in `text-pine-700`, a `dt` in `font-semibold text-ink-900` and a
  `dd` in `text-ink-700`: **Доставка** (fee and free-delivery threshold),
  **Срок**, **Плащане**, **Връщане**. Values come from `siteConfig.commerce`; a
  row with no value is omitted; if none has a value the block is omitted and
  the form takes the full width. Ends with a link "Доставка и плащане" →
  its page, `text-sm text-pine-700 underline`.
- _Success:_ the form is replaced by a `role="status"` panel, `bg-pine-100
border border-pine-500 rounded-md p-5`: title "Заявката е получена" (Panel
  title, `text-pine-900`), the server's message in `text-sm text-ink-700`. The
  delivery block stays.
- _Error:_ the field error under the field; a form-level error in the result
  line as `text-sm text-critical`.
- _Out of stock:_ the submit is replaced by a `caution` notice "В момента е
  изчерпан. Обадете ни се и ще ви кажем кога ще го има." with the phone number.
- _Product no longer sold:_ the whole panel is replaced by a `caution-100`
  notice: title "Този продукт вече не се предлага", one sentence, a `primary`
  button to the category and the phone number. The page keeps its URL and is
  `noindex`.

**Below the top grid,** each a section with `mt-12 md:mt-16`:

**Facts table.** `h2` "Характеристики". A `dl` in a `rounded-md border
border-line bg-paper-raised` panel; each row `grid grid-cols-[40%_1fr] gap-4
px-4 py-3 text-sm`, rows divided by `border-t border-line`. `dt` in
`text-ink-500`; `dd` in `font-medium text-ink-900`, left-aligned. From `lg` the
panel is `max-w-2xl`.

Rows, in this fixed order; a row whose value the record does not hold is
omitted — no dash, no "—", no "няма данни":

| Row              | Value                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Система          | The system badge (`md`), linked.                                                                                       |
| Интензивност     | The intensity scale, product-page variant.                                                                             |
| Състав           | "{n}% арабика, {m}% робуста" — only from `arabica_percent`.                                                            |
| Произход         | `origin`.                                                                                                              |
| Изпичане         | `roast`.                                                                                                               |
| Кофеин           | "С кофеин" or "Без кофеин".                                                                                            |
| Ароматизирано    | "Да" or "Не".                                                                                                          |
| Опаковка         | Weight or piece count: "1 кг", "16 бр.".                                                                               |
| Цена на чаша     | As above. When estimated, a second line in `text-xs text-ink-500`: "Изчислено при {GRAMS_PER_SERVING} г кафе на чаша." |
| Цена за килограм | The unit price, for goods sold by weight.                                                                              |
| Код              | The product code.                                                                                                      |
| Категория        | Linked category names.                                                                                                 |

**Compatibility** (capsules and pods). `h2` "Става за тези машини". The
system's `recognise` sentence in `text-base text-ink-700`, then up to twelve
machine models from the machine database as choice chips linking to their
machine pages, then "Всички машини {system}" → the system's machine list.
Where a model is `crossFormat`, the page says so in one sentence.

**Description.** `h2` "За това кафе", then `.rich-text`, max 68ch.

**Related.** `SectionHeading` "Може да ви хареса и" — four cards from the same
system. Never a product from an incompatible system.

**Phone.** One column: gallery, then the summary. Inside the order panel the
delivery-and-payment block comes **first** (`border-b`, not `border-l`), above
the phone field, so delivery cost and payment are read before the form and
without scrolling past it. The facts table keeps two columns at 40% / 60%.

**Never.** A quantity stepper with "Add to cart". A sticky buy bar. Tabs that
hide the facts. A fact row filled with a guess. A rating. Related products from
another system. A second `accent` button.

### Wizard

`app/(site)/wizard/**`, `components/wizard/**`. Every control is a link; the
answers live in the URL. The page content sits in a `max-w-2xl` column.

- _Progress:_ an ordered list in the Label style. Done steps `text-ink-500`,
  the current step `font-semibold text-pine-900` with `aria-current="step"`,
  later steps `text-ink-300`.
- _Question:_ `h1`, Page title; a lead in `text-base text-ink-500`.
- _Option:_ a link, `flex min-h-16 items-baseline justify-between gap-4
rounded-md border border-line bg-paper-raised p-4`. Label: Panel title.
  Detail: `mt-1 text-sm text-ink-500`. Hover: `border-pine-500
bg-paper-sunken`. Selected: `border-pine-500 bg-pine-100`. An option that
  names a system carries `data-system` and shows the system badge above its
  label.
- _Answers so far:_ answer chips.
- _Notice:_ `rounded-md border px-4 py-3 text-sm`. Neutral: `border-line
bg-paper-sunken text-ink-700`. Caution: `border-caution bg-caution-100
text-ink-900` with the title in `font-semibold text-caution`.
- _Recommendation card:_ the product card's content laid out as a row — a 96 px
  well (128 px from `sm`), then rank "№1" (`text-pine-700`), system badge,
  brand line, name, reasons, caveat ("Внимание: …" in `text-sm text-caution`),
  price with price per cup, and a button "Вижте и поръчайте" (`primary` on the
  first card, `secondary` on the others). The first card has `border-pine-500`.

**Never.** A reason the ranking did not use. A caveat in clay. A progress bar
that implies a fixed number of steps when the flow can skip them.

### Footer

`bg-paper-sunken`, `border-t border-line`. Columns: the wordmark with one
sentence and contact details; **Магазин** (the systems, then Дози ESE, Кафе на
зърна, Марки, Промоции); **Помощ** (Намери по машина, Кое кафе е за вас,
Доставка и плащане, Контакти, Дневник); legal links; the newsletter form.
Column heads in the Label style; links `text-sm text-ink-700 hover:text-ink-900
hover:underline`. Under a hairline: the company's legal line and the payment
methods as text, `text-xs text-ink-500`. A notice that legal details are
incomplete is a `caution` notice, not clay.

### Empty state

`EmptyState` in `primitives.tsx`. `flex flex-col items-center rounded-md border
border-dashed border-line-strong bg-paper-raised px-6 py-12 text-center
md:py-16`.

- A 40 px line icon in `text-ink-300`, `aria-hidden`.
- Title: `h2`, Panel title. Says what is true: "Няма продукти с тези филтри".
- Description: `mt-2 max-w-sm text-sm text-ink-500`. Says what to do next.
- One action, `mt-6`; at most two.

**Never.** "Упс", an illustration of a sad cup, an apology without a next step,
an empty state with no way out.

### Loading

A `loading.tsx` per route segment that fetches. Skeletons, not spinners.

- `.skeleton` (from `globals.css`): `paper-sunken`, `rounded-sm`, a 1.6 s opacity
  pulse that stops under reduced motion.
- A skeleton reproduces the boxes of what it replaces, so nothing moves when
  the content arrives:
  - _Product card:_ the card container with a square `.skeleton` well, then
    bars of 20 px × 45%, 16 px × 35%, 20 px × 95%, 20 px × 70%, 26 px × 30%, and
    a 40 px full-width bar.
  - _Listing:_ the real page head, a toolbar bar, eight card skeletons.
  - _Product page:_ a square well, then bars for badge, title (two lines),
    price, and a 220 px panel.
- The region carries `aria-busy="true"` and one `<span class="sr-only"
role="status">Зарежда се…</span>`.
- A submitting form does not get a skeleton; its button goes to the pending
  state.

**Never.** A full-page spinner. A skeleton whose boxes differ in size from the
content. Shimmer gradients sweeping across the page.

### Not found

`app/not-found.tsx`, returned with a real 404 status. Shell, `min-h-[60vh]`,
centred column, `py-16`.

1. "404" — `font-display text-5xl font-semibold text-pine-500`, `aria-hidden`.
2. `h1`, Page title: "Тази страница я няма".
3. `text-base text-ink-500`, max 28rem: "Може адресът да е сгрешен или
   продуктът да е спрян."
4. The search field, `max-w-md`.
5. Actions: `primary` "Към началната страница"; `secondary` "Намери по машина".
6. `text-sm text-ink-500`: "Търсите нещо конкретно? " and a link to contact.

### Error

`app/(site)/error.tsx`. Same layout as not found, without the numeral.

1. `h1`: "Нещо се обърка".
2. "Не е от вас. Опитайте пак след малко или ни се обадете."
3. Actions: `primary` "Опитайте отново" (calls `reset`); `secondary` "Към
   началната страница".
4. The phone number as a `tel:` link.
5. When there is a digest: "Референция: {digest}" in `text-xs text-ink-300`.

**Never.** A stack trace, an error class name or an English message. An error
page with no phone number: the customer came to order, and the phone still
works.

### Focus and skip link

- Every interactive element shows the global ring on `:focus-visible`: 2 px
  `pine-700`, 2 px offset (8.15:1 or better on every paper tone). Inside a
  `.on-pine` container the ring is `gold-300` (8.09:1). Every `pine-900` band
  carries `.on-pine`.
- `outline: none` is not written anywhere without an equal replacement.
- `.skip-link` is the first focusable element and jumps to `main`.
- Focus order follows reading order. A dialog traps focus and returns it.

## Do's and Don'ts

### Do

- **Do** start from the machine: system and machine finder before brand,
  everywhere there is a choice of order.
- **Do** put the system's name on every capsule and pod, in text.
- **Do** show an intensity as "8 от 12", with a track of twelve segments.
- **Do** put the price per cup, or per kilogram, directly under the price.
- **Do** mark a figure derived from weight with "≈".
- **Do** let the packshot sit on pure white, unpadded and unframed.
- **Do** keep one gold control per viewport, on pine or on a white panel.
- **Do** keep clay for a price that went down.
- **Do** reserve the box of anything optional or late, so nothing shifts.
- **Do** write every control as a link or a form first.
- **Do** omit a section, a row or a fact that has no data.
- **Do** set every comparable figure in tabular numerals with its unit.
- **Do** add a row to the contrast table before using a new colour pairing.

### Don't

- **Don't** use gold as text on a paper tone, or the accent button on `paper`
  or `paper-sunken`.
- **Don't** use a system colour without the system's name beside it.
- **Don't** show an intensity numeral without its maximum, rescale it, or sort
  by it.
- **Don't** use clay for cautions, hovers, taglines or decoration.
- **Don't** use `critical` outside a form or a destructive action.
- **Don't** lighten text with opacity. Use the next ink step.
- **Don't** round anything into a pill or a circle.
- **Don't** put a shadow on anything at rest, or a bordered panel inside a
  bordered panel.
- **Don't** zoom, lift or slide anything on hover.
- **Don't** add a carousel, a countdown, a pop-up or a dismissible banner.
- **Don't** use stock or lifestyle photography, a system owner's logo, or
  another product's photograph as a stand-in.
- **Don't** print a rating, a review, a "bestseller" label or any fact about a
  coffee that the record does not hold.
- **Don't** show "0,00 €", "—" or "няма данни" for a missing value. Say "Цена
  при запитване", or omit the row.
- **Don't** set a sentence, a system name or a brand name in uppercase.
- **Don't** set a form field below 16 px, or any text below 11 px.
- **Don't** build a control that needs JavaScript to work.

## Budgets

Measured on a preview deployment, mobile profile (Lighthouse mobile
throttling), median of three runs. Recorded here when measured (task F9).

| Page                     | Metric | Budget      | Measured         |
| ------------------------ | ------ | ----------- | ---------------- |
| Home                     | LCP    | under 2.5 s | not yet measured |
| Home                     | CLS    | under 0.1   | not yet measured |
| Listing (a system)       | LCP    | under 2.5 s | not yet measured |
| Listing (a system)       | CLS    | under 0.1   | not yet measured |
| Product page             | LCP    | under 2.5 s | not yet measured |
| Product page             | CLS    | under 0.1   | not yet measured |
| Every page and component | WCAG   | 2.2 AA      | not yet measured |

What the specification already does to meet them:

- **LCP.** One `priority` image per page: the first hero packshot on the home
  page, the first row of cards on a listing, the main gallery image on a
  product page. Every other image is lazy. Images come from our own host
  through `next/image` with a `sizes` attribute. Two font families, loaded with
  `next/font` and `display: swap`. No client component above the fold except
  the search field and the menu button.
- **CLS.** Every image well has an aspect ratio. Optional card rows keep their
  height. The announcement bar cannot be dismissed. Skeletons match the boxes
  of the content. Buttons keep their width while pending.
- **Accessibility.** The contrast table above; one `h1` and ordered headings;
  labelled fields with tied errors; a visible focus ring on every ground;
  targets of at least 24 by 24 px, 40 px or more for card and toolbar controls
  and 44 px or more for primary actions; no meaning by colour alone; motion off
  under `prefers-reduced-motion`.

## Migration

What existed in the repository and did not meet this document. Until each is
changed, the token values keep it legible. Entries marked **Done** were checked
against the code on 9 October 2026.

- **Done. Clay used for cautions.** `Badge` tone `caution`, `WizardNotice`,
  the recommendation caveat, the removed-product panel, the footer, the
  legal-document notices, the admin markers, the sync page and the journal's
  caution callout use `caution-100` / `caution`; brand taglines use `ink-500`.
  Clay remains only on prices, reduction badges, the promotions band and the
  rail's link to promotions.
- **Done. `Badge` tone `accent`** was `bg-clay-500 text-paper`, 3.10:1. It is
  now `bg-clay-600 text-paper-raised` (7.26:1), the same as tone `reduction`.
- **Done. The home hero** used clay as an accent. It no longer does.
- **Done. Opacity for text** (`text-paper/80`, `text-paper/60`,
  `text-pine-900/80`) no longer appears.
- **Done. Packshot wells** are `bg-well` on the card, the gallery, the hero, the
  search suggestions and the recommendation card.
- **Done. Fields.** The storefront forms, the search field and the admin
  sign-in and reply forms use the shared classes in
  `components/forms/field-styles.ts` or the same treatment: the global focus
  ring and `text-input`.
- **Done. Controls with fixed heights.** Buttons, fields and the search field
  are `min-h-*` with padding.
- **Done. Hex copies of `paper`** — `app/manifest.ts` (`background_color`) and
  `app/opengraph-image.tsx` (`PAPER`) — hold the new `#faf6ee`; the mail
  templates hold no copy of it. `pine-900` is unchanged (`#002c1d`).
