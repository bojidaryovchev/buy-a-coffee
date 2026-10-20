import { describe, expect, it } from "vitest";
import {
  type StoredCopy,
  auditStoredCopy,
  bodyParagraphs,
  describeFinding,
} from "../scripts/copy-compat-lib";

/*
 * `pnpm copy:compat` reads what a database already publishes; these are its
 * judgements, on rows shaped as the database returns them.
 */

const row = (overrides: Partial<StoredCopy>): StoredCopy => ({
  slug: "product",
  status: "active",
  origin: "ai",
  summary: "Капсули за Dolce Gusto с плътно тяло и гъста крема в чашата.",
  html: "<p>Еспресо с наситен вкус и интензивност 9 от 12.</p>",
  ...overrides,
});

describe("bodyParagraphs", () => {
  it("reads the paragraphs every writer of the column writes, entities decoded", () => {
    expect(
      bodyParagraphs("<p>Първи &amp; втори.</p>\n<p>„Лате“ &quot;макиато&quot;</p>\n"),
    ).toEqual(["Първи & втори.", '„Лате“ "макиато"']);
    expect(bodyParagraphs("<p>Един<br>два</p>")).toEqual(["Един", "два"]);
    expect(bodyParagraphs(null)).toEqual([]);
  });
});

describe("auditStoredCopy", () => {
  const rows: StoredCopy[] = [
    row({ slug: "fine-ai" }),
    row({
      slug: "loose-ai",
      html: "<p>Еспресо с наситен вкус.</p>\n<p>16 капсули, съвместими с машини Dolce Gusto.</p>",
    }),
    row({
      slug: "home-edited",
      origin: "edited",
      status: "removed",
      summary: "10 капсули за домашните машини Nespresso, интензивност 9 от 12.",
      html: null,
    }),
    row({
      slug: "fine-hand",
      origin: "hand",
      html: "<p>16 капсули, съвместими с класическите машини Dolce Gusto (не NEO).</p>",
    }),
    row({ slug: "no-copy", origin: null, summary: null, html: null }),
  ];

  it("counts by origin and flags only the broken promises", () => {
    const audit = auditStoredCopy(rows);
    expect(audit.checked).toBe(4);
    expect(Object.fromEntries(audit.byOrigin)).toEqual({
      ai: { checked: 2, flagged: 1 },
      edited: { checked: 1, flagged: 1 },
      hand: { checked: 1, flagged: 0 },
    });
    expect(Object.fromEntries(audit.byRule)).toEqual({
      "dolce-gusto-machines": 1,
      "nespresso-home": 1,
    });
    expect(audit.findings.map((finding) => finding.slug)).toEqual(["loose-ai", "home-edited"]);
  });

  it("prints a finding as the product, where it came from and the sentence", () => {
    const [, home] = auditStoredCopy(rows).findings;
    expect(describeFinding(home!)).toBe(
      [
        "  home-edited  [edited, removed]",
        "      nespresso-home: 10 капсули за домашните машини Nespresso, интензивност 9 от 12.",
      ].join("\n"),
    );
  });
});
