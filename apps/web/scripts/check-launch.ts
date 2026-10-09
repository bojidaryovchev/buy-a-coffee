#!/usr/bin/env tsx
/**
 * Launch guard.
 *
 * Fails while the storefront would show a customer something that is not yet
 * true or not yet decided. Three things are checked, and each reason is listed
 * on its own line so the output is a to-do list rather than a verdict:
 *
 *   1. Open questions in the legal text. A paragraph that begins with the
 *      review marker renders as a visible callout on a legal page. That is the
 *      right thing to render while the answer is missing and the wrong thing
 *      to launch with.
 *
 *   2. Unconfirmed commercial terms. `commerce.confirmedByOwner` is `false`
 *      until the business has confirmed the delivery, payment and return
 *      values; until then they are a proposal, however plausible.
 *
 *   3. Missing commercial terms. What delivery costs, how long it takes, how an
 *      order is paid for and how a return works have to be stated before a
 *      customer orders, so an unset one blocks the launch.
 *
 * It reads configuration and content only: no database, no network, no
 * environment. That is what lets it run in CI before anything is deployed.
 *
 * A document that is complete but has not had its lawyer's read (`needsReview`)
 * is reported as a note and does not fail the check — that read is a separate,
 * later step, and it is a person's sign-off, not something a script can see.
 */
import { pathToFileURL } from "node:url";
import { unsetTerms } from "../src/components/commerce/terms.ts";
import { siteConfig, type CommerceConfig } from "../src/config/site.ts";
import {
  REVIEW_MARKER,
  buildTermsOfService,
  cookiePolicy,
  openReviewItems,
  privacyPolicy,
  type LegalDocument,
} from "../src/content/legal.ts";
import { DEFAULT_LOCALE } from "../src/i18n/config.ts";
import { href, routes } from "../src/lib/routes.ts";

export interface LaunchReport {
  /** Each one fails the check. */
  readonly blockers: readonly string[];
  /** Worth a person's attention; never fails the check. */
  readonly notes: readonly string[];
}

/** The legal pages as they would render for a given set of commercial terms. */
export function legalPagesFor(commerce: CommerceConfig): readonly LegalDocument[] {
  return [privacyPolicy, buildTermsOfService(commerce), cookiePolicy];
}

/**
 * The address a legal document is published at, which is what a person
 * reading this report will open. The document's own `slug` is an internal
 * key and has not been a URL since the storefront's routes were localised.
 */
const LEGAL_ROUTES: Readonly<Record<string, string>> = {
  privacy: routes.privacy,
  terms: routes.terms,
  cookies: routes.cookies,
};

export const legalPagePath = (document: Pick<LegalDocument, "slug">): string =>
  href(DEFAULT_LOCALE, LEGAL_ROUTES[document.slug] ?? `/${document.slug}`);

const excerpt = (text: string): string => (text.length > 110 ? `${text.slice(0, 107)}…` : text);

export function launchReport(
  commerce: CommerceConfig = siteConfig.commerce,
  documents: readonly LegalDocument[] = legalPagesFor(commerce),
): LaunchReport {
  const blockers: string[] = [];
  const notes: string[] = [];

  for (const document of documents) {
    for (const item of openReviewItems(document)) {
      blockers.push(
        `${legalPagePath(document)} renders a "${REVIEW_MARKER}" callout: ${excerpt(item)}`,
      );
    }
    if (document.needsReview) {
      notes.push(
        `${legalPagePath(document)} still shows its draft notice (needsReview is true) — cleared by the lawyer's read`,
      );
    }
  }

  if (!commerce.confirmedByOwner) {
    blockers.push(
      "commerce.confirmedByOwner is false — the delivery, payment and return terms are proposed, not confirmed by the business",
    );
  }

  for (const term of unsetTerms(commerce)) {
    blockers.push(`unset term: ${term}`);
  }

  return { blockers, notes };
}

/** Prints the report and returns the process exit code. */
export function run(
  report: LaunchReport = launchReport(),
  out: (line: string) => void = console.log,
  err: (line: string) => void = console.error,
): number {
  for (const note of report.notes) out(`note: ${note}`);

  if (report.blockers.length === 0) {
    out("check:launch passed — no open legal text, commercial terms set and confirmed.");
    return 0;
  }

  err(`check:launch failed — ${report.blockers.length} thing(s) to settle before launch:`);
  for (const blocker of report.blockers) err(`  - ${blocker}`);
  return 1;
}

// Only when run as a script; the tests import the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(run());
}
