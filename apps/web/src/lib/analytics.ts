import { track as vercelTrack } from "@vercel/analytics";

/**
 * Analytics abstraction.
 *
 * Components fire `AnalyticsEvent`s through `track`; a sink decides what
 * happens to them. In development they are logged, in production they go to
 * the hosting platform's cookieless Web Analytics as custom events, and in
 * tests they go nowhere.
 *
 * Event payloads deliberately carry no personal data: a phone number or email
 * must never leave the browser through an analytics call. The one field a
 * visitor can fill with anything — the search query — is passed through
 * `sanitizeSearchQuery` on its way out.
 */

export type AnalyticsEvent =
  | { name: "view_product"; productSlug: string; brand: string | null; price: string | null }
  | { name: "view_category"; categorySlug: string; resultCount: number }
  | { name: "view_brand"; brandSlug: string; resultCount: number }
  | { name: "search"; query: string; resultCount: number }
  | { name: "filter_applied"; filter: string; value: string; resultCount: number }
  | { name: "quick_order_started"; productSlug: string }
  | { name: "quick_order_submitted"; productSlug: string; outcome: "success" | "error" }
  | { name: "newsletter_submitted"; outcome: "success" | "error" }
  /*
   * Wizard events carry the answers, not the visitor. They are what tells us
   * which questions actually change the outcome and which are ceremony — and
   * an answer set that produced nothing is the clearest signal we have about
   * what we should be stocking.
   */
  | { name: "wizard_step_viewed"; step: string }
  | {
      name: "wizard_completed";
      system: string;
      taste: string | null;
      volume: string | null;
      budget: string | null;
      requirements: string;
      resultCount: number;
      relaxed: string;
      /**
       * The recorded facts (composition, roast) the ranking actually used,
       * comma-joined; empty when the answers left none to weigh. Tells how
       * often the enrichment data changes a recommendation at all.
       */
      factsUsed: string;
    };

export interface AnalyticsSink {
  track(event: AnalyticsEvent): void;
}

/* -- the search query ------------------------------------------------------ */

/** Longest query forwarded. Real product searches are a few words. */
export const SEARCH_QUERY_MAX = 50;

/**
 * A search query that is safe to send, or `null`.
 *
 * The box accepts anything, and people paste into it: a phone number meant for
 * the order form, an email, a delivery address. Rather than try to scrub such a
 * string, the whole query is withheld. Checked on the full text BEFORE the
 * length cap, so a number sitting past the cut-off is still caught.
 *
 * Withheld when it contains an `@`, a link, or six or more digits in total
 * (separators such as spaces, dashes, dots and brackets do not hide a phone
 * number; six still lets "1 кг" and "250 г" through). Otherwise
 * whitespace-collapsed and cut to `SEARCH_QUERY_MAX`.
 */
export function sanitizeSearchQuery(query: string): string | null {
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.includes("@")) return null;
  if (/(https?:|www\.)/i.test(text)) return null;
  if ((text.match(/\p{Nd}/gu) ?? []).length >= 6) return null;
  return text.slice(0, SEARCH_QUERY_MAX).trim();
}

/* -- mapping onto the platform's custom events ----------------------------- */

/**
 * What the platform accepts for a custom event: flat properties whose values
 * are strings, numbers, booleans or null — nested values are dropped in
 * production and throw in development. Strings are capped at 255 characters and
 * an event carries at most 8 properties; `wizard_completed`, the largest, has 8.
 */
export type CustomEventProperties = Record<string, string | number | boolean | null>;

export const CUSTOM_EVENT_MAX_PROPERTIES = 8;
export const CUSTOM_EVENT_MAX_STRING = 255;

export function toCustomEvent(event: AnalyticsEvent): {
  name: string;
  properties: CustomEventProperties;
} {
  const { name, ...rest } = event;
  const properties: CustomEventProperties = {};

  for (const [key, raw] of Object.entries(rest)) {
    let value: unknown = raw;
    if (event.name === "search" && key === "query") {
      value = sanitizeSearchQuery(String(raw ?? ""));
    }
    if (typeof value === "string") {
      properties[key] = value.slice(0, CUSTOM_EVENT_MAX_STRING);
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) properties[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      properties[key] = value;
    }
    /* undefined, objects and arrays have no place in a flat event. */
  }

  /* Keep the leading keys if ever over the cap. No current event is. */
  for (const key of Object.keys(properties).slice(CUSTOM_EVENT_MAX_PROPERTIES)) {
    delete properties[key];
  }

  return { name, properties };
}

/* -- sinks ----------------------------------------------------------------- */

const noopSink: AnalyticsSink = { track: () => {} };

const consoleSink: AnalyticsSink = {
  track: (event) => {
    const { name, properties } = toCustomEvent(event);
    console.debug("[analytics]", name, properties);
  },
};

/** The platform's own `track` is browser-only and complains on the server. */
const platformSink: AnalyticsSink = {
  track: (event) => {
    if (typeof window === "undefined") return;
    const { name, properties } = toCustomEvent(event);
    vercelTrack(name, properties);
  },
};

let sink: AnalyticsSink =
  process.env.NODE_ENV === "production"
    ? platformSink
    : process.env.NODE_ENV === "development"
      ? consoleSink
      : noopSink;

/** Swap the sink (tests do). */
export function setAnalyticsSink(next: AnalyticsSink): void {
  sink = next;
}

export function track(event: AnalyticsEvent): void {
  try {
    sink.track(event);
  } catch {
    // Analytics must never break a page.
  }
}

/* -- keeping the admin out of measurement ---------------------------------- */

/**
 * Is this URL inside the admin panel? The panel shows customers' phone numbers
 * and mail, so no page view of it, and no URL under it, may be reported.
 */
export function isAdminUrl(url: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    /* Cannot parse it: treat as admin rather than report it. */
    return true;
  }
  return /^\/admin(\/|$)/i.test(path);
}

/** `beforeSend` for both packages: drop anything under /admin. */
export function dropAdmin<T extends { url: string }>(event: T): T | null {
  return isAdminUrl(event.url) ? null : event;
}
