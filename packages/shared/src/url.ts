/**
 * URL canonicalisation.
 *
 * Every rule here is calibrated against observed behaviour of the source site
 * (see docs/source-recon.md), not guessed:
 *
 *  - `/lavazza`  308-redirects to `/lavazza/`  -> directory paths keep a trailing slash
 *  - `kafezona.com` (apex) returns 522         -> the `www` host is the only working one
 *  - `http://`   301-redirects to `https://`   -> scheme is forced to https
 *  - `/LAVAZZA/` returns the soft-404 shell    -> paths are case-SENSITIVE, never lowercased
 *  - `/raztvorimo kafe/` and `/ vergnano/`     -> literal spaces must survive as %20
 */

/** Query parameters that never identify distinct content. */
export const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "wbraid", "gbraid", "msclkid", "yclid",
  "twclid", "ttclid", "igshid", "epik", "s_kwcid", "srsltid",
  "mc_cid", "mc_eid", "_ga", "_gl", "gad_source",
  "pk_campaign", "pk_kwd", "pk_source", "pk_medium",
  "piwik_campaign", "piwik_kwd", "matomo_campaign", "matomo_kwd",
  "vero_id", "vero_conv", "oly_anon_id", "oly_enc_id", "spm", "scm", "hsa_acc",
  "hsa_cam", "hsa_grp", "hsa_ad", "hsa_src", "hsa_tgt", "hsa_kw", "hsa_mt",
  "hsa_net", "hsa_ver", "ref_src", "ref_url", "cmpid", "campaignid", "adgroupid",
]);

export type UnknownParamPolicy = "drop" | "keep";

export interface CanonicalizeOptions {
  /** Absolute URL used to resolve relative references. */
  readonly base?: string | URL;
  /** The single host we consider canonical, e.g. `www.kafezona.com`. */
  readonly canonicalHost?: string;
  /** Hosts rewritten to `canonicalHost` (e.g. the apex domain). */
  readonly hostAliases?: readonly string[];
  /** Parameters that genuinely select different content. */
  readonly allowedParams?: readonly string[];
  /** Parameters whose comma-separated values are order-insensitive. */
  readonly multiValueParams?: readonly string[];
  /** Extra parameters to drop on top of {@link TRACKING_PARAMS}. */
  readonly dropParams?: readonly string[];
  /**
   * What to do with parameters that are neither allowed nor known tracking.
   * Defaults to `"drop"`: an open-ended query space is the classic way a
   * crawler wanders into an infinite URL set.
   */
  readonly unknownParams?: UnknownParamPolicy;
  /** Force https. Defaults to true. */
  readonly forceHttps?: boolean;
}

export interface CanonicalUrl {
  /** Fully canonical absolute URL. */
  readonly href: string;
  readonly origin: string;
  readonly host: string;
  readonly pathname: string;
  readonly search: string;
}

const DEFAULT_ALLOWED_PARAMS = ["q", "brand", "strength", "decaf", "aromas", "page", "sort"];
const DEFAULT_MULTI_VALUE_PARAMS = ["brand", "strength"];

/** True when the last path segment looks like a file (`/img/a.jpg`). */
export function looksLikeFilePath(pathname: string): boolean {
  const lastSegment = pathname.split("/").filter(Boolean).pop();
  if (!lastSegment) return false;
  return /\.[a-zA-Z0-9]{1,8}$/.test(lastSegment);
}

/**
 * Directory-style paths get exactly one trailing slash; file-style paths keep
 * their exact form. Matches the source site's 308 redirect behaviour, which
 * means canonical URLs can be fetched without an extra redirect hop.
 */
export function normalizePathname(
  pathname: string,
  options: { readonly addTrailingSlash?: boolean } = {},
): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  if (collapsed === "" || collapsed === "/") return "/";
  if (looksLikeFilePath(collapsed)) return collapsed.replace(/\/+$/, "");
  if (options.addTrailingSlash === false) return collapsed;
  return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

/**
 * Canonicalise a possibly-relative URL. Returns `null` for anything that is
 * not an http(s) resource we could crawl (mailto:, tel:, javascript:, data:,
 * fragment-only links, or malformed input).
 */
export function canonicalizeUrl(
  input: string,
  options: CanonicalizeOptions = {},
): CanonicalUrl | null {
  const raw = input?.trim();
  if (!raw) return null;
  // Fragment-only or empty anchors point at the current page.
  if (raw.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data|blob|ftp|sms|whatsapp|viber):/i.test(raw)) return null;

  let url: URL;
  try {
    url = options.base ? new URL(raw, options.base) : new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  if (options.forceHttps !== false) url.protocol = "https:";
  url.hash = "";
  url.username = "";
  url.password = "";
  url.port = "";

  // Host is case-insensitive by spec; WHATWG URL already lowercases it.
  const canonicalHost = options.canonicalHost;
  if (canonicalHost) {
    const aliases = new Set((options.hostAliases ?? []).map((h) => h.toLowerCase()));
    if (aliases.has(url.hostname)) url.hostname = canonicalHost;
  }

  // The trailing-slash rule is a property of the SOURCE site (it 308-redirects
  // /lavazza -> /lavazza/). Applying it to third-party hosts would corrupt
  // recorded external links, so it is scoped to the canonical host.
  const isCanonicalHost = canonicalHost ? url.hostname === canonicalHost.toLowerCase() : true;
  url.pathname = normalizePathname(url.pathname, { addTrailingSlash: isCanonicalHost });

  const allowed = new Set(options.allowedParams ?? DEFAULT_ALLOWED_PARAMS);
  const multi = new Set(options.multiValueParams ?? DEFAULT_MULTI_VALUE_PARAMS);
  const extraDrops = new Set(options.dropParams ?? []);
  const unknownPolicy = options.unknownParams ?? "drop";

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower) || extraDrops.has(lower)) continue;
    if (lower.startsWith("utm_")) continue;
    const isAllowed = allowed.has(lower);
    if (!isAllowed && unknownPolicy === "drop") continue;
    if (value === "") continue;
    if (multi.has(lower)) {
      const parts = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      if (parts.length === 0) continue;
      kept.push([lower, parts.join(",")]);
    } else {
      kept.push([lower, value]);
    }
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));

  const search = new URLSearchParams();
  for (const [k, v] of kept) search.append(k, v);
  url.search = search.toString();

  return {
    href: url.toString(),
    origin: url.origin,
    host: url.hostname,
    pathname: url.pathname,
    search: url.search,
  };
}

/** True when `candidate` belongs to the same crawlable origin. */
export function isSameOrigin(candidate: CanonicalUrl | null, canonicalHost: string): boolean {
  return candidate !== null && candidate.host === canonicalHost.toLowerCase();
}

/**
 * Path used as a stable, human-readable key for a page. Always decoded so that
 * `/raztvorimo%20kafe/` and `/raztvorimo kafe/` map to the same key.
 */
export function decodedPath(url: CanonicalUrl): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}
