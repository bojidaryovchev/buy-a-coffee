import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `*.db.test.ts` files read the shared catalog and never write to it.
 *
 * They all point at one database — the development catalog in `DATABASE_URL`
 * — and Vitest runs them in parallel workers. One of them once inserted two
 * categories for the length of its own suite and deleted them afterwards;
 * while the rows existed, a neighbour reading "each brand's categories" found
 * one too many, and failed once in a while, never twice in a row. A test
 * that needs to write builds a private database
 * (`*.integration.test.ts`, `helpers/test-db.ts`).
 *
 * This reads the sources rather than watching the database, because the point
 * is to fail in the pull request that adds the write, on a machine with no
 * PostgreSQL at all, with the line that did it. It is a net with holes — a
 * write hidden behind a helper in another file passes — but the mistake it
 * exists for was an honest `db.insert(` in plain sight.
 */

const REPO = path.resolve(import.meta.dirname, "../../..");
const SKIPPED = new Set(["node_modules", ".next", "dist", ".git", ".storage", "reference"]);

function dbTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return dbTestFiles(full);
    return entry.name.endsWith(".db.test.ts") ? [full] : [];
  });
}

/** What a write looks like, and what to say about it. */
const WRITES: ReadonlyArray<readonly [RegExp, string]> = [
  // On the database handle, or chained on a line of its own as Prettier
  // breaks it: `await db` / `.insert(categories)`. Not `seen.delete(slug)`.
  [/(?:^\s*|\b(?:db|tx|admin|database)\s*)\.(?:insert|update|delete)\(/, "a Drizzle write"],
  [/\.transaction\(/, "a transaction"],
  [
    /\bsql(?:\.raw\(|\.unsafe\(|`)[^`]*\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|truncate|alter\s+table|drop\s+(?:table|database|index|type)|create\s+(?:table|database|index|type))\b/i,
    "a SQL write",
  ],
  [
    /\b(?:useTestDatabase|setupTestDatabase)\(/,
    "a private database, which makes it an integration test",
  ],
  [/\b(?:seedReference|applyReslug|applyPackSizes|publishProductCopy)\(/, "a script that writes"],
  [/--apply\b/, "a script run with --apply"],
];

function writesIn(source: string): Array<{ line: number; what: string; text: string }> {
  return source.split("\n").flatMap((text, index) => {
    const hit = WRITES.find(([pattern]) => pattern.test(text));
    return hit ? [{ line: index + 1, what: hit[1], text: text.trim() }] : [];
  });
}

describe("*.db.test.ts files", () => {
  const files = dbTestFiles(REPO);

  it("exist, so this is checking something", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [path.relative(REPO, file).replaceAll("\\", "/"), file] as const))(
    "%s only reads the shared catalog",
    (_name, file) => {
      expect(writesIn(readFileSync(file, "utf8"))).toEqual([]);
    },
  );

  it("would have caught the write that prompted it, and does not cry wolf", () => {
    expect(writesIn("await db.insert(categories).values([{ slug }]);")).toHaveLength(1);
    expect(
      writesIn("await db.delete(categories).where(inArray(categories.id, seeded));"),
    ).toHaveLength(1);
    expect(writesIn("db.update(categories).set({ status })")).toHaveLength(1);
    expect(writesIn("await db\n  .insert(categories)\n  .values(rows);")).toHaveLength(1);
    expect(writesIn("await db.execute(sql`truncate table products cascade`);")).toHaveLength(1);
    expect(writesIn('({ db } = await useTestDatabase("x"));')).toHaveLength(1);
    // Reads, and a search term that only looks like SQL.
    expect(
      writesIn("await db.execute(sql`select slug from products where status = 'active'`)"),
    ).toEqual([]);
    expect(writesIn(`for (const term of ["%%", "'; drop table products; --"]) {`)).toEqual([]);
    expect(writesIn("seen.delete(slug); params.delete('page');")).toEqual([]);
    expect(writesIn("const updatedAt = row.lastChangedAt;")).toEqual([]);
  });
});
