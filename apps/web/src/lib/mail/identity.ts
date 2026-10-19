import "server-only";
import { siteConfig } from "@/config/site";
import { mailUrl } from "@/emails/theme";

/**
 * Who this shop sends as, resolved once.
 *
 * Every sender shares it — the notification to the shop, the inbound forward,
 * the admin's reply, the order confirmation and the newsletter — and they
 * must not each read `MAIL_FROM` their own
 * way. The one that got it wrong would be whichever was added last, and the
 * symptom is a preview deploy quietly sending as the live brand.
 *
 * `MAIL_FROM` is documented as a full header (`Buy a Coffee <hello@...>`), so
 * two forms are needed. `MAIL_FROM` is what goes in a plain From; `MAIL_ADDRESS`
 * is the bare address, for the one message that has to wrap somebody else's
 * name around our own domain (the forward). Pasting a full header into
 * `"Name via Brand" <...>` produces `<Buy a Coffee <hello@...>>`, which is not
 * so much a rejected address as an unparseable one.
 *
 * The fallback is `siteConfig.contact.email`, `info@buy-a-coffee.com`, and the
 * domain is verified in Resend for sending — so the fallback is a working
 * sender rather than a trap. Were it ever unverified, Resend would refuse the
 * send outright, which is the right failure: a silent fallback to some other
 * sender would be worse than an error.
 */

/** The complete From header. */
export const MAIL_FROM =
  process.env.MAIL_FROM || `${siteConfig.name} <${siteConfig.contact.email}>`;

/** Just the address out of it, angle brackets stripped. */
export const MAIL_ADDRESS = (MAIL_FROM.match(/<([^>]+)>/)?.[1] ?? MAIL_FROM).trim();

/** The domain we receive on. Anything already from here is not forwarded — see
 *  the loop guard in `inbound.ts`. */
export const MAIL_DOMAIN = MAIL_ADDRESS.slice(MAIL_ADDRESS.indexOf("@") + 1);

/** Where notifications and forwarded mail land: a person's inbox, not ours. */
export const NOTIFY_TO = process.env.MAIL_TO?.trim() || "";

/**
 * The signature under every message the shop sends a customer: a reply from
 * the panel (`reply.ts`) and the confirmation of an order (`confirmation.ts`).
 *
 * Facts a customer may need to act on: who wrote, what to call, when someone
 * answers. The phone number is first because this shop's whole ordering flow is
 * a phone call — the fastest reply to any of this mail is the customer ringing.
 *
 * The lone `--` is the standard signature delimiter, and the thread view relies
 * on it to hide this block when it lists what we sent — see `withoutSignature`
 * in the admin thread page. Changing it here means changing it there.
 */
export const MAIL_SIGNATURE: readonly string[] = [
  "--",
  siteConfig.name,
  `${siteConfig.contact.phone} · ${MAIL_ADDRESS}`,
  siteConfig.contact.hours,
];

/**
 * A link into the panel, absolute.
 *
 * Notification mail is read on a phone, away from the machine the panel was
 * last open on, so a relative path is useless. `mailUrl` points it at the
 * deployment that sent it — `NEXT_PUBLIC_SITE_URL`, else a preview's own
 * `VERCEL_URL` — so a preview's notification opens the preview's panel, whose
 * database holds the record.
 */
export const adminUrl = (path: string): string => mailUrl(path);
