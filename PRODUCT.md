# Product

## What this is

An online coffee shop for Bulgaria, trading as **Buy a Coffee**. It sells coffee
beans, capsules for five mutually incompatible capsule systems, and ESE paper
pods, from about twenty mostly Italian brands — roughly 190 products.

It has one measurable output: **an order request reaching a person**, for a
product that fits the customer's machine. There is no cart and no checkout. The
customer leaves a phone number and is called back.

Success is the number of order requests and how few of them end in "that does
not fit my machine". Traffic, time on page and pages per session are not goals.

Platform: web. Language: Bulgarian; only Bulgarian ships. Currency: euro.

## Who buys, and what each is trying to get done

**1. The capsule-machine owner (primary).** Owns a machine someone bought or
gave them and describes it as "a Krups thing" or "the small Nespresso". Knows
the machine, does not know the system, and has probably bought a box that did
not fit at least once. Job: _get capsules that go in my machine, without
learning what a capsule system is._ What they need from the page: their machine
by name, a yes or no on fit, and a price per cup.

**2. The repeat buyer who knows the system.** Buys Dolce Gusto or A Modo Mio
every few weeks. Job: _reach my system's shelf in one tap and compare what is on
it._ What they need: the system in the navigation, a listing that sorts by price
per cup, and intensity they can read at a glance.

**3. The bean buyer.** Has an automatic machine with a grinder, or a grinder.
Compatibility is not their question; value and strength are. Job: _choose a
kilo that suits how I drink it, and know what a cup costs._ What they need:
price per kilogram beside the pack price, an estimated price per cup marked as
an estimate, composition and origin where the data has them.

**4. The office or small-business buyer.** Stocks a Lavazza Blue machine or a
vending machine for other people. Buys in quantity and wants to talk to someone.
Job: _order enough for the month and get an invoice._ Served by the same
catalog, by quantity on the order form, by the phone number being everywhere,
and by the Vending Zone page. Not addressed with separate pricing or accounts.

**Who the search results bring and the shop cannot serve.** Owners of Nespresso
Vertuo, Tassimo, Iperespresso, K-Cup and similar machines, and people looking
for pre-ground coffee. They are told plainly that nothing here fits, on the
machine page for their model, instead of being walked through a wizard that
runs out of answers.

## Positioning

**Easier to choose from. Not cheaper.** The catalog and the prices mirror
another shop's, so this shop cannot compete on range or on price. It competes
on the customer leaving with the right box.

Four things carry that, and all four exist in code:

- **A recommendation wizard** — a few questions, three suggestions, each with
  the reasons it was chosen.
- **Machine pages** — which capsule fits which machine, from a compatibility
  database written by hand, including the machines nothing here fits.
- **Price per cup beside the pack price.** Pack price reverses the true
  ordering: a hundred capsules at a higher pack price cost less per cup than
  sixteen at a lower one.
- **Search in both alphabets.** Product names mix Cyrillic and Latin, and
  customers type whichever is under their fingers.

Everything in the design serves the same claim: organise the shop by the machine
the customer owns, name the system on every product, and never let two numbers
look comparable when they are not.

## Operating context

- **Market:** Bulgaria only. Every address carries its language (`/bg/…`), and
  an English version is built and switched off until its content is written;
  until then there is nothing to switch to and no switcher is shown.
- **Ordering:** by phone callback. The form takes a phone number; name, quantity
  and a note are optional. A person calls to confirm the order and arrange
  delivery. The request is stored before any notification is sent.
- **Mirrored catalog:** products, prices and availability are synchronised from
  one source shop, which also fulfils the order. The storefront never names that
  shop, never links to it and never loads anything from it. Product copy is
  rewritten; the source's prose is not published. A product's name and address
  are the shop's own too, put together from the brand, the line, the format and
  the pack size; the source's name for it is for the owner, who orders by it,
  and is never shown to a customer.
- **Commercial terms** — delivery fee, free-delivery threshold, delivery time,
  payment methods, returns — live in configuration. A term that has not been
  set is omitted from the page. It is never guessed and never written into copy
  by hand.
- **Stock:** the storefront shows what the last synchronisation saw. Unknown
  availability reads "Попитайте ни", never "В наличност".
- **Who answers:** a person, on the phone number and during the hours in
  `siteConfig.contact`. Nothing on the site promises a response time.
- **No accounts.** No registration, login, saved addresses or order history.

## Scope

**Built:** home; category, brand, promotions and search listings with
server-side filters, sort and pagination; product pages with a quick-order form;
the recommendation wizard and its result page; machine-compatibility pages by
brand and model; search with typeahead in both alphabets; contact form;
newsletter consent capture; legal pages; an admin panel for order requests,
messages and the shared mailbox.

**Also built, to the standard in `DESIGN.md`:** machine-first navigation; system
badge and intensity scale on every card; quick order from the card; a facts
table and a delivery-and-payment block on the product page; filters by system
and intensity band and a sort by price per cup; a home page built from
packshots; Vending Zone and Consumables pages; a journal, called „Блог“ on the
site; and four listings cut across the catalog — Lavazza's capsules, Lavazza's
beans, decaf, and the cheapest per cup in each system — each shown only while
it has products.

**Deliberately out of scope:**

- A cart, online payment, checkout and order tracking. The business confirms
  every order by phone; a cart would promise a process that does not exist.
- Customer accounts, wishlists and saved comparisons.
- Reviews, ratings and question-and-answer sections. See below.
- Prices, discounts or stock that differ from the source's.
- Loyalty schemes, coupons and countdown promotions.
- Sending newsletters. Consent is collected and managed; sending is a separate
  decision.
- Lifestyle and stock photography. The imagery is the product packshots and our
  own drawings of capsule shapes.
- A dark theme.

## Brand

**Buy a Coffee** is one of four sibling storefronts of the same company. It
shares the company's phone number and legal entity with them and nothing else:
no shared visual identity, no cross-branding in the interface.

- **Mark:** a gold coffee bean with a rising curl, and a serif wordmark in
  brown-black. The interface takes its one accent colour from the mark's gold
  and its ink colour from the wordmark's brown, so the logo belongs to the page
  it sits on.
- **Identity:** pine green anchor, cream paper, a serif display face (Literata)
  over a sans body face (Inter), squared geometry with small radii. Deliberately
  unlike the source shop's tan-and-brown, rounded, single-typeface design.
- **Imagery:** the packs are loud and colourful, so the interface stays quiet
  and lets them carry the colour.
- **Legal identity:** the company name, registration number and address appear
  in the footer, the legal pages and structured data, from `siteConfig.legal`.

### Voice: a plain-spoken advisor

The wizard already sounds like this. Everything else should.

- **Say the consequence, not the feature.** "Това решава кое изобщо може да
  влезе в машината ви", not "Изберете система за съвместимост".
- **Name the situation, not an abstract scale.** "За първото кафе сутрин" tells
  two customers the same thing; "силно" does not.
- **Say no plainly.** "Нямаме капсули за Vertuo" — then say what the customer
  can do next.
- **Address the customer as "вие", lower case, in full sentences.** No
  imperatives stacked on exclamation marks, no capitalised "Вие".
- **Numbers are exact or marked.** "0,35 € на чаша"; "≈ 0,12 € на чаша" when the
  figure is derived from weight.
- **Short.** A label is a few words. A paragraph is one idea.

| Write                                               | Do not write                          |
| --------------------------------------------------- | ------------------------------------- |
| Оставете номер и ще ви се обадим, за да потвърдим.  | Поръчайте сега само с един клик!      |
| Става за машини Dolce Gusto.                        | Оригинални капсули Dolce Gusto        |
| Нямаме нищо за тази машина. Обадете ни се.          | За съжаление няма намерени резултати. |
| 8 от 12                                             | Интензивност 8                        |
| Цена при запитване — обадете ни се и ще ви я кажем. | 0,00 €                                |
| Най-евтино на чаша в тази система.                  | Най-добрата оферта на пазара          |

## What may never be claimed

**Does not exist and must not be fabricated:** customer reviews, star ratings,
testimonials, "bestseller" or "customers also bought" labels, counts of orders
or customers, awards, certifications (organic, fair trade, speciality grades),
press mentions, and any `aggregateRating` or `review` markup.

**Facts about a coffee come from the data or are not stated.** Origin, arabica
and robusta share, roast, tasting notes, caffeine content and intensity are
shown when the product record holds them and omitted when it does not. A
generated description may restate recorded facts; it may not add one.

**No quality ranking.** With no ratings and no cupping scores there is no basis
for calling a dearer coffee a better one. The wizard ranks by fit and by price
per cup, and says which.

**Compatibility is a promise.** A capsule is said to fit a machine only when the
hand-written machine database says so. Third-party capsules are "съвместими с"
a system; they are never presented as made, licensed or endorsed by the
system's owner, and no logo is ever used to mark a system or compatibility.
A brand's logo appears only where that brand is the subject (its own page, the
brand index, its own products), Lavazza's and Caffitaly's included.

**Intensity is never compared across scales.** The source declares it out of 5,
9, 10, 12 or 13 depending on the brand. A numeral is always shown with its own
maximum. It is never rescaled to a common figure, and two products on different
scales are never ordered by the raw number.

**No delivery, payment or returns promise that configuration does not hold.**
No "доставка утре", no "безплатна доставка" without the configured threshold
beside it, no response-time promise.

**No urgency.** No countdowns, no "остават 2 броя", no "само днес". Stock is
not known to that precision and the reduction dates are not ours.

**A reduction is real or absent.** A struck-through price is shown only when the
record holds an old price higher than the current one.

**Price per cup derived from weight is an estimate and is marked as one**, with
"≈", because how much coffee a shot uses belongs to the machine, not the bag.

## Principles

1. **Machine first.** Start from what the customer owns. Never make them learn
   the taxonomy before they can shop.
2. **Fit before taste.** Compatibility is decided first and never traded away.
   Everything else is a preference.
3. **Show the number that compares.** Price per cup and price per kilogram sit
   beside the pack price, wherever a price is shown.
4. **Nothing invented.** A missing fact produces a shorter page, never a filled
   gap.
5. **Explain a recommendation.** A suggestion carries the reasons that actually
   ranked it. A ranked list with no reasons is a filter wearing a costume.
6. **The pack carries the colour.** The interface is quiet so that a shelf of
   twenty brands reads as a shelf, not as twenty adverts.
7. **Works without JavaScript.** Every control is a link or a form first.
   JavaScript improves it and is never required.
8. **One request, safely stored.** The order request is the product. It is
   recorded before anything else happens to it.

## Accessibility

WCAG 2.2 AA is the working standard, tested rather than asserted.

- One `h1` per page; no skipped heading levels.
- Every text and background pairing in use is listed in `DESIGN.md` with its
  measured contrast ratio. An unlisted pairing is not allowed.
- Colour never carries meaning alone: a brewing-system colour is always beside
  the system's name, a reduction always shows both prices, availability is
  always a word.
- Every control is reachable and operable by keyboard, with a visible focus
  ring; pointer targets are at least 24 by 24 CSS pixels, and 44 pixels tall for
  primary actions on a phone.
- Forms label every field, tie each error to its field, and announce the
  result.
- Motion is limited to state changes and stops entirely under
  `prefers-reduced-motion`.
- Bulgarian is declared as the document language, and both typefaces carry
  Cyrillic.

Performance is part of access on a phone: mobile LCP under 2.5 s and CLS under
0.1 on the home page, a listing and a product page. The budgets and their
measurements are in `DESIGN.md`.
