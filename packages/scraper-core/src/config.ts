import { z } from "zod";

/**
 * All tunables live here and are read from the environment, so the CLI and the
 * Lambda are configured identically and there is exactly one place to look
 * when behaviour needs to change.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
  );

const intFromEnv = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const floatFromEnv = (min: number, max: number, fallback: number) =>
  z.coerce.number().min(min).max(max).default(fallback);

export const configSchema = z.object({
  /** Identity of the reference site. */
  sourceKey: z.string().min(1).default("kafezona"),
  sourceName: z.string().min(1).default("KafeZona"),
  baseUrl: z.string().url().default("https://www.kafezona.com/"),
  canonicalHost: z.string().min(1).default("www.kafezona.com"),
  hostAliases: z.array(z.string()).default(["kafezona.com"]),

  /**
   * Politeness. Defaults are deliberately gentle: the catalog is ~110 products
   * on a small storefront, so there is nothing to gain from being aggressive.
   */
  concurrency: intFromEnv(1, 16, 4),
  timeoutMs: intFromEnv(1_000, 120_000, 15_000),
  maxRetries: intFromEnv(0, 10, 3),
  minDelayMs: intFromEnv(0, 10_000, 100),
  retryBaseDelayMs: intFromEnv(50, 30_000, 500),
  retryMaxDelayMs: intFromEnv(100, 120_000, 10_000),
  maxRedirects: intFromEnv(0, 20, 5),
  maxBodyBytes: intFromEnv(1_024, 50 * 1024 * 1024, 5 * 1024 * 1024),
  userAgent: z
    .string()
    .min(1)
    .default(
      "KafeZonaCatalogSync/0.1 (+catalog synchronisation for an authorised reseller; contact: ops@example.com)",
    ),

  /** Crawl bounds. */
  maxPages: intFromEnv(1, 100_000, 2_000),
  maxDepth: intFromEnv(1, 50, 8),
  respectRobotsTxt: booleanish.default(true),

  /** Reconciliation. */
  missingThreshold: intFromEnv(1, 20, 3),

  /**
   * Circuit breaker. `maxDisappearedRatio` is the fraction of previously
   * active products that may vanish in one run before the diff is refused.
   */
  breakerMaxDisappearedRatio: floatFromEnv(0.01, 1, 0.2),
  breakerMinDiscoveredRatio: floatFromEnv(0, 1, 0.75),
  breakerMinAbsoluteProducts: intFromEnv(0, 100_000, 10),
  breakerMinParserConfidence: floatFromEnv(0, 1, 0.6),

  /** Image mirroring. */
  imagesEnabled: booleanish.default(true),
  imageConcurrency: intFromEnv(1, 16, 4),
  imageMaxBytes: intFromEnv(1_024, 50 * 1024 * 1024, 10 * 1024 * 1024),
  imageTimeoutMs: intFromEnv(1_000, 120_000, 20_000),
  /** Minimum spacing between image fetches; images bypass the page fetcher. */
  imageMinDelayMs: intFromEnv(0, 10_000, 50),

  /** Object storage. `local` keeps development free of AWS. */
  storageDriver: z.enum(["local", "s3"]).default("local"),
  storageLocalDir: z.string().default(".storage"),
  storagePublicBaseUrl: z.string().default(""),
  s3Bucket: z.string().default(""),
  s3Region: z.string().default("eu-central-1"),
  s3Prefix: z.string().default(""),

  /** Diagnostics. */
  snapshotsEnabled: booleanish.default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /** Artifact output. */
  referenceDir: z.string().default("reference"),
});

export type ScraperConfig = z.infer<typeof configSchema>;

const ENV_MAP: Readonly<Record<keyof ScraperConfig, string>> = {
  sourceKey: "SOURCE_KEY",
  sourceName: "SOURCE_NAME",
  baseUrl: "SOURCE_BASE_URL",
  canonicalHost: "SOURCE_CANONICAL_HOST",
  hostAliases: "SOURCE_HOST_ALIASES",
  concurrency: "CRAWL_CONCURRENCY",
  timeoutMs: "CRAWL_TIMEOUT_MS",
  maxRetries: "CRAWL_MAX_RETRIES",
  minDelayMs: "CRAWL_MIN_DELAY_MS",
  retryBaseDelayMs: "CRAWL_RETRY_BASE_DELAY_MS",
  retryMaxDelayMs: "CRAWL_RETRY_MAX_DELAY_MS",
  maxRedirects: "CRAWL_MAX_REDIRECTS",
  maxBodyBytes: "CRAWL_MAX_BODY_BYTES",
  userAgent: "CRAWL_USER_AGENT",
  maxPages: "CRAWL_MAX_PAGES",
  maxDepth: "CRAWL_MAX_DEPTH",
  respectRobotsTxt: "CRAWL_RESPECT_ROBOTS",
  missingThreshold: "SYNC_MISSING_THRESHOLD",
  breakerMaxDisappearedRatio: "SYNC_BREAKER_MAX_DISAPPEARED_RATIO",
  breakerMinDiscoveredRatio: "SYNC_BREAKER_MIN_DISCOVERED_RATIO",
  breakerMinAbsoluteProducts: "SYNC_BREAKER_MIN_ABSOLUTE_PRODUCTS",
  breakerMinParserConfidence: "SYNC_BREAKER_MIN_PARSER_CONFIDENCE",
  imagesEnabled: "IMAGES_ENABLED",
  imageConcurrency: "IMAGE_CONCURRENCY",
  imageMaxBytes: "IMAGE_MAX_BYTES",
  imageTimeoutMs: "IMAGE_TIMEOUT_MS",
  imageMinDelayMs: "IMAGE_MIN_DELAY_MS",
  storageDriver: "STORAGE_DRIVER",
  storageLocalDir: "STORAGE_LOCAL_DIR",
  storagePublicBaseUrl: "STORAGE_PUBLIC_BASE_URL",
  s3Bucket: "S3_BUCKET",
  s3Region: "AWS_REGION",
  s3Prefix: "S3_PREFIX",
  snapshotsEnabled: "SNAPSHOTS_ENABLED",
  logLevel: "LOG_LEVEL",
  referenceDir: "REFERENCE_DIR",
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Build config from the environment plus optional CLI overrides.
 * Throws with a readable message rather than failing deep inside a crawl.
 */
export function loadConfig(
  overrides: Partial<Record<keyof ScraperConfig, unknown>> = {},
  env: NodeJS.ProcessEnv = process.env,
): ScraperConfig {
  const raw: Record<string, unknown> = {};
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const value = env[envName];
    if (value === undefined || value === "") continue;
    raw[key] = key === "hostAliases" ? value.split(",").map((v) => v.trim()).filter(Boolean) : value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) raw[key] = value;
  }

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const key = String(issue.path[0] ?? "?");
        const envName = ENV_MAP[key as keyof ScraperConfig] ?? key;
        return `  ${envName}: ${issue.message}`;
      })
      .join("\n");
    throw new ConfigError(`Invalid scraper configuration:\n${detail}`);
  }

  const config = parsed.data;
  if (config.storageDriver === "s3" && !config.s3Bucket) {
    throw new ConfigError("STORAGE_DRIVER=s3 requires S3_BUCKET to be set.");
  }
  if (config.retryMaxDelayMs < config.retryBaseDelayMs) {
    throw new ConfigError(
      "CRAWL_RETRY_MAX_DELAY_MS must be greater than or equal to CRAWL_RETRY_BASE_DELAY_MS.",
    );
  }
  return config;
}
