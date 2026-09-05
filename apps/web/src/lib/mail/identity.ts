import "server-only";
import { siteConfig, absoluteUrl } from "@/config/site";

/**
 * Who this shop sends as, resolved once.
 *
 * Three senders share it — the notification to the shop, the inbound forward,
 * and the admin's reply — and they must not each read `MAIL_FROM` their own
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
 * ⚠ The fallback is `siteConfig.contact.email`, now `info@buy-a-coffee.com` —
 * a real address on a domain that is not yet verified in Resend. Resend refuses
 * to send from an unverified domain, so until `buy-a-coffee.com` carries SPF
 * and DKIM, nothing here sends at all. That is the right failure: a silent
 * fallback to some other sender would be worse. It is on the launch checklist.
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
 * A link into the panel, absolute.
 *
 * Notification mail is read on a phone, away from the machine the panel was
 * last open on, so a relative path is useless. `absoluteUrl` derives it from
 * `NEXT_PUBLIC_SITE_URL`, which means a misconfigured origin produces a link to
 * localhost rather than a broken page — visible, and only in our own mail.
 */
export const adminUrl = (path: string): string => absoluteUrl(path);
