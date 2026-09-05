/**
 * The STOREFRONT environment manifest. One declaration, three consumers.
 *
 *   scripts/env-check.mjs    what this configuration will actually do
 *   scripts/env-push.mjs     apply it to Vercel
 *   scripts/env-example.mjs  regenerate .env.example
 *
 * The catalog sync job is configured separately and already validates itself -
 * `loadConfig` in packages/scraper-core/src/config.ts parses the whole
 * environment through a zod schema and fails with a readable message. It is not
 * described here because it does not deploy to Vercel: it is a Lambda, and
 * infra/terraform owns its configuration.
 *
 * ---------------------------------------------------------------------------
 * `kind` decides where a value may live.
 * ---------------------------------------------------------------------------
 *
 *   config  Not secret. May carry a committed `value`, which is then the source
 *           of truth and is pushed as `plain`. Note that a config variable is
 *           NOT read from your .env when deploying unless it sets
 *           `fromEnv: true` - this repository is exactly why. Your local .env
 *           holds NEXT_PUBLIC_SITE_URL=http://localhost:3000, and a silent
 *           fallback would push localhost into production canonicals.
 *   secret  MUST NOT carry a `value`. Comes from your local .env, pushed
 *           encrypted. The commands refuse to run if a value appears here.
 *   system  Supplied by the platform. Documented, never pushed.
 *   local   Development only. Documented, never pushed.
 */

export const project = {
  vercelName: "buy-a-coffee",
  gitRepository: { type: "github", repo: "bojidaryovchev/buy-a-coffee" },
  framework: "nextjs",
  /** The one project where the app is not at the repository root. */
  rootDirectory: "apps/web",
};

const PROD_PREVIEW = ["production", "preview"];

export const vars = [
  /* -- Required ----------------------------------------------------------- */
  {
    name: "DATABASE_URL",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: "always",
    section: "Required",
    example: "postgres://catalog:catalog@localhost:5433/catalog",
    summary:
      "The catalog database written by the sync job. Read through `server-only`, so it can never reach a browser bundle.",
    detail: [
      "Any standard PostgreSQL instance: local Docker, Neon, RDS, Supabase.",
      "The development default matches `docker compose up -d` in this repository.",
    ],
    validate: (v) =>
      !/^postgres(ql)?:\/\//i.test(v)
        ? { level: "error", message: "Does not look like a PostgreSQL URL." }
        : null,
    missing: {
      level: "error",
      message: "The storefront reads its whole catalog from this. Nothing renders without it.",
    },
  },
  {
    name: "NEXT_PUBLIC_SITE_URL",
    kind: "config",
    /* No committed value yet: there is no production domain for this one. Set
       it here when there is - deliberately NOT read from .env, which holds
       localhost. */
    targets: PROD_PREVIEW,
    required: "always",
    section: "Required",
    example: "http://localhost:3000",
    summary:
      "Absolute site URL. Canonical tags, Open Graph, the sitemap and the structured data derive from it.",
    detail: [
      "Must be the real public URL in production. The code default, when unset,",
      "is http://localhost:3000 - which is also where `pnpm dev` serves.",
      "",
      "No value is committed above because this site has no production domain",
      "yet. Add one to env.schema.mjs when it does; until then env:push will",
      "report it as not pushed rather than sending localhost to Vercel.",
    ],
    validate: (v) =>
      !/^https?:\/\//.test(v)
        ? { level: "error", message: "Must be absolute - it is passed to new URL()." }
        : null,
    missing: {
      level: "error",
      message:
        "Canonicals, Open Graph, the sitemap and the structured data fall back to http://localhost:3000, which is wrong everywhere except a laptop.",
    },
  },
  {
    name: "RATE_LIMIT_SALT",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: "production",
    section: "Required",
    example: "openssl rand -hex 32",
    summary:
      "Salts the hashed client fingerprint used by rate limiting. The raw IP address is never stored.",
    detail: [
      "Rate limiting keeps working without it, which is exactly the danger:",
      "nothing breaks, so nothing tells you the fingerprint has become identical",
      "and predictable across every deployment of this code. A production",
      "process now logs an error at startup when it falls back.",
    ],
    validate: (v) =>
      v.length < 16
        ? {
            level: "warning",
            message: `Only ${v.length} characters. Use \`openssl rand -hex 32\`.`,
          }
        : null,
    missing: {
      level: "error",
      message:
        "Rate limiting falls back to a public default, so the IP fingerprint is predictable across deployments.",
      levelWhenLocal: "note",
    },
  },

  /* -- Images ------------------------------------------------------------- */
  {
    name: "NEXT_PUBLIC_IMAGE_BASE_URL",
    kind: "config",
    /* No committed value: it comes from Terraform's image_public_base_url
       output, which differs per environment. */
    targets: PROD_PREVIEW,
    required: false,
    section: "Images",
    example: "https://d111111abcdef8.cloudfront.net",
    summary:
      "Public base URL of the CDN holding mirrored product images. REQUIRED on any host without a persistent disk.",
    detail: [
      "Leave empty in development: images are then served from the local storage",
      "directory through the app's own /media route.",
      "",
      "On Vercel that fallback reads STORAGE_LOCAL_DIR off local disk - a",
      "directory the scraper wrote on someone's laptop, which is not in the",
      "deployment - so leaving this empty there means every product image 404s.",
      "",
      "It is also read at BUILD time by next.config.ts to build",
      "`images.remotePatterns`, the enforcement point for never hotlinking the",
      "source domain. Changing it needs a redeploy, not just a dashboard save,",
      "and a value that fails to parse as a URL silently allows no remote images",
      "at all.",
      "",
      "Must match STORAGE_PUBLIC_BASE_URL on the scraper side.",
    ],
    validate: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return {
          level: "error",
          message:
            "Not a valid URL. next.config.ts silently allows NO remote images when it cannot parse this.",
        };
      }
    },
    missing: {
      level: "error",
      message:
        "Images are served from STORAGE_LOCAL_DIR on local disk, which does not exist on this host. Every product image will 404.",
      levelWhenLocal: "note",
      messageWhenLocal:
        "Images are served from STORAGE_LOCAL_DIR through the app's own /media route. Correct for development; required on a serverless host.",
    },
  },
  {
    name: "STORAGE_LOCAL_DIR",
    kind: "local",
    section: "Images",
    example: "../../.storage",
    summary:
      "Where the sync wrote images when STORAGE_DRIVER=local. Relative paths resolve from the app directory, which is why this differs from the root .env.example.",
    detail: [
      "Development only. Read solely when NEXT_PUBLIC_IMAGE_BASE_URL is empty,",
      "so it is harmless on a serverless host - but it does not belong in that",
      "dashboard.",
    ],
  },

  /* -- Email -------------------------------------------------------------- */
  {
    name: "RESEND_API_KEY",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: false,
    section: "Email",
    example: "re_xxxxxxxxxxxxxxxxxxxx",
    summary:
      "Sends notifications for new enquiries, replies from the admin panel, and the inbound forward. Without it, notifications fall back to a redacted log line.",
    detail: [
      "Optional rather than required, and the grading says why: this shop writes",
      "every order enquiry and contact message to Postgres BEFORE notifying, so a",
      "missing key costs the shop a prompt and never a lead. The record is in the",
      "panel either way.",
      "",
      "Sending needs the domain verified in Resend (SPF + DKIM). Resend refuses",
      "to send from an unverified domain, so a real key against an unverified one",
      "fails every send.",
      "",
      "⚠ There is no real address to verify yet. siteConfig.contact.email is",
      "still hello@example.com - see the TODO in src/config/site.ts. Fill that in",
      "first; MAIL_FROM only overrides it.",
    ],
    missing: {
      level: "warning",
      message:
        "Notifications are logged rather than emailed, and the admin panel cannot send replies. Enquiries are still stored and still readable in the panel.",
    },
  },
  {
    name: "MAIL_FROM",
    kind: "config",
    /* No committed value: there is no verified address to commit yet, and the
       code default already reads the one place a real one would go. */
    targets: [],
    required: false,
    section: "Email",
    example: "Buy a Coffee <hello@example.com>",
    summary:
      "Sender override. Defaults to siteConfig.name and siteConfig.contact.email, which is still a placeholder.",
    detail: [
      "Set it on a preview deploy, which has no business sending as the live",
      "shop. Accepts a display name.",
    ],
    missing: null,
  },
  {
    name: "MAIL_TO",
    /* Secret-side deliberately, though it is not a credential: it is a private
       individual's inbox and this repository is public. */
    kind: "secret",
    targets: PROD_PREVIEW,
    required: false,
    section: "Email",
    example: "someone@gmail.com",
    summary:
      "The human inbox. Enquiry notifications and mail forwarded from the shop address both land here, so there is one place to read rather than two.",
    detail: [
      "A plain Gmail address is right: it is never shown to a customer.",
      "",
      "The notification carries the subject, a one-line summary and a LINK into",
      "the panel - never the customer's phone number or email. Those live in the",
      "record, behind the panel's password, which is the access control the log",
      "sink's comment always assumed and could not point at until there was a",
      "panel. See src/lib/mail/notify-sink.ts.",
      "",
      "Kept out of this repository rather than committed to the manifest,",
      "because it is a person's inbox and the repository is public.",
    ],
    missing: {
      level: "warning",
      message:
        "With no recipient, notifications fall back to the log sink even when RESEND_API_KEY is set. Nothing is lost - the record is in the panel - but nobody is told it arrived.",
    },
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    kind: "secret",
    targets: ["production"],
    required: false,
    section: "Email",
    example: "whsec_xxxxxxxxxxxx",
    summary:
      "Verifies the email.received webhook at /api/inbound, which records mail to the shop address in the admin mailbox and forwards a copy to MAIL_TO.",
    detail: [
      "Sending and receiving are independent: sending needs SPF/DKIM, receiving",
      "needs MX, and whoever holds the MX record owns the inbox.",
      "",
      "Resend does not forward mail on its own - it stores the message and posts",
      "an email.received webhook. src/app/api/inbound/route.ts is that endpoint;",
      "src/lib/mail/inbound.ts records the message FIRST and then re-sends a copy",
      "to MAIL_TO with the original sender as Reply-To.",
      "",
      "Recording first is the part that matters. The forward is a notification;",
      "the record is what makes the conversation answerable AS the shop from",
      "/admin/poshta - which a reply pressed in Gmail can never be, because it",
      "leaves as the Gmail address.",
      "",
      "To finish the wiring: Resend dashboard -> Webhooks -> add",
      "https://<domain>/api/inbound, subscribe to email.received ONLY, and paste",
      "the signing secret here. Without it the endpoint refuses every request.",
    ],
    missing: null, // cross-check: only interesting once RESEND_API_KEY is set
  },

  /* -- Admin -------------------------------------------------------------- */
  {
    name: "ADMIN_PASSWORD",
    kind: "secret",
    targets: ["production"],
    required: false,
    section: "Admin",
    summary:
      "Enables the admin panel at /admin. With none set the panel is DISABLED rather than defaulted.",
    detail: [
      "A shipped default password is worse than no admin at all. This panel reads",
      "every customer's phone number and can send mail over the shop's own DKIM",
      "signature.",
      "",
      "Until it is set, the order enquiries and contact messages this site has",
      "been collecting since launch remain unreadable from the application - which",
      "was the state before the panel existed, and is not a state to leave it in.",
    ],
    validate: (v) =>
      v.length < 12
        ? {
            level: "warning",
            message: `Only ${v.length} characters. This is the single credential protecting every customer's contact details and the ability to send mail as the shop, on a public URL with no rate limit on the login. Use a passphrase.`,
          }
        : null,
    missing: {
      level: "warning",
      message:
        "The admin panel is disabled, so nothing can read the order enquiries and contact messages the forms are still writing.",
    },
  },
  {
    name: "ADMIN_SESSION_SECRET",
    kind: "secret",
    targets: ["production"],
    required: false,
    section: "Admin",
    example: "openssl rand -hex 32",
    summary:
      "Signs the admin session cookie. Falls back to ADMIN_PASSWORD, which couples password rotation to signing everyone out.",
    detail: [
      "Optional, but set it separately so changing the password does not have to",
      "invalidate every session.",
    ],
    missing: null, // handled as a cross-check, since it depends on ADMIN_PASSWORD
  },

  /* -- Optional ----------------------------------------------------------- */
  {
    name: "DATABASE_POOL_MAX",
    kind: "config",
    /* Not committed: the code default is already host-aware. */
    targets: [],
    required: false,
    section: "Optional",
    example: "2",
    summary:
      "Connection pool size, per process. Defaults to 2 on Vercel and 10 elsewhere; set it only to override.",
    detail: [
      "On a long-running server one process serves many concurrent requests, so",
      "10 is right. On Vercel every concurrent function instance is its own",
      "process with its own pool, so 10 quietly becomes 10 x N against a database",
      "that will not have that many connections. Raise it only when pointing at a",
      "pooler that can take more.",
    ],
    validate: (v) =>
      !Number.isFinite(Number.parseInt(v, 10)) || Number.parseInt(v, 10) < 1
        ? { level: "error", message: "Not a positive integer." }
        : null,
    missing: null,
  },
  {
    name: "NEXT_PUBLIC_ENVIRONMENT",
    kind: "config",
    /* Deliberately no targets: on Vercel this must stay unset. */
    targets: [],
    required: false,
    section: "Optional",
    example: "production",
    summary:
      "robots.txt gate for hosts that announce no environment of their own. LEAVE UNSET on Vercel, where VERCEL_ENV takes precedence.",
    detail: [
      'Anything other than the exact string "production" makes robots.txt',
      "disallow everything, which is what keeps a staging deployment out of",
      "search results - and what makes a typo here a total deindex.",
      "",
      "Declared with no Vercel targets on purpose, so this tool will never set",
      "it there.",
    ],
    missing: null,
  },

  /* -- Supplied by the platform ------------------------------------------- */
  {
    name: "VERCEL_ENV",
    kind: "system",
    section: "Platform",
    summary:
      'robots.txt reads this first and allows crawling only when it is "production", so previews are blocked with nothing to configure.',
  },
  {
    name: "VERCEL",
    kind: "system",
    section: "Platform",
    summary: "Set on every Vercel runtime. Selects the serverless default for DATABASE_POOL_MAX.",
  },
  {
    name: "NODE_ENV",
    kind: "system",
    section: "Platform",
    summary:
      "Last-resort signal for robots.txt when neither VERCEL_ENV nor NEXT_PUBLIC_ENVIRONMENT is present.",
  },
];

export const crossChecks = [
  /**
   * Which notification sink `notifications.ts` will actually pick.
   *
   * Both halves or neither, and the failure this catches is specifically an
   * API key set without a recipient: everything looks configured, `notify()`
   * reports no error, and every enquiry goes to a log line on a serverless host
   * nobody reads.
   */
  ({ has }) => {
    const key = has("RESEND_API_KEY");
    const to = has("MAIL_TO");
    if (key && to)
      return {
        level: "ok",
        title: "Notifications",
        message: "emailed to MAIL_TO, with a link into the panel.",
      };
    if (key !== to)
      return {
        level: "warning",
        title: "Email notifications are half-configured",
        message: key
          ? "RESEND_API_KEY is set but MAIL_TO is not, so notifications fall back to the log sink. The admin panel can still send replies."
          : "MAIL_TO is set but RESEND_API_KEY is not, so nothing can be sent to it. Notifications fall back to the log sink.",
      };
    return {
      level: "note",
      title: "Notifications",
      message:
        "not configured - a redacted line goes to the server log and the record waits in the panel.",
    };
  },

  ({ has }) =>
    has("RESEND_API_KEY") && !has("RESEND_WEBHOOK_SECRET")
      ? {
          level: "note",
          title: "RESEND_WEBHOOK_SECRET is not set",
          message:
            "/api/inbound refuses every request without it, so mail to the shop address is neither recorded in /admin/poshta nor forwarded. Outbound mail is unaffected. Receiving also needs an MX record, which no code here can check.",
        }
      : null,

  ({ has }) =>
    has("ADMIN_PASSWORD") && !has("ADMIN_SESSION_SECRET")
      ? {
          level: "warning",
          title: "ADMIN_SESSION_SECRET is not set",
          message:
            "It falls back to ADMIN_PASSWORD, so rotating the password signs everyone out. Set it separately to decouple the two.",
        }
      : null,

  /* Mirrors robots.ts exactly, including precedence, so the report cannot
     disagree with the file it is reporting on. */
  ({ has, value, hostEnv }) => {
    const explicit = value("NEXT_PUBLIC_ENVIRONMENT");
    const isProduction = hostEnv
      ? hostEnv === "production"
      : explicit === "production" ||
        (process.env.NODE_ENV === "production" && explicit === undefined);

    const verdict = isProduction ? "allows crawling" : "disallows everything";

    if (hostEnv) {
      return {
        level: "ok",
        title: "robots.txt",
        message: `VERCEL_ENV=${hostEnv}, so robots.txt ${verdict}. NEXT_PUBLIC_ENVIRONMENT is ignored here.`,
      };
    }
    if (!has("NEXT_PUBLIC_ENVIRONMENT")) {
      return {
        level: "note",
        title: "robots.txt",
        message: `No VERCEL_ENV and no NEXT_PUBLIC_ENVIRONMENT, so it falls back to NODE_ENV: ${verdict}.`,
      };
    }
    if (!isProduction) {
      return {
        level: "warning",
        title: `NEXT_PUBLIC_ENVIRONMENT is "${explicit}", not "production"`,
        message:
          "The comparison is exact, and anything else makes robots.txt disallow the entire site. If this is the live deployment, that is a total deindex.",
      };
    }
    return { level: "ok", title: "robots.txt", message: "allows crawling" };
  },

  ({ has, hostEnv }) =>
    hostEnv && has("NEXT_PUBLIC_ENVIRONMENT")
      ? {
          level: "warning",
          title: "NEXT_PUBLIC_ENVIRONMENT is set on Vercel",
          message:
            "VERCEL_ENV takes precedence, so this does nothing. Worth removing: it reads as if it were in control.",
        }
      : null,

  ({ value, onServerless }) => {
    const raw = value("DATABASE_POOL_MAX");
    if (!raw || !onServerless) return null;
    const max = Number.parseInt(raw, 10);
    return Number.isFinite(max) && max > 5
      ? {
          level: "warning",
          title: `DATABASE_POOL_MAX is ${max} on a serverless host`,
          message:
            "Every concurrent function instance is its own process with its own pool, so this is the per-instance figure. Use a pooled endpoint, or a small number here.",
        }
      : null;
  },
];
