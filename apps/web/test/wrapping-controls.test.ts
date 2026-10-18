import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * The layout rules behind the owner's report of a wizard card whose count was
 * squeezed into a column of its own („4 / ПРОДУКТА“) and a newsletter field
 * too narrow to show an address. What a browser does with these classes at
 * each width is checked by eye and by the responsive sweep; what is checked
 * here is that the rules are in the markup.
 */

vi.mock("@/lib/forms/actions", () => ({ subscribeToNewsletter: async () => ({}) }));
vi.mock("@/components/analytics-provider", () => ({ useAnalytics: () => ({ track: () => {} }) }));
vi.mock("@/i18n/use-locale", () => ({ useLocale: () => "bg" }));

import { NewsletterForm } from "@/components/forms/newsletter-form";
import { OptionList, ToggleOptionList } from "@/components/wizard/wizard-ui";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

describe("a wizard option's note", () => {
  const options = [
    { href: "/a", label: "Nespresso Original", detail: "Малки капсули.", meta: "36 продукта" },
    { href: "/b", label: "Dolce Gusto", meta: "35 продукта", selected: true },
  ];

  it("is placed by the card's own width: under the label when narrow, beside it when there is room", () => {
    const markup = html(createElement(OptionList, { options, columns: 2 }));
    expect(markup.match(/<li class="@container">/g)).toHaveLength(2);
    expect(markup).toContain("flex-col");
    expect(markup).toContain("@md:flex-row");
  });

  it("never breaks, and is a count in sentence case rather than an uppercase label", () => {
    const markup = html(createElement(OptionList, { options }));
    const notes = markup.match(/<span class="[^"]*whitespace-nowrap[^"]*">[^<]+<\/span>/g) ?? [];
    expect(notes.map((note) => note.replace(/<[^>]+>/g, ""))).toEqual([
      "36 продукта",
      "35 продукта",
    ]);
    expect(notes.join("")).not.toContain("uppercase");
    expect(notes.join("")).toContain("text-ink-500");
  });
});

describe("the wizard's requirement toggles", () => {
  const toggles = [
    { href: "/x?requirements=decaf", label: "Без кофеин", meta: "3 продукта", selected: true },
    {
      href: "/x?requirements=flavoured",
      label: "Ароматизирано (ванилия, лешник и подобни)",
      meta: "11 продукта",
      selected: false,
    },
  ];

  it("are links that say whether they are on, with a check box drawn for the eye", () => {
    const markup = html(createElement(ToggleOptionList, { options: toggles }));
    expect(markup.match(/<a [^>]*aria-pressed="true"/g)).toHaveLength(1);
    expect(markup.match(/<a [^>]*aria-pressed="false"/g)).toHaveLength(1);
    // One check mark, on the selected one.
    expect(markup.match(/<path d="M2 6.5l2.5 2.5L10 3"/g)).toHaveLength(1);
  });

  it("keep the count whole, whether or not the option is on", () => {
    const markup = html(createElement(ToggleOptionList, { options: toggles }));
    expect(markup).toMatch(/whitespace-nowrap[^"]*">3 продукта</);
    expect(markup).toMatch(/whitespace-nowrap[^"]*">11 продукта</);
    expect(markup).not.toContain("избрано");
  });
});

describe("the newsletter form", () => {
  const markup = html(createElement(NewsletterForm, { source: "footer" }));

  it("works without a script: a real form, a typed, required field and the honeypot", () => {
    expect(markup).toMatch(/<form [^>]*action=/);
    const field = markup.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? "";
    expect(field).toContain('type="email"');
    expect(field).toContain('required=""');
    expect(field).toMatch(/autocomplete="email"/i);
    expect(markup).toContain('name="website"');
    expect(markup).toContain('<input type="hidden" name="source" value="footer"/>');
  });

  it("stacks the field over the button until the form has room for a whole address beside it", () => {
    expect(markup).toContain("@container");
    expect(markup).toContain("flex-col gap-2 @md:flex-row");
  });

  it("keeps the button's width while it sends: both labels share one cell", () => {
    expect(markup).toContain("Абонирай ме");
    expect(markup).toContain("Изпраща се…");
    expect(markup).toMatch(/col-start-1 row-start-1 invisible[^>]*>Изпраща се…/);
  });

  it("says how to leave and where the policy is, tied to the field", () => {
    const consentId = markup.match(
      /<p id="([^"]+)" class="text-xs text-ink-500">Можете да се отпишете/,
    )?.[1];
    expect(consentId).toBeTruthy();
    expect(markup).toMatch(new RegExp(`aria-describedby="${consentId}"`));
    expect(markup).toContain('href="/bg/poveritelnost"');
  });
});
