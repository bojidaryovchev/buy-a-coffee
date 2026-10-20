/**
 * Which product descriptions break the compatibility rules, as pure functions.
 *
 * The rules (`@catalog/shared/compatibility-copy`) keep a wrong promise about
 * machines out of new copy: the catalog copywriter rejects machine-written
 * text that breaks them, and the storefront's test fails on hand-written copy
 * that does. Neither reaches text that is already published. A product the
 * copywriter wrote before the rules existed keeps its text until its facts
 * change, so the one way to know whether a database already publishes
 * „машини Dolce Gusto“ is to read it — which `copy-compat.ts` does, through
 * these functions, so the judgement can be tested without a database.
 */
import { htmlToText } from "@catalog/shared";
import {
  type CompatibilityProblem,
  type CompatibilityRule,
  compatibilityProblems,
} from "@catalog/shared/compatibility-copy";

/** A product's published copy, as the database holds it. */
export interface StoredCopy {
  readonly slug: string;
  readonly status: string;
  /** `hand`, `ai`, `edited`, or null for copy that predates the column. */
  readonly origin: string | null;
  readonly summary: string | null;
  readonly html: string | null;
}

export interface CompatFinding {
  readonly slug: string;
  /** Where the text came from: a copy origin, or "file" / "source" / "generated". */
  readonly origin: string;
  /** The product's status, when it is not simply active. */
  readonly status?: string;
  readonly problems: readonly CompatibilityProblem[];
}

export interface CompatAudit {
  readonly checked: number;
  /** Texts checked and texts flagged, by where they came from. */
  readonly byOrigin: ReadonlyMap<string, { checked: number; flagged: number }>;
  /** By rule: how many texts break it. */
  readonly byRule: ReadonlyMap<CompatibilityRule, number>;
  readonly findings: readonly CompatFinding[];
}

/**
 * The paragraphs of a stored body. `copy:apply`, the copywriter and the admin
 * all write plain `<p>` paragraphs, but this reads any markup, so a database
 * written some other way is read too.
 */
export function bodyParagraphs(html: string | null): string[] {
  if (!html) return [];
  return html
    .split(/<\/p\s*>|<br\s*\/?>/i)
    .map((chunk) => htmlToText(chunk))
    .filter(Boolean);
}

/** Judge texts that are already split into a summary and paragraphs. */
export function auditTexts(
  texts: ReadonlyArray<{
    slug: string;
    origin: string;
    status?: string;
    fields: readonly string[];
  }>,
): CompatAudit {
  const byOrigin = new Map<string, { checked: number; flagged: number }>();
  const byRule = new Map<CompatibilityRule, number>();
  const findings: CompatFinding[] = [];

  for (const { slug, origin, status, fields } of texts) {
    const counts = byOrigin.get(origin) ?? { checked: 0, flagged: 0 };
    counts.checked += 1;
    byOrigin.set(origin, counts);

    const problems = compatibilityProblems(fields);
    if (problems.length === 0) continue;
    counts.flagged += 1;
    for (const rule of new Set(problems.map((problem) => problem.rule))) {
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    }
    findings.push({ slug, origin, ...(status ? { status } : {}), problems });
  }

  return { checked: texts.length, byOrigin, byRule, findings };
}

/** Judge what a database publishes: every product with copy of its own. */
export function auditStoredCopy(rows: readonly StoredCopy[]): CompatAudit {
  return auditTexts(
    rows
      .map((row) => ({
        slug: row.slug,
        origin: row.origin ?? "(none)",
        ...(row.status === "active" ? {} : { status: row.status }),
        fields: [row.summary ?? "", ...bodyParagraphs(row.html)].filter(
          (field) => field.trim() !== "",
        ),
      }))
      .filter((text) => text.fields.length > 0),
  );
}

/** One finding as a line or two the owner can act on. */
export function describeFinding(finding: CompatFinding): string {
  const where = finding.status ? `${finding.origin}, ${finding.status}` : finding.origin;
  const lines = [`  ${finding.slug}  [${where}]`];
  for (const problem of finding.problems) {
    lines.push(`      ${problem.rule}: ${problem.sentence}`);
  }
  return lines.join("\n");
}

/**
 * An error as this report may print it: its name and code, never its message.
 * A malformed `DATABASE_URL` makes the URL parser throw a TypeError whose
 * message (and `input`) is the whole address, password included.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number"
    ? `${error.name} ${code}`
    : error.name;
}
