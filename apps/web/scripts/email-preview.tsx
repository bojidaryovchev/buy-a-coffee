/**
 * Every outgoing message, rendered with example content, as files to open in a
 * browser:
 *
 *   pnpm --filter @catalog/web email:preview            → apps/web/.email-previews/
 *   pnpm --filter @catalog/web email:preview -- <dir>   → <dir>
 *
 * One `.html` and one `.txt` per template, through the same compose functions
 * the senders call, plus an `index.html` that links them. Nothing is sent and
 * no database is read. The output folder is git-ignored.
 *
 * Links and the logo are drawn against the live origin unless
 * NEXT_PUBLIC_SITE_URL says otherwise, because a preview of `localhost` links
 * shows a broken logo and proves nothing about what a subscriber will see.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

process.env.NEXT_PUBLIC_SITE_URL ||= "https://buy-a-coffee.com";

/* After the variable: `siteConfig.url` is read once, when the module loads. */
const fixtures = await import("../src/emails/fixtures.ts");
const { composeOrderConfirmationEmail } = await import("../src/emails/order-confirmation.tsx");
const { composeOwnerNotificationEmail } = await import("../src/emails/owner-notification.tsx");
const { composeReplyEmail } = await import("../src/emails/reply.tsx");
const { composeForwardHtml } = await import("../src/emails/forward.tsx");
const { composeNewsletterEmail } = await import("../src/emails/newsletter.tsx");
const { unsubscribeUrl } = await import("../src/lib/newsletter/links.ts");

const outDir = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, "../.email-previews"),
);
mkdirSync(outDir, { recursive: true });

const recipient = { unsubscribeUrl: unsubscribeUrl(fixtures.FIXTURE_UNSUBSCRIBE_TOKEN) };

const previews: { name: string; title: string; html: string; text: string | null }[] = [];

async function add(
  name: string,
  title: string,
  composed: Promise<{ html: string; text: string | null }>,
) {
  previews.push({ name, title, ...(await composed) });
}

await add(
  "order-confirmation",
  "Потвърждение на заявка (до клиента)",
  composeOrderConfirmationEmail(fixtures.orderConfirmationFixture, fixtures.FIXTURE_SIGNATURE),
);
await add(
  "notification-order",
  "Известие: заявка (до магазина)",
  composeOwnerNotificationEmail(fixtures.orderNotificationFixture),
);
await add(
  "notification-contact",
  "Известие: съобщение (до магазина)",
  composeOwnerNotificationEmail(fixtures.contactNotificationFixture),
);
await add(
  "notification-signup",
  "Известие: нов абонат (до магазина)",
  composeOwnerNotificationEmail(fixtures.signupNotificationFixture),
);
await add(
  "notification-sync",
  "Известие: синхронизация (до магазина)",
  composeOwnerNotificationEmail(fixtures.syncAlertFixture),
);
await add(
  "reply",
  "Отговор от панела",
  composeReplyEmail(fixtures.replyFixture, fixtures.FIXTURE_SIGNATURE),
);
await add(
  "inbound-forward",
  "Препратено входящо писмо (до магазина)",
  composeForwardHtml(
    fixtures.forwardEnvelopeFixture,
    fixtures.forwardOriginalFixture,
    fixtures.FIXTURE_SENDER_ADDRESS,
  ).then((html) => ({ html, text: null })),
);
await add("newsletter", "Бюлетин", composeNewsletterEmail(fixtures.newsletterFixture, recipient));
await add(
  "newsletter-test",
  "Бюлетин, пробно копие",
  composeNewsletterEmail(fixtures.newsletterFixture, { ...recipient, test: true }),
);

for (const preview of previews) {
  writeFileSync(path.join(outDir, `${preview.name}.html`), preview.html);
  if (preview.text !== null) writeFileSync(path.join(outDir, `${preview.name}.txt`), preview.text);
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html><html lang="bg"><meta charset="utf-8"><title>Писма</title>
<body style="font:15px/1.6 system-ui,sans-serif;margin:32px;color:#23180f;background:#faf6ee">
<h1 style="font:600 24px Georgia,serif">Писмата на ${escape(new URL(process.env.NEXT_PUBLIC_SITE_URL).host)}</h1>
<ul>${previews
    .map(
      (preview) =>
        `<li><a href="${preview.name}.html">${escape(preview.title)}</a>${
          preview.text !== null ? ` · <a href="${preview.name}.txt">текст</a>` : ""
        } · ${Math.round(Buffer.byteLength(preview.html) / 1000)} KB</li>`,
    )
    .join("")}</ul></body></html>`,
);

console.log(
  JSON.stringify({
    level: "info",
    msg: "email-preview:written",
    dir: outDir,
    count: previews.length,
  }),
);
