import {
  type Logger,
  normalizeHtmlForHash,
  retry,
  sha256Hex,
  silentLogger,
  sleep,
} from "@catalog/shared";
import type { ScraperConfig } from "../config.ts";
import { ALLOW_ALL, type RobotsTxt, isUrlAllowed, parseRobotsTxt } from "./robots.ts";

export type FetchOutcome =
  | "ok"
  | "soft_404"
  | "http_error"
  | "network_error"
  | "blocked_by_robots"
  | "too_large"
  | "unsupported_content_type";

export interface FetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly outcome: FetchOutcome;
  readonly statusCode: number | null;
  readonly contentType: string | null;
  readonly body: string;
  readonly bytes: number;
  /** Hash of normalised HTML: stable across Cloudflare's rotating tokens. */
  readonly contentHash: string;
  readonly redirected: boolean;
  readonly durationMs: number;
  readonly attempts: number;
  readonly error?: { name: string; message: string } | undefined;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
  }
}

export class BodyTooLargeError extends Error {
  constructor(
    readonly limit: number,
    readonly url: string,
  ) {
    super(`Response body exceeded ${limit} bytes for ${url}`);
    this.name = "BodyTooLargeError";
  }
}

/** 5xx, 408 and 429 are worth retrying; other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpStatusError) return isRetryableStatus(error.status);
  if (error instanceof BodyTooLargeError) return false;
  if (error instanceof Error && error.name === "AbortError") return true;
  return true;
}

export interface FetcherOptions {
  readonly config: ScraperConfig;
  readonly logger?: Logger;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

/**
 * Polite HTTP client.
 *
 * Responsibilities kept deliberately narrow: rate limiting, retries with
 * jittered backoff, bounded bodies, robots.txt, and soft-404 recognition.
 * Everything about *meaning* belongs to the parsers.
 */
export class Fetcher {
  private readonly config: ScraperConfig;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  private robots: RobotsTxt = ALLOW_ALL;
  private robotsLoaded = false;
  private robotsCrawlDelayMs = 0;

  /**
   * The normalised hash of the site's shell page. Any non-root URL whose body
   * hashes to this value is a soft 404 — this site answers unknown routes with
   * HTTP 200 and the homepage.
   */
  private shellHash: string | null = null;
  private shellTitle: string | null = null;

  /** Serialises the minimum-delay gate so concurrent workers stay polite. */
  private nextSlotAt = 0;

  private stats = { requests: 0, retries: 0, bytes: 0, soft404s: 0 };

  constructor(options: FetcherOptions) {
    this.config = options.config;
    this.logger = options.logger ?? silentLogger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The transport this fetcher uses.
   *
   * Image mirroring must go through the same implementation as page fetching,
   * otherwise an injected transport (tests, or a future proxy) would silently
   * apply to pages only.
   */
  getFetchImpl(): typeof fetch {
    return this.fetchImpl;
  }

  getStats(): Readonly<{ requests: number; retries: number; bytes: number; soft404s: number }> {
    return { ...this.stats };
  }

  getSitemapUrls(): string[] {
    return [...this.robots.sitemaps];
  }

  getShellHash(): string | null {
    return this.shellHash;
  }

  /** Fetch and parse robots.txt once per process. Failure means "allow all". */
  async loadRobots(): Promise<RobotsTxt> {
    if (this.robotsLoaded) return this.robots;
    this.robotsLoaded = true;
    if (!this.config.respectRobotsTxt) return this.robots;

    const robotsUrl = new URL("/robots.txt", this.config.baseUrl).toString();
    try {
      const result = await this.request(robotsUrl, { skipRobots: true, expectHtml: false });
      if (result.outcome === "ok" && result.body) {
        this.robots = parseRobotsTxt(result.body);
        const group = this.robots.groups.find((g) => g.agents.includes("*"));
        const delay = group?.crawlDelaySeconds;
        if (delay && delay > 0) {
          this.robotsCrawlDelayMs = Math.round(delay * 1000);
          this.logger.info("robots.crawl_delay_applied", { crawlDelaySeconds: delay });
        }
        this.logger.info("robots.loaded", {
          groups: this.robots.groups.length,
          sitemaps: this.robots.sitemaps.length,
        });
      }
    } catch (error) {
      this.logger.warn("robots.load_failed", { error });
    }
    return this.robots;
  }

  /**
   * Establish what the site's "page not found" body looks like.
   *
   * Without this the crawler would treat 111 stale sitemap URLs as real
   * products, because every one of them returns HTTP 200.
   */
  async calibrateSoft404(): Promise<{ shellHash: string | null; shellTitle: string | null }> {
    if (this.shellHash) return { shellHash: this.shellHash, shellTitle: this.shellTitle };

    // A path that cannot plausibly exist. If it returns a body, that body is
    // the site's not-found representation.
    const probePath = `/__catalog-sync-probe-${sha256Hex(this.config.baseUrl).slice(0, 12)}/`;
    const probeUrl = new URL(probePath, this.config.baseUrl).toString();
    const probe = await this.request(probeUrl, { skipRobots: true, skipSoft404: true });

    if (probe.outcome === "ok" && probe.body) {
      this.shellHash = probe.contentHash;
      this.shellTitle = extractTitle(probe.body);
      this.logger.info("soft404.calibrated", {
        shellHash: this.shellHash.slice(0, 16),
        shellTitle: this.shellTitle,
        statusCode: probe.statusCode,
      });
    } else {
      this.logger.info("soft404.not_applicable", { outcome: probe.outcome });
    }
    return { shellHash: this.shellHash, shellTitle: this.shellTitle };
  }

  /** True when a body is the site's soft-404 shell rather than real content. */
  isSoft404(url: string, contentHash: string, body: string): boolean {
    if (!this.shellHash) return false;
    const path = safePath(url);
    // The homepage legitimately *is* the shell.
    if (path === "/") return false;
    if (contentHash === this.shellHash) return true;
    // Secondary signal: same title as the shell. Catches shells that carry a
    // little per-response variation the hash cannot absorb.
    return this.shellTitle !== null && extractTitle(body) === this.shellTitle;
  }

  async get(url: string): Promise<FetchResult> {
    return this.request(url, {});
  }

  private async request(
    url: string,
    options: { skipRobots?: boolean; skipSoft404?: boolean; expectHtml?: boolean },
  ): Promise<FetchResult> {
    const startedAt = this.now();

    if (!options.skipRobots && this.config.respectRobotsTxt) {
      await this.loadRobots();
      if (!isUrlAllowed(this.robots, this.config.userAgent, url)) {
        this.logger.info("fetch.blocked_by_robots", { url });
        return this.emptyResult(url, "blocked_by_robots", startedAt, 1);
      }
    }

    let attempts = 0;
    try {
      const response = await retry(
        async (attempt) => {
          attempts = attempt + 1;
          await this.waitForSlot();
          return this.performRequest(url);
        },
        {
          attempts: this.config.maxRetries + 1,
          baseDelayMs: this.config.retryBaseDelayMs,
          maxDelayMs: this.config.retryMaxDelayMs,
          isRetryable: isRetryableError,
          onRetry: ({ attempt, delayMs, error }) => {
            this.stats.retries += 1;
            this.logger.warn("fetch.retry", { url, attempt, delayMs, error });
          },
        },
      );

      const contentHash = sha256Hex(normalizeHtmlForHash(response.body));
      const soft404 =
        options.skipSoft404 !== true && this.isSoft404(url, contentHash, response.body);
      if (soft404) this.stats.soft404s += 1;

      return {
        url,
        finalUrl: response.finalUrl,
        outcome: soft404 ? "soft_404" : "ok",
        statusCode: response.status,
        contentType: response.contentType,
        body: response.body,
        bytes: response.bytes,
        contentHash,
        redirected: response.finalUrl !== url,
        durationMs: this.now() - startedAt,
        attempts,
      };
    } catch (error) {
      const outcome: FetchOutcome =
        error instanceof HttpStatusError
          ? "http_error"
          : error instanceof BodyTooLargeError
            ? "too_large"
            : "network_error";
      const statusCode = error instanceof HttpStatusError ? error.status : null;
      this.logger.warn("fetch.failed", { url, outcome, statusCode, attempts, error });
      return {
        ...this.emptyResult(url, outcome, startedAt, attempts),
        statusCode,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private emptyResult(
    url: string,
    outcome: FetchOutcome,
    startedAt: number,
    attempts: number,
  ): FetchResult {
    return {
      url,
      finalUrl: url,
      outcome,
      statusCode: null,
      contentType: null,
      body: "",
      bytes: 0,
      contentHash: "",
      redirected: false,
      durationMs: this.now() - startedAt,
      attempts,
      error: undefined,
    };
  }

  /** Space requests at least `minDelayMs` apart across all workers. */
  private async waitForSlot(): Promise<void> {
    const spacing = Math.max(this.config.minDelayMs, this.robotsCrawlDelayMs);
    if (spacing <= 0) return;
    const now = this.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + spacing;
    const waitMs = slot - now;
    if (waitMs > 0) await sleep(waitMs);
  }

  private async performRequest(url: string): Promise<{
    finalUrl: string;
    status: number;
    contentType: string | null;
    body: string;
    bytes: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    this.stats.requests += 1;

    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": this.config.userAgent,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "bg-BG,bg;q=0.9,en;q=0.8",
        },
      });

      if (!response.ok) throw new HttpStatusError(response.status, url);

      const contentType = response.headers.get("content-type");
      const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declaredLength) && declaredLength > this.config.maxBodyBytes) {
        throw new BodyTooLargeError(this.config.maxBodyBytes, url);
      }

      const body = await this.readBounded(response, url);
      const bytes = Buffer.byteLength(body, "utf8");
      this.stats.bytes += bytes;

      return {
        finalUrl: response.url || url,
        status: response.status,
        contentType,
        body,
        bytes,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read the body while enforcing the size limit as bytes arrive, so a
   * hostile or accidental multi-gigabyte response cannot exhaust memory even
   * when `content-length` is absent or lies.
   */
  private async readBounded(response: Response, url: string): Promise<string> {
    if (!response.body) return response.text();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > this.config.maxBodyBytes) {
          await reader.cancel().catch(() => {});
          throw new BodyTooLargeError(this.config.maxBodyBytes, url);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? match[1].trim() : null;
}
