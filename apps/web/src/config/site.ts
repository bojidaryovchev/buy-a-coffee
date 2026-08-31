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
    readonly address: string;
    readonly isComplete: boolean;
  };
  readonly features: {
    /** Newsletter capture is observed on the reference site. */
    readonly newsletter: boolean;
    /** The reference site has a blog route with no articles yet. */
    readonly blog: boolean;
  };
}

/** TODO: the shop's real number and inbox. Placeholders until the business supplies them. */
const CONTACT_PHONE = "+359 000 000 000";
const CONTACT_EMAIL = "hello@example.com";

/**
 * Company registration details. Deliberately empty — see the note above. Fill
 * these in once they are real; nothing else needs to change.
 */
const LEGAL_COMPANY_NAME = "";
const LEGAL_COMPANY_ID = "";
const LEGAL_VAT_ID = "";
const LEGAL_ADDRESS = "";

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
