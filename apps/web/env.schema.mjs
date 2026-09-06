/**
 * Storefront environment manifest. Read by scripts/env-check, env-push and
 * env-example, so .env.example and the deployed configuration cannot drift.
 *
 *   kind: config   not secret; may carry a committed `value`, pushed as plain
 *         secret   never committed; value comes from .env, pushed encrypted
 *         system   set by the platform; documented only
 *         local    development only, never pushed
 *
 *   fromEnv   a config var whose local value is also the production one.
 *             Without it a config var is NOT deployed from .env - this app is
 *             why: its .env.local holds NEXT_PUBLIC_SITE_URL=localhost:3000.
 *
 * The catalog sync job is configured separately and validates itself through
 * loadConfig in packages/scraper-core; it is a Lambda, not a Vercel deploy.
 */

export const project = {
  vercelName: "buy-a-coffee",
  gitRepository: { type: "github", repo: "bojidaryovchev/buy-a-coffee" },
  framework: "nextjs",
  rootDirectory: "apps/web",
};

const PROD = ["production"];
const PROD_PREVIEW = ["production", "preview"];

export const vars = [
  {
    name: "DATABASE_URL",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: "always",
    section: "Required",
    example: "postgres://catalog:catalog@localhost:5433/catalog",
    summary:
      "The catalog database written by the sync job. Read through server-only, so it never reaches the browser.",
    validate: (v) =>
      !/^postgres(ql)?:\/\//i.test(v) ? { level: "error", message: "Not a PostgreSQL URL." } : null,
    missing: { level: "error", message: "The storefront reads its whole catalog from this." },
  },
  {
    name: "NEXT_PUBLIC_SITE_URL",
    kind: "config",
    // No committed value: no production domain yet. Add one here when there is.
    // Deliberately not read from .env, which holds localhost.
    targets: PROD_PREVIEW,
    required: "always",
    section: "Required",
    example: "https://buy-a-coffee.example",
    summary: "Absolute site URL for canonicals, Open Graph, the sitemap and structured data.",
    validate: (v) => (!/^https?:\/\//.test(v) ? { level: "error", message: "Must be absolute." } : null),
    missing: { level: "error", message: "Falls back to http://localhost:3000, wrong everywhere but a laptop." },
  },
  {
    name: "RATE_LIMIT_SALT",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: "production",
    section: "Required",
    example: "openssl rand -hex 32",
    summary: "Salts the hashed client fingerprint used by rate limiting. The raw IP is never stored.",
    detail: ["Rate limiting keeps working without it, so nothing tells you the fingerprint is predictable."],
    validate: (v) => (v.length < 16 ? { level: "warning", message: `Only ${v.length} characters.` } : null),
    missing: {
      level: "error",
      message: "Falls back to a public default, so the fingerprint is predictable across deployments.",
      levelWhenLocal: "note",
      messageWhenLocal: "Uses a public default salt. Fine locally.",
    },
  },

  {
    name: "NEXT_PUBLIC_IMAGE_BASE_URL",
    kind: "config",
    // From Terraform's image_public_base_url output; differs per environment.
    targets: PROD_PREVIEW,
    required: false,
    section: "Images",
    example: "https://d111111abcdef8.cloudfront.net",
    summary: "CDN base for mirrored product images. Required on any host without a persistent disk.",
    detail: [
      "Also read at BUILD time to build images.remotePatterns, so a change needs a redeploy.",
      "Must match STORAGE_PUBLIC_BASE_URL on the scraper side.",
    ],
    validate: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return { level: "error", message: "Not a valid URL - next.config.ts then allows NO remote images." };
      }
    },
    missing: {
      level: "error",
      message: "Images fall back to local disk, which does not exist here. Every product image will 404.",
      levelWhenLocal: "note",
      messageWhenLocal: "Images are served from STORAGE_LOCAL_DIR via /media. Correct for development.",
    },
  },
  {
    name: "STORAGE_LOCAL_DIR",
    kind: "local",
    section: "Images",
    example: "../../.storage",
    summary: "Where the sync wrote images under STORAGE_DRIVER=local. Resolved from the app directory.",
  },

  {
    name: "ADMIN_PASSWORD",
    kind: "secret",
    targets: PROD,
    required: "production",
    section: "Admin",
    summary: "Enables the admin panel. Unset means the panel is disabled, not defaulted.",
    validate: (v) =>
      v.length < 12
        ? { level: "warning", message: `Only ${v.length} characters, on a public URL. Use a passphrase.` }
        : null,
    missing: { level: "note", message: "Admin panel disabled - the safe default." },
  },
  {
    name: "ADMIN_SESSION_SECRET",
    kind: "secret",
    targets: PROD,
    required: false,
    section: "Admin",
    example: "openssl rand -hex 32",
    summary: "Signs the admin session cookie. Falls back to ADMIN_PASSWORD, coupling rotation to sign-out.",
    missing: null,
  },

  {
    name: "RESEND_API_KEY",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: false,
    section: "Email",
    example: "re_xxxxxxxxxxxxxxxxxxxx",
    summary: "Sends order notifications, admin mailbox replies and inbound forwards.",
    missing: { level: "warning", message: "Mail is logged to the console instead of sent." },
  },
  {
    name: "MAIL_FROM",
    kind: "config",
    targets: [],
    required: false,
    section: "Email",
    summary: "Sender override. Set it on staging so previews do not send as the live brand.",
    missing: null,
  },
  {
    name: "MAIL_TO",
    // A person's inbox, and this repository is public.
    kind: "secret",
    targets: PROD_PREVIEW,
    required: false,
    section: "Email",
    example: "someone@gmail.com",
    summary: "Where order notifications land. Without it, notifications are disabled.",
    missing: { level: "warning", message: "Notifications disabled - orders persist but nobody is told." },
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    kind: "secret",
    targets: PROD,
    required: false,
    section: "Email",
    example: "whsec_xxxxxxxxxxxx",
    summary: "Verifies the email.received webhook, which forwards inbound mail to MAIL_TO.",
    missing: null,
  },

  {
    name: "DATABASE_POOL_MAX",
    kind: "config",
    targets: [],
    required: false,
    section: "Optional",
    example: "2",
    summary: "Pool size per process. Defaults to 2 on Vercel and 10 elsewhere; set only to override.",
    detail: ["Each serverless instance is its own process with its own pool, so 10 becomes 10 x N."],
    validate: (v) =>
      !Number.isFinite(Number.parseInt(v, 10)) || Number.parseInt(v, 10) < 1
        ? { level: "error", message: "Not a positive integer." }
        : null,
    missing: null,
  },
  {
    name: "NEXT_PUBLIC_ENVIRONMENT",
    kind: "config",
    // No targets on purpose: on Vercel this must stay unset, because VERCEL_ENV
    // takes precedence and anything but "production" disallows the whole site.
    targets: [],
    required: false,
    section: "Optional",
    example: "production",
    summary: "robots.txt gate for hosts that announce no environment. Leave unset on Vercel.",
    missing: null,
  },

  { name: "VERCEL_ENV", kind: "system", section: "Platform", summary: 'robots.txt allows crawling only when this is "production".' },
  { name: "VERCEL", kind: "system", section: "Platform", summary: "Set on every Vercel runtime; selects the serverless pool default." },
  { name: "NODE_ENV", kind: "system", section: "Platform", summary: "Last-resort robots.txt signal; also sets `secure` on the session cookie." },
];

export const crossChecks = [
  /* Mirrors robots.ts precedence exactly, so the report cannot disagree with
     the file it reports on. */
  ({ has, value, hostEnv }) => {
    const explicit = value("NEXT_PUBLIC_ENVIRONMENT");
    const isProduction = hostEnv
      ? hostEnv === "production"
      : explicit === "production" ||
        (process.env.NODE_ENV === "production" && explicit === undefined);
    const verdict = isProduction ? "allows crawling" : "disallows everything";

    if (hostEnv)
      return { level: "ok", title: "robots.txt", message: `VERCEL_ENV=${hostEnv}, so it ${verdict}.` };
    if (!has("NEXT_PUBLIC_ENVIRONMENT"))
      return { level: "note", title: "robots.txt", message: `Falls back to NODE_ENV: ${verdict}.` };
    if (!isProduction)
      return {
        level: "warning",
        title: `NEXT_PUBLIC_ENVIRONMENT is "${explicit}", not "production"`,
        message: "The comparison is exact, and anything else disallows the entire site.",
      };
    return { level: "ok", title: "robots.txt", message: "allows crawling" };
  },

  ({ has, hostEnv }) =>
    hostEnv && has("NEXT_PUBLIC_ENVIRONMENT")
      ? {
          level: "warning",
          title: "NEXT_PUBLIC_ENVIRONMENT is set on Vercel",
          message: "VERCEL_ENV takes precedence, so it does nothing. Worth removing.",
        }
      : null,

  ({ has }) =>
    has("ADMIN_PASSWORD") && !has("ADMIN_SESSION_SECRET")
      ? {
          level: "note",
          title: "ADMIN_SESSION_SECRET is not set",
          message: "Falls back to ADMIN_PASSWORD, so rotating the password signs everyone out.",
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
          message: "That is the per-instance figure. Use a pooled endpoint or a smaller number.",
        }
      : null;
  },
];
