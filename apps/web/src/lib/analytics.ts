/**
 * Analytics abstraction.
 *
 * No vendor is required to run this project. The default sink logs in
 * development and does nothing in production, so adding a real provider later
 * is a one-file change rather than a hunt through components.
 *
 * Event payloads deliberately carry no personal data: a phone number or email
 * must never leave the server through an analytics call.
 */

export type AnalyticsEvent =
  | { name: "view_product"; productSlug: string; brand: string | null; price: string | null }
  | { name: "view_category"; categorySlug: string; resultCount: number }
  | { name: "view_brand"; brandSlug: string; resultCount: number }
  | { name: "search"; query: string; resultCount: number }
  | { name: "filter_applied"; filter: string; value: string; resultCount: number }
  | { name: "quick_order_started"; productSlug: string }
  | { name: "quick_order_submitted"; productSlug: string; outcome: "success" | "error" }
  | { name: "newsletter_submitted"; outcome: "success" | "error" };

export interface AnalyticsSink {
  track(event: AnalyticsEvent): void;
}

const noopSink: AnalyticsSink = { track: () => {} };

const consoleSink: AnalyticsSink = {
  track: (event) => {
     
    console.debug("[analytics]", event.name, event);
  },
};

let sink: AnalyticsSink =
  process.env.NODE_ENV === "development" ? consoleSink : noopSink;

/** Swap in a real provider. Call once, during app start-up. */
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
