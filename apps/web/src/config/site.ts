/**
 * Central brand configuration.
 *
 * Everything a rebrand touches lives here and in `tokens.css`. Nothing in the
 * application hardcodes a brand name, phone number or legal detail.
 *
 * These are plain constants rather than environment variables, for two
 * reasons. First, they are not deployment-varying: there is one shop, and a
 * change to its name or phone number belongs in a commit someone can review,
 * not in a dashboard field with no history. Second, an env-driven brand did not
 * actually work — `siteConfig` is imported by client components, and Next.js
 * only inlines a `NEXT_PUBLIC_*` value it can see written as a literal
 * `process.env.NAME` expression. Reading them through a helper meant the
 * browser silently fell back to these defaults no matter what the deployment
 * was configured with.
 *
 * `url` is the one exception: it genuinely differs between localhost and
 * production, so it stays an environment variable — written as a static
 * reference so it is inlined.
 *
 * The brand name and tagline are real. Company registration details are
 * intentionally left empty rather than invented: publishing a fabricated
 * company number would be a legal problem, not a cosmetic one.
 * `siteConfig.legal.isComplete` reports whether the real values have been
 * supplied, and the footer says so plainly when they have not.
 */

export interface SiteConfig {
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly description: string;
  readonly locale: string;
  readonly currency: string;
  readonly url: string;
  readonly contact: {
    readonly phone: string;
    readonly phoneHref: string;
    readonly email: string;
    readonly hours: string;
  };
  readonly social: Readonly<Record<string, string>>;
  readonly legal: {
    readonly companyName: string;
    readonly companyId: string;
    readonly vatId: string;
    /** The one-line form, for the footer and the legal pages. */
    readonly address: string;
    /** The same address in parts, for schema.org `PostalAddress`. */
    readonly streetAddress: string;
    readonly addressLocality: string;
    readonly addressRegion: string;
    readonly addressCountry: string;
    readonly isComplete: boolean;
  };
  readonly features: {
    /** Newsletter capture is observed on the reference site. */
    readonly newsletter: boolean;
    /** The reference site has a blog route with no articles yet. */
    readonly blog: boolean;
  };
}

/**
 * The real company, supplied by the client on 2 August 2026 and already in use
 * on the three sibling sites. Identical there — same legal entity, same ЕИК,
 * same handset — so these values are copied rather than re-sourced.
 *
 * Note on ЕИК and VAT: the client supplied "BG204578516", which is the VAT
 * form. A Bulgarian VAT number is the ЕИК prefixed with BG, so the ЕИК is the
 * digits alone. Worth one line of confirmation, since a company can be
 * registered without being VAT-registered — the same open question the vend
 * repos carry.
 */
const CONTACT_PHONE = "+359 897 943 424";

/**
 * A real inbox, not a decoration.
 *
 * Written the way the three sibling sites write theirs — `info@` at the site's
 * own domain, never the client's Gmail, because a shop printing a gmail.com
 * address next to a phone order reads as a man with a van.
 *
 * `buy-a-coffee.com` is verified in Resend for both sending and receiving
 * (checked 7 September 2026), so this address works in both directions: mail
 * sent from it is signed, and mail arriving at it is handed to `/api/inbound`,
 * which forwards it to `MAIL_TO`. Changing this address means changing the DNS
 * too.
 */
const CONTACT_EMAIL = "info@buy-a-coffee.com";

/* Address in parts, so the prose line and the PostalAddress in the structured
   data cannot drift apart. "местност Бедрозов бунар" is a locality name rather
   than a street — Bulgarian village addresses often have no street at all. */
const LEGAL_STREET = "местност Бедрозов бунар № 42";
const LEGAL_LOCALITY = "с. Марково";
const LEGAL_REGION = "Пловдив";

const LEGAL_COMPANY_NAME = "Лидер офис МЛ ЕООД";
const LEGAL_COMPANY_ID = "204578516";
const LEGAL_VAT_ID = "BG204578516";
const LEGAL_ADDRESS = `${LEGAL_LOCALITY}, ${LEGAL_STREET}, обл. ${LEGAL_REGION}`;

export const siteConfig: SiteConfig = {
  name: "Buy a Coffee",
  shortName: "Buy a Coffee",
  tagline: "Кафе, подбрано с грижа",
  description:
    "Кафе на зърна, капсули и дози от марки, които си заслужават. Поръчка на една стъпка — ние ви звъним, за да потвърдим.",
  // The shop sells only in Bulgaria: all customer-facing copy is Bulgarian.
  locale: "bg-BG",
  currency: "EUR",
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000",

  contact: {
    phone: CONTACT_PHONE,
    phoneHref: CONTACT_PHONE.replace(/[^+\d]/g, ""),
    email: CONTACT_EMAIL,
    hours: "Пон–Пет, 9:00–18:00",
  },

  social: {},

  legal: {
    companyName: LEGAL_COMPANY_NAME,
    companyId: LEGAL_COMPANY_ID,
    vatId: LEGAL_VAT_ID,
    address: LEGAL_ADDRESS,
    streetAddress: LEGAL_STREET,
    addressLocality: LEGAL_LOCALITY,
    addressRegion: LEGAL_REGION,
    addressCountry: "BG",
    // Placeholders must never be presented as real registration details.
    isComplete: Boolean(LEGAL_COMPANY_NAME && LEGAL_COMPANY_ID && LEGAL_ADDRESS),
  },

  features: {
    newsletter: true,
    blog: true,
  },
};

/**
 * True while the deployment is still missing real business details.
 *
 * The brand name is now known, so only the legal identity is outstanding —
 * and that is deliberately not invented.
 */
export const usingPlaceholderBrand = (): boolean => !siteConfig.legal.isComplete;

/** Absolute URL for canonical tags, sitemaps and structured data. */
export function absoluteUrl(pathname: string): string {
  const base = siteConfig.url.replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}`;
}
