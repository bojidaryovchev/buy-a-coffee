/**
 * Storefront environment manifest. Read by scripts/env-check, env-push and
 * env-example, so .env.example and the deployed configuration cannot drift.
 *
 *   kind: config   not secret; may carry a committed `value`, pushed as plain
 *         secret   never committed; value comes from .env, pushed sensitive
 *         system   set by the platform; documented only
 *         local    development only, never pushed
 *
 *   deployOnly  a config var whose committed value is only what env:push
 *             deploys; env:check does not let it stand in for an unset one.
 *
 *   fromEnv   a config var whose local value is also the production one.
 *             Without it a config var is NOT deployed from .env - this app is
 *             why: its .env.local holds NEXT_PUBLIC_SITE_URL=localhost:3000.
 *
 * The catalog sync job is configured separately and validates itself through
 * loadConfig in packages/scraper-core; it runs as a GitHub Actions workflow
 * (.github/workflows/sync.yml), not a Vercel deploy.
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
    // Production ONLY. Previews read the Neon branch `preview` (a copy of
    // production taken at launch, reset from it when it drifts), set by hand
    // as a separate Preview-only variable. A preview on the production
    // database would build against a schema it may be ahead of, and write its
    // test orders into the real ones.
    targets: PROD,
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
    // The production domain is https://buy-a-coffee.com, and it is committed
    // here. A `config` var is deployed from the manifest only (never from .env,
    // which holds localhost - see the header), and a public URL that already
    // ships in every canonical tag is not a secret, so committing it is both
    // safe and the only way env:push can set it at all.
    //
    // Production ONLY, on purpose. Previews live on their own *.vercel.app
    // hosts; handing them the production URL would point their canonicals,
    // Open Graph tags and sitemap at the live site. This tool pushes nothing
    // for previews and never deletes, so what a preview receives is unchanged
    // by this entry: leave the preview value to the dashboard, or add a
    // `preview` variant here if previews should carry one.
    value: "https://buy-a-coffee.com",
    targets: PROD,
    required: "always",
    section: "Required",
    example: "https://buy-a-coffee.com",
    summary: "Absolute site URL for canonicals, Open Graph, the sitemap and structured data.",
    validate: (v) =>
      !/^https?:\/\//.test(v) ? { level: "error", message: "Must be absolute." } : null,
    missing: {
      level: "error",
      message: "Falls back to http://localhost:3000, wrong everywhere but a laptop.",
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
      "Salts the hashed client fingerprint used by rate limiting. The raw IP is never stored.",
    detail: [
      "Rate limiting keeps working without it, so nothing tells you the fingerprint is predictable.",
    ],
    validate: (v) =>
      v.length < 16 ? { level: "warning", message: `Only ${v.length} characters.` } : null,
    missing: {
      level: "error",
      message:
        "Falls back to a public default, so the fingerprint is predictable across deployments.",
      levelWhenLocal: "note",
      messageWhenLocal: "Uses a public default salt. Fine locally.",
    },
  },

  {
    name: "NEXT_PUBLIC_IMAGE_BASE_URL",
    kind: "config",
    // The public origin of the Vercel Blob store `buy-a-coffee-images`
    // (store_J6XpMLtA50ZFDXEo, fra1). Public by nature - every product image
    // URL starts with it - so it is committed, like the site URL. Previews
    // share it: images are content-addressed and the store only ever grows.
    value: "https://j6xpmlta50zfdxeo.public.blob.vercel-storage.com",
    // What env:push deploys, not a default for a machine: env:check still
    // reports it missing where it is unset (see `resolve` in env-lib).
    deployOnly: true,
    targets: PROD_PREVIEW,
    required: "production",
    section: "Images",
    example: "https://d111111abcdef8.cloudfront.net",
    summary:
      "CDN base for mirrored product images. Required in production, which has no persistent disk.",
    detail: [
      "Also read at BUILD time to build images.remotePatterns, so a change needs a redeploy.",
      "Must match STORAGE_PUBLIC_BASE_URL on the scraper side.",
    ],
    validate: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return {
          level: "error",
          message: "Not a valid URL - next.config.ts then allows NO remote images.",
        };
      }
    },
    missing: {
      level: "error",
      message:
        "Images fall back to local disk, which a deployed host does not have. Every product image will 404.",
      levelWhenLocal: "note",
      messageWhenLocal:
        "Images are served from STORAGE_LOCAL_DIR via /media. Correct for development.",
    },
  },
  {
    name: "STORAGE_LOCAL_DIR",
    kind: "local",
    section: "Images",
    example: "../../.storage",
    summary:
      "Where the sync wrote images under STORAGE_DRIVER=local. Resolved from the app directory.",
  },

  /* Search engines. All three are public by design - a verification token is
     printed in every page's <head>, an IndexNow key is served at /<key>.txt -
     so they are config, pushed from .env, and production only: a preview must
     neither verify as the site nor ping search engines about its URLs. */
  {
    name: "GOOGLE_SITE_VERIFICATION",
    kind: "config",
    fromEnv: true,
    targets: PROD,
    required: false,
    section: "Search engines",
    example: "abc123DEF456_the-content-of-the-meta-tag",
    summary:
      'Google Search Console ownership token: the content="..." of the HTML-tag method. Printed as <meta name="google-site-verification"> only when set.',
    validate: (v) =>
      /[\s<>"]/.test(v)
        ? { level: "error", message: "Paste the token alone, not the whole meta tag." }
        : null,
    missing: {
      level: "note",
      message: "No Google verification tag. Verify by DNS instead, or set it.",
    },
  },
  {
    name: "BING_SITE_VERIFICATION",
    kind: "config",
    fromEnv: true,
    targets: PROD,
    required: false,
    section: "Search engines",
    example: "0123456789ABCDEF0123456789ABCDEF",
    summary:
      'Bing Webmaster Tools ownership token. Printed as <meta name="msvalidate.01"> only when set.',
    validate: (v) =>
      /[\s<>"]/.test(v)
        ? { level: "error", message: "Paste the token alone, not the whole meta tag." }
        : null,
    missing: { level: "note", message: "No Bing verification tag." },
  },
  {
    name: "INDEXNOW_KEY",
    kind: "config",
    fromEnv: true,
    targets: PROD,
    required: false,
    section: "Search engines",
    example: "openssl rand -hex 16",
    summary:
      "IndexNow key: served at /<key>.txt and sent with every URL submitted to api.indexnow.org (Bing, Yandex and others). Unset, nothing is served and nothing is submitted.",
    detail: [
      "The catalog sync runs on GitHub Actions and needs the same value there",
      "to submit changed product URLs (submitIndexNow in @catalog/shared/indexnow).",
    ],
    validate: (v) =>
      !/^[a-zA-Z0-9-]{8,128}$/.test(v)
        ? { level: "error", message: "8 to 128 characters of a-z, A-Z, 0-9 and dashes." }
        : null,
    missing: {
      level: "note",
      message: "IndexNow off: search engines learn of changes by crawling.",
    },
  },

  {
    name: "ADMIN_PASSWORD",
    kind: "secret",
    targets: PROD,
    required: "production",
    section: "Admin",
    summary: "Enables the admin panel. Unset means the panel is disabled, not defaulted.",
    // An error in production, where the panel sits on a public URL and a short
    // password is a guessable one; only a warning locally, where it is yours.
    // 6 is MIN_ADMIN_PASSWORD_LENGTH in src/lib/auth.ts, the owner's choice.
    validate: (v, { isProductionish } = {}) =>
      v.length < 6
        ? {
            level: isProductionish ? "error" : "warning",
            message: `Only ${v.length} characters, on a public URL. Use at least 6.`,
          }
        : null,
    missing: { level: "note", message: "Admin panel disabled - the safe default." },
  },
  {
    name: "ADMIN_SESSION_SECRET",
    kind: "secret",
    targets: PROD,
    required: "production",
    section: "Admin",
    example: "openssl rand -hex 32",
    summary:
      "Signs the admin session cookie. Required in production, and distinct from ADMIN_PASSWORD so rotating one does not sign out or expose the other.",
    missing: {
      level: "error",
      message:
        "Without it the session cookie is signed with ADMIN_PASSWORD, so the password doubles as a signing key and rotating it signs everyone out.",
      levelWhenLocal: "note",
      messageWhenLocal: "Falls back to ADMIN_PASSWORD. Fine locally; set it before deploying.",
    },
  },
  {
    name: "CRON_SECRET",
    kind: "secret",
    targets: PROD,
    required: "production",
    section: "Scheduled jobs",
    example: "openssl rand -hex 32",
    summary:
      "Authorises the scheduled routes under /api/cron/. Vercel sends it as a bearer token with each cron call; anything without it is refused.",
    validate: (v, { isProductionish } = {}) =>
      v.length < 32
        ? {
            level: isProductionish ? "error" : "warning",
            message: `Only ${v.length} characters; at least 32 are needed. Use openssl rand -hex 32.`,
          }
        : null,
    missing: {
      level: "error",
      message:
        "The scheduled routes cannot be told apart from anyone on the internet calling them.",
      levelWhenLocal: "note",
      messageWhenLocal: "Only needed to call /api/cron/ routes yourself. Set it before deploying.",
    },
  },
  {
    name: "REVALIDATE_SECRET",
    kind: "secret",
    targets: PROD,
    required: false,
    section: "Scheduled jobs",
    example: "openssl rand -hex 32",
    summary:
      "Authorises POST /api/revalidate, which the catalog sync, the copywriter and copy:apply call after a change, so the pages and the sitemap are redrawn at once.",
    detail: [
      "Its own secret, not CRON_SECRET: it also goes to GitHub Actions (the",
      "repository secret REVALIDATE_SECRET, the same value) and to the shell that",
      "runs copy:apply, and all it can do is refresh caches.",
    ],
    validate: (v, { isProductionish } = {}) =>
      v.length < 32
        ? {
            level: isProductionish ? "error" : "warning",
            message: `Only ${v.length} characters; at least 32 are needed. Use openssl rand -hex 32.`,
          }
        : !/^[\x21-\x7e]+$/.test(v)
          ? {
              level: "error",
              message: "Spaces or line breaks inside: the callers will not send it.",
            }
          : null,
    missing: {
      level: "warning",
      message:
        "/api/revalidate answers 404 and the sync and copy scripts skip it: pages catch up within 5 minutes, the sitemap within about 70.",
      levelWhenLocal: "note",
      messageWhenLocal: "Only needed to call /api/revalidate yourself.",
    },
  },

  {
    name: "RESEND_API_KEY",
    kind: "secret",
    targets: PROD_PREVIEW,
    required: false,
    section: "Email",
    example: "re_xxxxxxxxxxxxxxxxxxxx",
    summary:
      "Sends order notifications, admin mailbox replies, inbound forwards and the newsletter.",
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
    missing: {
      level: "warning",
      message: "Notifications disabled - orders persist but nobody is told.",
    },
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
    name: "RESEND_NEWSLETTER_SEGMENT_ID",
    kind: "config",
    fromEnv: true,
    // Production only: a preview deployment signing test addresses into the
    // live segment would put them in front of the next real broadcast.
    targets: PROD,
    required: false,
    section: "Newsletter",
    example: "00000000-0000-0000-0000-000000000000",
    summary:
      "Optional. A Resend segment every newsletter subscriber is also added to, as a record in Resend of who joined. Neither the sync nor the send needs it.",
    detail: [
      "Also create the contact property bac_unsubscribe_url (type string)",
      "under Audience -> Properties. Prefixed: properties are account-wide,",
      "shared with the other three sites.",
    ],
    missing: {
      level: "note",
      message: "Signups are stored and shown in the admin panel, but not added to Resend.",
    },
  },
  {
    name: "RESEND_NEWSLETTER_TOPIC_ID",
    kind: "config",
    fromEnv: true,
    // Production only, for the segment's reason.
    targets: PROD,
    required: false,
    section: "Newsletter",
    example: "00000000-0000-0000-0000-000000000000",
    summary:
      "This site's Resend topic. The copy of the list in Resend carries opt-in and opt-out on it, for buy-a-coffee alone: the account is shared by four sites, so the contact's own unsubscribed flag is never written. The newsletter is sent to the database's list and does not depend on it.",
    detail: [
      "Create it with default subscription Opt-out (fixed once created), so a",
      "contact counts only once this site has opted it in, and visibility",
      "Private, so the other sites' subscribers do not see it on Resend's",
      "preference page.",
    ],
    missing: {
      level: "note",
      message: "Signups are stored and shown in the admin panel, but not added to Resend.",
    },
  },
  {
    name: "RESEND_CONTACTS_WEBHOOK_SECRET",
    kind: "secret",
    targets: PROD,
    required: false,
    section: "Newsletter",
    example: "whsec_xxxxxxxxxxxx",
    summary:
      "Verifies the contact webhook at /api/resend/contacts, which records opt-outs of this site's topic made in Resend, account-wide unsubscribes, and permanent bounces and complaints of the newsletter. Not RESEND_WEBHOOK_SECRET, which is the inbound-mail endpoint's.",
    detail: [
      "Resend dashboard -> Webhooks -> add",
      "https://buy-a-coffee.com/api/resend/contacts, subscribed to",
      "contact.updated, contact.topics.updated, contact.deleted,",
      "email.bounced and email.complained.",
    ],
    missing: null,
  },
  {
    name: "BLOB_READ_WRITE_TOKEN",
    // Set by Vercel on a project the Blob store is connected to - the store that
    // already holds the product images - so nothing here pushes it.
    kind: "system",
    section: "Newsletter",
    summary:
      "Signs the admin's newsletter uploads (images and documents, under newsletter/ in the image store). Without it the composer cannot attach files; text-only newsletters still send.",
  },

  {
    name: "DATABASE_POOL_MAX",
    kind: "config",
    targets: [],
    required: false,
    section: "Optional",
    example: "2",
    summary:
      "Pool size per process. Defaults to 2 on Vercel and 10 elsewhere; set only to override.",
    detail: [
      "Each serverless instance is its own process with its own pool, so 10 becomes 10 x N.",
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
    // No targets on purpose: on Vercel this must stay unset, because VERCEL_ENV
    // takes precedence and anything but "production" disallows the whole site.
    targets: [],
    required: false,
    section: "Optional",
    example: "production",
    summary: "robots.txt gate for hosts that announce no environment. Leave unset on Vercel.",
    missing: null,
  },

  {
    name: "VERCEL_ENV",
    kind: "system",
    section: "Platform",
    summary: 'robots.txt allows crawling only when this is "production".',
  },
  {
    name: "VERCEL",
    kind: "system",
    section: "Platform",
    summary: "Set on every Vercel runtime; selects the serverless pool default.",
  },
  {
    name: "NODE_ENV",
    kind: "system",
    section: "Platform",
    summary: "Last-resort robots.txt signal; also sets `secure` on the session cookie.",
  },
];

/**
 * Names that exist on the hosting platform but that no code reads. Searching the
 * whole repository finds no reference to either, so `env:push -- --prune` calls
 * them safe to remove instead of merely "not in the manifest". Add a name here
 * only after that same search comes back empty; delete the entry once it has
 * been removed from the platform.
 */
export const retired = [
  {
    name: "NEXT_PUBLIC_SITE_INDEXABLE",
    why: "nothing reads it; robots.txt is decided by VERCEL_ENV / NEXT_PUBLIC_ENVIRONMENT",
  },
  {
    name: "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY",
    why: "nothing reads it; no page embeds a Google map",
  },
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
      return {
        level: "ok",
        title: "robots.txt",
        message: `VERCEL_ENV=${hostEnv}, so it ${verdict}.`,
      };
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

  /* The newsletter mirror into Resend (src/lib/newsletter/sync.ts) needs the
     topic and the key; the segment is optional. */
  ({ has }) => {
    const segment = has("RESEND_NEWSLETTER_SEGMENT_ID");
    const topic = has("RESEND_NEWSLETTER_TOPIC_ID");
    if (!segment && !topic) return null;
    if (segment && !topic)
      return {
        level: "warning",
        title: "Newsletter half-configured",
        message:
          "Segment without RESEND_NEWSLETTER_TOPIC_ID: nothing is synced, because opt-outs could only be written account-wide.",
      };
    if (!has("RESEND_API_KEY"))
      return {
        level: "warning",
        title: "Newsletter without RESEND_API_KEY",
        message: "Nothing reaches Resend; signups stay in the database only.",
      };
    if (!has("RESEND_CONTACTS_WEBHOOK_SECRET"))
      return {
        level: "note",
        title: "RESEND_CONTACTS_WEBHOOK_SECRET is not set",
        message:
          "Opt-outs made in Resend stop the mail but still show as active in the admin panel.",
      };
    return {
      level: "ok",
      title: "Newsletter",
      message: "topic, key and contact webhook present",
    };
  },
];
