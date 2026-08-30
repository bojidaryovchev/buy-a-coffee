import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { normalizeLabel, normalizeWhitespace } from "@catalog/shared";

/**
 * Generic page parser: everything that is true of *any* HTML page, with no
 * assumptions about what kind of page it is. Classification is a separate
 * concern (see `classify.ts`) so that adding a page type never means touching
 * extraction.
 */

export interface ParsedForm {
  readonly action: string | null;
  readonly method: string;
  readonly fields: Array<{
    name: string | null;
    type: string | null;
    required: boolean;
    label: string | null;
  }>;
  /** True when the form is script-driven rather than a real <form> element. */
  readonly synthetic: boolean;
  /** Endpoint recovered from inline script, when the form posts via fetch. */
  readonly scriptEndpoint: string | null;
}

export interface ParsedPage {
  readonly title: string | null;
  readonly metaDescription: string | null;
  readonly canonicalTag: string | null;
  readonly robotsMeta: string | null;
  readonly lang: string | null;
  readonly openGraph: Record<string, string>;
  readonly headings: Array<{ level: number; text: string }>;
  /** Raw hrefs exactly as authored, before canonicalisation. */
  readonly links: Array<{ href: string; text: string; rel: string | null }>;
  readonly forms: ParsedForm[];
  readonly structuredData: unknown[];
  readonly imageUrls: string[];
  /** Signals used by the classifier and recorded for auditing. */
  readonly signals: {
    hasMain: boolean;
    productItemCount: number;
    hasFilterInit: boolean;
    filterInitProductCount: number;
    h1Count: number;
    hasQuickOrderWidget: boolean;
    hasNewsletterWidget: boolean;
    hasSearchInput: boolean;
    hasBreadcrumbs: boolean;
    hasPagination: boolean;
    hasSortControl: boolean;
    sectionCount: number;
  };
}

/** JSON-LD blocks, parsed defensively — malformed blocks are skipped. */
export function extractStructuredData($: CheerioAPI): unknown[] {
  const out: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text().trim();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Malformed JSON-LD is common in the wild and is not worth failing on.
    }
  });
  return out;
}

function labelFor($: CheerioAPI, id: string | undefined, placeholder: string | undefined): string | null {
  if (id) {
    const label = normalizeWhitespace($(`label[for="${id}"]`).text());
    if (label) return label;
  }
  return placeholder ? normalizeLabel(placeholder) : null;
}

export function extractForms($: CheerioAPI, html: string): ParsedForm[] {
  const forms: ParsedForm[] = [];

  $("form").each((_, element) => {
    const form = $(element);
    const fields = form
      .find("input, select, textarea")
      .toArray()
      .map((el) => {
        const field = $(el);
        return {
          name: field.attr("name") ?? field.attr("id") ?? null,
          type: field.attr("type") ?? (el as { tagName?: string }).tagName?.toLowerCase() ?? null,
          required: field.attr("required") !== undefined,
          label: labelFor($, field.attr("id"), field.attr("placeholder")),
        };
      });
    forms.push({
      action: form.attr("action") ?? null,
      method: (form.attr("method") ?? "get").toLowerCase(),
      fields,
      synthetic: false,
      scriptEndpoint: null,
    });
  });

  // This site submits via fetch() with no <form> element at all. Ignoring that
  // would report "no public forms" on a site that plainly has two.
  const syntheticGroups: Array<{ selector: string; endpointHint: RegExp }> = [
    { selector: 'input[type="tel"], input[id*="phone"]', endpointHint: /KZ_INTENTS_URL|quick-order/ },
    { selector: 'input[type="email"], input[id*="email"]', endpointHint: /NL_INTENTS_URL|subscribed/ },
  ];

  for (const group of syntheticGroups) {
    const inputs = $(group.selector);
    if (inputs.length === 0) continue;
    const endpoint = findScriptEndpoint(html, group.endpointHint);
    const fields = inputs
      .toArray()
      .map((el) => {
        const field = $(el);
        return {
          name: field.attr("name") ?? field.attr("id") ?? null,
          type: field.attr("type") ?? null,
          required: field.attr("required") !== undefined,
          label: labelFor($, field.attr("id"), field.attr("placeholder")),
        };
      })
      // Desktop and mobile duplicates.
      .filter((field, index, all) => all.findIndex((f) => f.type === field.type) === index);

    forms.push({ action: endpoint, method: "post", fields, synthetic: true, scriptEndpoint: endpoint });
  }

  return forms;
}

function findScriptEndpoint(html: string, hint: RegExp): string | null {
  if (!hint.test(html)) return null;
  const urls = [...html.matchAll(/['"](https?:\/\/[^'"]+\/api\/[^'"]+)['"]/g)].map((m) => m[1]);
  return urls[0] ?? null;
}

export function parsePage(html: string): ParsedPage {
  const $ = cheerio.load(html);

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"], meta[name^="twitter:"]').each((_, element) => {
    const key = $(element).attr("property") ?? $(element).attr("name");
    const value = $(element).attr("content");
    if (key && value) openGraph[key] = normalizeLabel(value);
  });

  const headings = $("h1, h2, h3, h4, h5, h6")
    .toArray()
    .map((element) => ({
      level: Number.parseInt((element as { tagName: string }).tagName.slice(1), 10),
      text: normalizeLabel($(element).text()),
    }))
    .filter((heading) => heading.text.length > 0);

  const links = $("a[href]")
    .toArray()
    .map((element) => {
      const anchor = $(element);
      return {
        href: (anchor.attr("href") ?? "").trim(),
        text: normalizeLabel(anchor.text()).slice(0, 200),
        rel: anchor.attr("rel") ?? null,
      };
    })
    .filter((link) => link.href.length > 0);

  const imageUrls = [
    ...new Set(
      $("img[src], source[srcset]")
        .toArray()
        .flatMap((element) => {
          const node = $(element);
          const src = node.attr("src");
          if (src) return [src.trim()];
          const srcset = node.attr("srcset") ?? "";
          return srcset
            .split(",")
            .map((entry) => entry.trim().split(/\s+/)[0] ?? "")
            .filter(Boolean);
        })
        .filter((url) => url.length > 0),
    ),
  ];

  const filterInitMatch = html.match(/window\.FILTER_INIT\s*=/);
  const filterInitProductCount = filterInitMatch
    ? (html.match(/"url"\s*:\s*"\\?\//g) ?? []).length
    : 0;

  return {
    title: normalizeLabel($("title").first().text()) || null,
    metaDescription: $('meta[name="description"]').attr("content")
      ? normalizeLabel($('meta[name="description"]').attr("content"))
      : null,
    canonicalTag: $('link[rel="canonical"]').attr("href")?.trim() ?? null,
    robotsMeta: $('meta[name="robots"]').attr("content")?.trim() ?? null,
    lang: $("html").attr("lang")?.trim() ?? null,
    openGraph,
    headings,
    links,
    forms: extractForms($, html),
    structuredData: extractStructuredData($),
    imageUrls,
    signals: {
      hasMain: $("main").length > 0,
      productItemCount: $(".product-item").length,
      hasFilterInit: filterInitMatch !== null,
      filterInitProductCount,
      h1Count: $("h1").length,
      hasQuickOrderWidget: $('input[type="tel"], input[id*="phone"]').length > 0,
      hasNewsletterWidget: $('input[type="email"], input[id*="email"]').length > 0,
      hasSearchInput: $("input[data-search-input], input[type=search]").length > 0,
      hasBreadcrumbs: /breadcrumb/i.test(html) || $("main > div a[href='/']").length > 0,
      hasPagination:
        $("[class*=pagination], [aria-label*=agination], a[href*='page=']").length > 0,
      hasSortControl: $("select[name*=sort], [data-sort], [class*=sort-]").length > 0,
      sectionCount: $("main > section").length,
    },
  };
}
