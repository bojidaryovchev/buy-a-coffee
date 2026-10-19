import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { siteConfig } from "@/config/site";
import { composeForwardHtml } from "@/emails/forward";
import {
  FIXTURE_SIGNATURE,
  FIXTURE_UNSUBSCRIBE_TOKEN,
  contactNotificationFixture,
  forwardEnvelopeFixture,
  forwardOriginalFixture,
  newsletterFixture,
  newsletterProductsFixture,
  orderConfirmationFixture,
  orderNotificationFixture,
  replyFixture,
  signupNotificationFixture,
  syncAlertFixture,
} from "@/emails/fixtures";
import { composeNewsletterEmail } from "@/emails/newsletter";
import { composeOrderConfirmationEmail } from "@/emails/order-confirmation";
import { composeOwnerNotificationEmail } from "@/emails/owner-notification";
import { composeReplyEmail } from "@/emails/reply";
import { PRODUCTION_ORIGIN, color, mailOrigin } from "@/emails/theme";
import { unsubscribeUrl } from "@/lib/newsletter/links";

/**
 * Every message the shop sends, rendered through the functions the senders
 * call, and checked for the rules that hold for all of them.
 *
 * Mail escapes every other check in this repository: there is no Tailwind
 * class to grep and no page for the browser suite to open; the body exists
 * only once React has run. So the design rules that matter are asserted here,
 * on the rendered HTML — as invariants, not snapshots, because a snapshot of
 * a letter breaks on every change of wording and teaches everybody to
 * re-record it without looking.
 */

const recipient = { unsubscribeUrl: unsubscribeUrl(FIXTURE_UNSUBSCRIBE_TOKEN) };

const letterheads = await Promise.all(
  (
    [
      [
        "order confirmation",
        composeOrderConfirmationEmail(orderConfirmationFixture, FIXTURE_SIGNATURE),
      ],
      ["order notification", composeOwnerNotificationEmail(orderNotificationFixture)],
      ["contact notification", composeOwnerNotificationEmail(contactNotificationFixture)],
      ["signup notification", composeOwnerNotificationEmail(signupNotificationFixture)],
      ["sync alert", composeOwnerNotificationEmail(syncAlertFixture)],
      ["reply", composeReplyEmail(replyFixture, FIXTURE_SIGNATURE)],
      ["newsletter", composeNewsletterEmail(newsletterFixture, recipient)],
      ["newsletter test", composeNewsletterEmail(newsletterFixture, { ...recipient, test: true })],
      ["newsletter with products", composeNewsletterEmail(newsletterProductsFixture, recipient)],
    ] as const
  ).map(async ([name, composed]) => [name, await composed] as const),
);

/* A staging-like sender, so the band can be seen to print the address mail
   really comes from rather than the published one. */
const STAGING_SENDER = "info@staging.example.bg";
const forward = await composeForwardHtml(
  forwardEnvelopeFixture,
  forwardOriginalFixture,
  STAGING_SENDER,
);

/** Every `href` and `src` in a document. */
const urls = (html: string) =>
  [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));

const fontSizes = (html: string) =>
  [...html.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));

const palette = new Set(Object.values(color).map((hex) => hex.toLowerCase()));

/** Text React split with `<!-- -->` between adjacent nodes, joined back. */
const visible = (html: string) => html.replace(/<!-- -->/g, "");

/* The text parts of the shop's own notifications read as they always have —
   summary, link, a line on what this is — and carry no signature: they are
   read by the shop. Everything a customer receives is signed in both parts. */
const SIGNED_TEXT = new Set([
  "order confirmation",
  "reply",
  "newsletter",
  "newsletter test",
  "newsletter with products",
]);

describe.each(letterheads)("%s", (name, { html, text }) => {
  it("declares Bulgarian, so the Bulgarian Cyrillic letterforms are drawn", () => {
    expect(html).toContain('<html dir="ltr" lang="bg"');
  });

  it("names the shop and every way to reach it", () => {
    expect(html).toContain(siteConfig.name);
    expect(html).toContain(siteConfig.contact.phone);
    expect(html).toContain(siteConfig.contact.email);
    expect(html).toContain(`tel:${siteConfig.contact.phoneHref}`);
    if (SIGNED_TEXT.has(name)) {
      expect(text).toContain(siteConfig.name);
      expect(text).toContain(siteConfig.contact.phone);
    }
  });

  it("carries the logo from the live site, absolute, with a text alternative", () => {
    /* From production whatever the deployment: a preview sits behind Vercel's
       login, and its own copy would be a broken image in every inbox. */
    expect(html).toContain(`src="${PRODUCTION_ORIGIN}/email-logo.png"`);
    expect(html).toMatch(/<img [^>]*alt="Buy a Coffee"[^>]*src="https:\/\/[^"]+\/email-logo\.png"/);
  });

  it("sets nothing under the eleven pixel floor", () => {
    const sizes = fontSizes(html);
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((size) => size < 11)).toEqual([]);
  });

  it("links only to absolute addresses", () => {
    /* A relative link in mail resolves against nothing. `mailto:` and `tel:`
       are absolute in their own way. */
    for (const url of urls(html)) {
      expect(url, url).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
  });

  it("paints only the palette", () => {
    const colours = [...html.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0].toLowerCase());
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter((hex) => !palette.has(hex))).toEqual([]);
  });

  it("is light-only, so a dark-mode client is told rather than left to guess", () => {
    expect(html).toContain('name="color-scheme" content="light"');
  });

  it("has a plain-text twin", () => {
    expect(text.trim().length).toBeGreaterThan(40);
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe("the newsletter", () => {
  const [, newsletter] = letterheads.find(([name]) => name === "newsletter")!;
  const [, test] = letterheads.find(([name]) => name === "newsletter test")!;

  it("carries the reader's own unsubscribe link, with the reason, in both parts", () => {
    expect(newsletter.html).toContain(recipient.unsubscribeUrl);
    expect(newsletter.html).toContain("Отписване от бюлетина");
    expect(newsletter.html).toContain("защото сте се абонирали");
    expect(newsletter.text).toContain(`Отписване: ${recipient.unsubscribeUrl}`);
  });

  it("draws uploaded images with their description and links files for download", () => {
    expect(newsletter.html).toContain('alt="Три нови пакета кафе на зърна един до друг"');
    expect(newsletter.html).toContain("ceni-oktomvri-QwE789rTy.pdf?download=1");
    expect(newsletter.html).toContain("Изтегли");
    expect(newsletter.text).toMatch(
      /Цени октомври\.pdf \(PDF, 1,2 MB\): https:\/\/\S+\?download=1/,
    );
  });

  it("says a test copy is one, before anything else", () => {
    expect(test.html).toContain("Пробно писмо");
    expect(test.text.startsWith("Пробно писмо.")).toBe(true);
    expect(newsletter.html).not.toContain("Пробно писмо");
  });

  it("uses the preheader as the inbox preview", () => {
    expect(newsletter.html).toContain(newsletterFixture.preheader);
  });
});

describe("the owner's notifications", () => {
  /* That they carry no contact details is checked where it can fail: from a
     record full of them, through the real builders, in `owner-notices.test.ts`. */

  it("draw an order as a table with the sum and what it leaves out", () => {
    const [, order] = letterheads.find(([name]) => name === "order notification")!;
    const html = visible(order.html);
    expect(html).toMatch(/48,50\s€/);
    expect(html).toMatch(/2 бр\. × 19,90\s€/);
    expect(html).toContain("Цена при запитване");
    expect(html).toContain("Без 1 продукт с цена при запитване.");
    expect(html).toContain("Отворете в панела");
  });
});

describe("the inbound forward", () => {
  it("names the address the mail really arrived at, not the published one", () => {
    expect(forward).toContain(`Препратено от ${STAGING_SENDER}.`);
  });

  it("is Bulgarian, in the palette, and keeps the sender's message as it arrived", () => {
    expect(forward).toContain('lang="bg"');
    expect(forward).toContain("От: Мария Петрова &lt;maria@example.bg&gt;");
    // The original's markup, not escaped, and its `$` left alone.
    expect(forward).toContain("<p>Цена: 5 $ &amp; повече</p>");
    expect(forward).toContain("<b>Dolce Gusto Genio</b>");
    // Its head styles moved into ours, where clients look for them.
    expect(forward).toMatch(/<style>\.note\{color:#333\}<\/style><\/head>/);
    expect(forward.match(/<html/g)).toHaveLength(1);
    expect(forward.match(/<body/g)).toHaveLength(1);
  });

  it("draws the envelope only in the palette's colours", () => {
    const envelope = forward.slice(0, forward.indexOf("Здравейте"));
    const colours = [...envelope.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter((hex) => !palette.has(hex))).toEqual([]);
  });
});

describe("how mail is handed to Resend", () => {
  /* `send({ react })` makes the SDK render with a package it imports on its
     own, which in a sibling project resolved to nothing on the first real
     send. Every sender here passes the HTML it rendered itself. */
  it("never passes a React element", () => {
    const root = path.resolve(import.meta.dirname, "../src");
    const senders = ["lib/mail", "lib/newsletter", "app/api"].flatMap((dir) =>
      readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name)),
    );
    expect(senders.length).toBeGreaterThan(5);
    for (const file of senders) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\breact\s*:/);
    }
  });
});

describe("the reply's signature", () => {
  it("prints the address the reply is sent from", async () => {
    const { html } = await composeReplyEmail(
      { ...replyFixture, senderAddress: "shop@staging.example.bg" },
      FIXTURE_SIGNATURE,
    );
    expect(html).toContain('href="mailto:shop@staging.example.bg"');
    expect(html).toContain(">shop@staging.example.bg</a>");
  });
});

describe("where a message's links point", () => {
  it("is the configured site in production", () => {
    expect(mailOrigin({ NEXT_PUBLIC_SITE_URL: "https://buy-a-coffee.com/" })).toBe(
      "https://buy-a-coffee.com",
    );
  });

  it("is the preview's own host on a preview, which has no site URL", () => {
    /* Its database holds the unsubscribe tokens it sends, so its links must
       reach it, not production. */
    expect(mailOrigin({ VERCEL_URL: "buy-a-coffee-git-x-team.vercel.app" })).toBe(
      "https://buy-a-coffee-git-x-team.vercel.app",
    );
  });

  it("is the local site on a laptop", () => {
    expect(mailOrigin({})).toBe(siteConfig.url.replace(/\/+$/, ""));
  });
});
