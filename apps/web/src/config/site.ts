/**
 * Central brand configuration.
 *
 * Everything a rebrand touches lives here and in `tokens.css`. Nothing in the
 * application hardcodes a brand name, phone number or legal detail.
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

const env = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;

const companyName = env("NEXT_PUBLIC_LEGAL_COMPANY_NAME");
const companyId = env("NEXT_PUBLIC_LEGAL_COMPANY_ID");
const address = env("NEXT_PUBLIC_LEGAL_ADDRESS");

export const siteConfig: SiteConfig = {
  name: env("NEXT_PUBLIC_SITE_NAME", "Buy a Coffee"),
  shortName: env("NEXT_PUBLIC_SITE_SHORT_NAME", "Buy a Coffee"),
  tagline: env("NEXT_PUBLIC_SITE_TAGLINE", "Кафе, подбрано с грижа"),
  description: env(
    "NEXT_PUBLIC_SITE_DESCRIPTION",
    "Кафе на зърна, капсули и дози от марки, които си заслужават. Поръчка на една стъпка — ние ви звъним, за да потвърдим.",
  ),
  locale: env("NEXT_PUBLIC_SITE_LOCALE", "bg-BG"),
  currency: env("NEXT_PUBLIC_CURRENCY", "EUR"),
  url: env("NEXT_PUBLIC_SITE_URL", "http://localhost:3000"),

  contact: {
    phone: env("NEXT_PUBLIC_CONTACT_PHONE", "+359 000 000 000"),
    phoneHref: env("NEXT_PUBLIC_CONTACT_PHONE", "+359 000 000 000").replace(/[^+\d]/g, ""),
    email: env("NEXT_PUBLIC_CONTACT_EMAIL", "hello@example.com"),
    hours: env("NEXT_PUBLIC_CONTACT_HOURS", "Пон–Пет, 9:00–18:00"),
  },

  social: {},

  legal: {
    companyName,
    companyId,
    vatId: env("NEXT_PUBLIC_LEGAL_VAT_ID"),
    address,
    // Placeholders must never be presented as real registration details.
    isComplete: Boolean(companyName && companyId && address),
  },

  features: {
    newsletter: env("NEXT_PUBLIC_FEATURE_NEWSLETTER", "true") !== "false",
    blog: env("NEXT_PUBLIC_FEATURE_BLOG", "true") !== "false",
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
