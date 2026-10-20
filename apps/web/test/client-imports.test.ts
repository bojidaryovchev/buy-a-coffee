import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/*
 * Nothing a browser loads may import Node or the server.
 *
 * A client component's imports are bundled for the browser, all the way down.
 * Turbopack does not refuse a Node built-in there: it substitutes a polyfill,
 * silently. On 20 October 2026 every page of buy-a-coffee.com shipped
 * crypto-browserify (about 107 KB of brotli, a third of the page's JavaScript)
 * because the header's search field reached `node:crypto` in six steps:
 * search-field → brand-logo → content/brand-logos → lib/catalog/brand-display
 * → the `@catalog/shared` barrel → hash.ts. A generator check inside the
 * polyfill also called `Function(…)`, which logged a CSP `'unsafe-eval'` report
 * on every page load. A server package is worse: `server-only` breaks the
 * build, and the rest would ship a database driver or the mail client.
 *
 * So this walks the static import graph from every `"use client"` module in
 * `src` and fails, printing the chain, when it reaches a Node built-in or a
 * server package. It follows what the bundler follows:
 *
 *  - `@/…`, relative paths, and `@catalog/shared` and its subpaths through the
 *    package's `exports` (it is compiled from source, `transpilePackages`);
 *  - `import`, `export … from` and `import()`, including `import { type X }`,
 *    which with `verbatimModuleSyntax` still loads the module;
 *
 * and skips what the bundler does not bundle:
 *
 *  - `import type` and `export type`, which are erased;
 *  - a module whose first statement is `"use server"`: imported from the
 *    client it becomes a reference to a server function, not code;
 *  - other packages, which are checked by name only (`next`, `react` and the
 *    rest are the framework's business).
 *
 * A local import that resolves to no file fails the test too: the walk cannot
 * vouch for what it cannot read.
 */

const WEB = path.resolve(import.meta.dirname, "..");
const REPO = path.resolve(WEB, "../..");
const SHARED = path.join(REPO, "packages/shared");
const SHARED_NAME = "@catalog/shared";

const NODE_BUILTINS = new Set(builtinModules.map((name) => name.split("/")[0]));

/** Packages that only work on the server, or exist to stop a client import. */
const SERVER_PACKAGES = new Set([
  "server-only",
  "@catalog/db",
  "drizzle-orm",
  "postgres",
  "resend",
  "sanitize-html",
  "@vercel/blob",
]);

/**
 * Entry points of those packages that are made for the browser. The
 * newsletter composer uploads a picture straight from the admin's browser
 * with `upload` from `@vercel/blob/client`, which maps its Node imports to
 * browser stand-ins in the package's own `browser` field.
 */
const BROWSER_ENTRIES = new Set(["@vercel/blob/client"]);

const CODE = /\.(ts|tsx|js|jsx|mjs)$/;
const CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/** Where the walk reads files from; the self-test lays a few over the real tree. */
interface Host {
  isFile(file: string): boolean;
  read(file: string): string;
}

const disk: Host = {
  isFile: (file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  },
  read: (file) => readFileSync(file, "utf8"),
};

const sharedExports = (
  JSON.parse(readFileSync(path.join(SHARED, "package.json"), "utf8")) as {
    exports: Record<string, string>;
  }
).exports;

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** Why a specifier must not be in a browser bundle, or null if it may. */
function forbidden(specifier: string): string | null {
  if (specifier.startsWith("node:")) return "a Node built-in";
  if (BROWSER_ENTRIES.has(specifier)) return null;
  const name = packageName(specifier);
  if (NODE_BUILTINS.has(name)) return "a Node built-in";
  if (SERVER_PACKAGES.has(name)) return "a server-only package";
  return null;
}

/** `@catalog/shared` and `@catalog/shared/x`, as the package's `exports` map them. */
function sharedPath(specifier: string): string | null {
  const subpath = `.${specifier.slice(SHARED_NAME.length)}`;
  const exact = sharedExports[subpath];
  if (exact) return path.join(SHARED, exact);
  const pattern = sharedExports["./*"];
  return pattern && subpath.startsWith("./")
    ? path.join(SHARED, pattern.replace("*", subpath.slice(2)))
    : null;
}

type Resolved = { kind: "file"; file: string } | { kind: "package" } | { kind: "missing" };

function resolve(specifier: string, from: string, host: Host): Resolved {
  let base: string | null;
  if (specifier.startsWith("@/")) base = path.join(WEB, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else if (packageName(specifier) === SHARED_NAME) base = sharedPath(specifier);
  else return { kind: "package" };
  if (base === null) return { kind: "missing" };
  for (const suffix of CANDIDATES) {
    if (host.isFile(base + suffix)) return { kind: "file", file: base + suffix };
  }
  return { kind: "missing" };
}

interface ModuleFacts {
  readonly directives: readonly string[];
  /** Module specifiers this module loads at run time. */
  readonly imports: readonly string[];
  /** `import(x)` with a computed `x`: the walk cannot follow it. */
  readonly computed: number;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx") || file.endsWith(".jsx")) return ts.ScriptKind.TSX;
  return file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

function moduleFacts(file: string, source: string): ModuleFacts {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKind(file),
  );
  const directives: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }

  const imports: string[] = [];
  let computed = 0;
  const literal = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier && !node.importClause?.isTypeOnly) imports.push(specifier);
    } else if (ts.isExportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier && !node.isTypeOnly) imports.push(specifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = literal(node.moduleReference.expression);
        if (specifier) imports.push(specifier);
      }
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isImport || isRequire) {
        const specifier = literal(node.arguments[0]);
        if (specifier) imports.push(specifier);
        else if (isImport) computed += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { directives, imports, computed };
}

const relative = (file: string): string => path.relative(REPO, file).split(path.sep).join("/");

interface Walk {
  /** Every module the walk read. */
  readonly visited: ReadonlySet<string>;
  /** One line per forbidden import reached, with the chain that reaches it. */
  readonly findings: readonly string[];
  /** Imports the walk could not follow. */
  readonly holes: readonly string[];
}

/**
 * Breadth first from every entry at once, so the chain printed for a finding
 * is a shortest one from some client module.
 */
function walk(entries: readonly string[], host: Host = disk): Walk {
  const parent = new Map<string, string | null>(entries.map((entry) => [entry, null]));
  const queue = [...entries];
  const findings: string[] = [];
  const holes: string[] = [];
  const parsed = new Map<string, ModuleFacts>();
  const factsOf = (file: string): ModuleFacts => {
    const facts = parsed.get(file) ?? moduleFacts(file, host.read(file));
    parsed.set(file, facts);
    return facts;
  };
  const chain = (file: string): string[] => {
    const steps: string[] = [];
    for (let at: string | null | undefined = file; at; at = parent.get(at)) {
      steps.unshift(relative(at));
    }
    return steps;
  };

  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index] as string;
    const facts = factsOf(file);
    if (facts.computed > 0) {
      holes.push(`${relative(file)}: import() with a computed specifier`);
    }
    for (const specifier of facts.imports) {
      const reason = forbidden(specifier);
      if (reason) {
        findings.push([...chain(file), `${specifier} (${reason})`].join("\n  → "));
        continue;
      }
      const resolved = resolve(specifier, file, host);
      if (resolved.kind === "package") continue;
      if (resolved.kind === "missing") {
        holes.push(`${relative(file)}: "${specifier}" resolves to no file`);
        continue;
      }
      if (parent.has(resolved.file)) continue;
      parent.set(resolved.file, file);
      if (!CODE.test(resolved.file) || resolved.file.endsWith(".d.ts")) continue;
      // A server action: the client gets a reference to it, not its code.
      if (factsOf(resolved.file).directives.includes("use server")) continue;
      queue.push(resolved.file);
    }
  }
  return { visited: new Set(parent.keys()), findings, holes };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return CODE.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

const clientModules = sourceFiles(path.join(WEB, "src")).filter((file) =>
  moduleFacts(file, readFileSync(file, "utf8")).directives.includes("use client"),
);

describe("what a browser loads", () => {
  it("reaches neither Node nor a server package from any client module", () => {
    const { findings, holes } = walk(clientModules);
    expect(findings).toEqual([]);
    expect(holes).toEqual([]);
  });

  it("starts from the client modules and walks past them", () => {
    const { visited } = walk(clientModules);
    expect(clientModules.length).toBeGreaterThan(0);
    expect(visited.size).toBeGreaterThan(clientModules.length);
  });

  it("includes @catalog/shared's barrel, which client modules import", () => {
    const barrel = sharedPath(SHARED_NAME) as string;
    const { findings, holes } = walk([barrel]);
    expect(findings).toEqual([]);
    expect(holes).toEqual([]);
  });

  it("would be caught, through each kind of import", () => {
    const fixture = (name: string) => path.join(WEB, "src", "__client-imports-fixture__", name);
    const files = new Map<string, string>([
      [fixture("entry.tsx"), `"use client";\nimport { a } from "@/__client-imports-fixture__/a";`],
      // export … from, and a subpath of @catalog/shared: the real hash.ts.
      [fixture("a.ts"), `export * from "@catalog/shared/hash";\nexport const a = 1;`],
      [fixture("lazy.tsx"), `"use client";\nconst b = () => import("./b");`],
      [fixture("b.ts"), `import { readFileSync } from "fs";`],
      [fixture("names.tsx"), `"use client";\nimport { type Database } from "@catalog/db";`],
      [
        fixture("erased.tsx"),
        `"use client";\nimport type { Database } from "@catalog/db";\nexport type { SQL } from "drizzle-orm";\nimport { act } from "./actions";`,
      ],
      [
        fixture("actions.ts"),
        `"use server";\nimport "server-only";\nimport { db } from "@catalog/db";`,
      ],
    ]);
    const host: Host = {
      isFile: (file) => files.has(file) || disk.isFile(file),
      read: (file) => files.get(file) ?? disk.read(file),
    };
    const caught = (entry: string) => walk([fixture(entry)], host).findings;

    expect(caught("entry.tsx")).toEqual([
      [
        "apps/web/src/__client-imports-fixture__/entry.tsx",
        "apps/web/src/__client-imports-fixture__/a.ts",
        "packages/shared/src/hash.ts",
        "node:crypto (a Node built-in)",
      ].join("\n  → "),
    ]);
    expect(caught("lazy.tsx")).toEqual([
      [
        "apps/web/src/__client-imports-fixture__/lazy.tsx",
        "apps/web/src/__client-imports-fixture__/b.ts",
        "fs (a Node built-in)",
      ].join("\n  → "),
    ]);
    expect(caught("names.tsx")).toHaveLength(1);
    expect(caught("erased.tsx")).toEqual([]);
  });
});
