import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { legalDocuments } from "@/content/legal";
import { LEGAL_REVISIONS } from "@/content/legal-revisions";

/*
 * A legal page's sitemap date (`content/legal-revisions.ts`) is the day its
 * text last changed. Nothing else knows that day, so this holds the date to
 * the text: change a word, or a commercial term the text is built from, and
 * this fails until the date moves with it.
 */

const fingerprint = (document: (typeof legalDocuments)[number]) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        title: document.title,
        summary: document.summary,
        sections: document.sections,
      }),
    )
    .digest("hex")
    .slice(0, 16);

describe("the legal documents' revision dates", () => {
  it.each(legalDocuments.map((document) => [document.slug, document] as const))(
    "%s: moved with its text",
    (slug, document) => {
      const revision = LEGAL_REVISIONS[slug];
      expect(revision, `no revision recorded for ${slug}`).toBeDefined();
      expect(
        fingerprint(document),
        `The text of "${slug}" changed. In content/legal-revisions.ts set its revisedAt to ` +
          `today and its fingerprint to "${fingerprint(document)}".`,
      ).toBe(revision!.fingerprint);
    },
  );

  it("are calendar dates, none of them in the future", () => {
    for (const { revisedAt } of Object.values(LEGAL_REVISIONS)) {
      expect(revisedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(`${revisedAt}T00:00:00Z`)).toBeLessThanOrEqual(Date.now());
    }
  });
});
