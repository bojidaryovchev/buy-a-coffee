import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

/*
 * Nothing a browser loads may import Node or the server.
 *
 * A client component's imports are bundled for the browser, all the way down.
 * Turbopack does not refuse a Node built-in there: it substitutes a polyfill,
 * silently. On 20 October 2026 every page of buy-a-coffee.com shipped
 * crypto-browserify (about 107 KB of brotli, a third of the page's JavaScript)
 * because the header's search field reached `node:crypto` in six steps:
 * search-field → brand-logo → content/brand-logos → lib/catalog/brand-display
 * → the `@catalog/shared` barrel → hash.ts. crypto-browserify requires Next's
 * `util` polyfill, which tests for generator functions with
 * `Function("return function*() {}")`, and that logged a CSP `'unsafe-eval'`
 * report on every page load. A server package is worse: `server-only` breaks
 * the build, and the rest would ship a database driver or the mail client.
 *
 * So this walks the static import graph from every `"use client"` module in
 * the app, and from `instrumentation-client` if there is one, and fails,
 * printing the chain, when it reaches a Node built-in or a server package. It
 * follows what the bundler follows:
 *
 *  - `@/…` (the one alias in tsconfig.json, which a test here pins), relative
 *    paths, and `@catalog/shared` and its subpaths through the package's
 *    `exports` (it is compiled from source, `transpilePackages`);
 *  - `import`, `export … from`, `import()` and `require()` of a literal,
 *    including `import { type X }`, which with `verbatimModuleSyntax` still
 *    loads the module;
 *
 * and skips what the bundler does not bundle as code:
 *
 *  - `import type` and `export type`, which are erased;
 *  - a module whose first statement is `"use server"`: imported from the
 *    client it becomes a reference to a server function, not code;
 *  - stylesheets, JSON and media, which are data;
 *  - other packages, which are checked by name only (`next`, `react` and the
 *    rest are the framework's business).
 *
 * What it cannot follow fails the test as a hole: a local import that
 * resolves to no file or to a kind of file it does not know, `import()` of a
 * computed specifier, and a `#…` package import.
 *
 * Known limits, none of which occurs in a browser-reachable module today: a
 * worker started with `new Worker(new URL("./w.ts", import.meta.url))` is a
 * bundle of its own the walk does not enter; `require(x)` of a computed `x` is
 * not seen; and nor is the bare `Buffer` global, for which Turbopack adds the
 * buffer polyfill without an import. `pnpm check:bundle` reads the build
 * itself, and catches crypto-browserify and the `Function()` probe however
 * they got in.
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
  "@react-email/render",
  "@react-email/components",
]);

/**
 * Entry points of those packages that are made for the browser. The
 * newsletter composer uploads a picture straight from the admin's browser
 * with `upload` from `@vercel/blob/client`, which maps its Node imports to
 * browser stand-ins in the package's own `browser` field.
 */
const BROWSER_ENTRIES = new Set(["@vercel/blob/client"]);

/** JavaScript and TypeScript in every module flavour: .js .jsx .ts .tsx .mjs .cjs .mts .cts. */
const CODE = /\.[cm]?[jt]sx?$/;
/** What a bundle takes in as data or as a URL, never as code with imports of its own. */
const ASSET =
  /\.(css|scss|sass|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|txt|md)$/i;
const CANDIDATES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

/**
 * Folders of the app that are never bundled for the browser: dependencies,
 * the tests, the scripts, and build and test output. Hidden folders (`.next`,
 * `.storage`) are skipped too.
 */
const NOT_APP = new Set([
  "node_modules",
  "test",
  "e2e",
  "scripts",
  "test-results",
  "playwright-report",
]);

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

type Resolved =
  { kind: "file"; file: string } | { kind: "package" } | { kind: "hole"; why: string };

function resolve(specifier: string, from: string, host: Host): Resolved {
  let base: string | null;
  if (specifier.startsWith("#")) {
    return { kind: "hole", why: "is a package import (#…), which the walk does not resolve" };
  }
  if (specifier.startsWith("@/")) base = path.join(WEB, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(from), specifier);
  else if (packageName(specifier) === SHARED_NAME) base = sharedPath(specifier);
  else return { kind: "package" };
  if (base !== null) {
    for (const suffix of CANDIDATES) {
      if (host.isFile(base + suffix)) return { kind: "file", file: base + suffix };
    }
  }
  return { kind: "hole", why: "resolves to no file" };
}

interface ModuleFacts {
  readonly directives: readonly string[];
  /** Module specifiers this module loads at run time. */
  readonly imports: readonly string[];
  /** `import(x)` with a computed `x`: the walk cannot follow it. */
  readonly computed: number;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[jt]sx$/.test(file)) return ts.ScriptKind.TSX;
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
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
      if (resolved.kind === "hole") {
        holes.push(`${relative(file)}: "${specifier}" ${resolved.why}`);
        continue;
      }
      if (parent.has(resolved.file)) continue;
      parent.set(resolved.file, file);
      if (ASSET.test(resolved.file)) continue;
      if (!CODE.test(resolved.file) || resolved.file.endsWith(".d.ts")) {
        holes.push(`${relative(file)}: "${specifier}" is a kind of file the walk cannot read`);
        continue;
      }
      // A server action: the client gets a reference to it, not its code.
      if (factsOf(resolved.file).directives.includes("use server")) continue;
      queue.push(resolved.file);
    }
  }
  return { visited: new Set(parent.keys()), findings, holes };
}

function appFiles(directory: string, top: boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const skip =
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        (top && NOT_APP.has(entry.name));
      return skip ? [] : appFiles(full, false);
    }
    return CODE.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

/**
 * Where the browser's code starts: every `"use client"` module in the app,
 * wherever it sits (`src`, `content`), and `instrumentation-client`, which
 * Next runs in the browser without a directive, at the root or in `src`.
 */
function clientEntries(webRoot: string): string[] {
  const clients = appFiles(webRoot, true).filter((file) =>
    moduleFacts(file, readFileSync(file, "utf8")).directives.includes("use client"),
  );
  const instrumentation = ["", "src"]
    .flatMap((folder) =>
      ["ts", "js"].map((ext) => path.join(webRoot, folder, `instrumentation-client.${ext}`)),
    )
    .filter((file) => disk.isFile(file));
  return [...new Set([...clients, ...instrumentation])];
}

/** Path aliases as TypeScript reads them from apps/web/tsconfig.json, `extends` included. */
function pathAliases(): Record<string, string[]> {
  const file = path.join(WEB, "tsconfig.json");
  const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  // No file listing is needed for `paths`, and listing the app would be slow.
  const host: ts.ParseConfigHost = { ...ts.sys, readDirectory: () => [] };
  return ts.parseJsonConfigFileContent(config, host, WEB).options.paths ?? {};
}

const clientModules = clientEntries(WEB);

const made: string[] = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

  it("knows every alias the app can import through", () => {
    // The walk resolves `@/` to `src/` and nothing else. Another alias would
    // be followed by the bundler and not by the walk: teach `resolve` first.
    const aliases = pathAliases();
    expect(aliases).toEqual({ "@/*": ["./src/*"] });
  });

  it("finds client modules outside src, and instrumentation-client", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "client-entries-"));
    made.push(root);
    const files: Record<string, string> = {
      "src/a.tsx": `"use client";`,
      "src/b.ts": `export const b = 1;`,
      "src/lib/scripts/c.tsx": `"use client";`,
      "content/widget.tsx": `'use client';\nexport const w = 1;`,
      "instrumentation-client.ts": `console.log("no directive, still the browser's");`,
      "src/instrumentation-client.js": `console.log("here too");`,
      "test/t.tsx": `"use client";`,
      "e2e/e.tsx": `"use client";`,
      "scripts/s.tsx": `"use client";`,
      "node_modules/p/index.js": `"use client";`,
      ".next/static/x.js": `"use client";`,
    };
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), content);
    }
    const found = clientEntries(root)
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
      .sort();
    expect(found).toEqual([
      "content/widget.tsx",
      "instrumentation-client.ts",
      "src/a.tsx",
      "src/instrumentation-client.js",
      "src/lib/scripts/c.tsx",
    ]);
  });

  describe("would be caught", () => {
    const fixture = (name: string) => path.join(WEB, "src", "__client-imports-fixture__", name);
    const relativeFixture = (name: string) => relative(fixture(name));
    const files = new Map<string, string>([
      [fixture("entry.tsx"), `"use client";\nimport { a } from "@/__client-imports-fixture__/a";`],
      // export … from, and a subpath of @catalog/shared: the real hash.ts.
      [fixture("a.ts"), `export * from "@catalog/shared/hash";\nexport const a = 1;`],
      [fixture("lazy.tsx"), `"use client";\nconst b = () => import("./b");`],
      [fixture("b.ts"), `import { readFileSync } from "fs";`],
      [fixture("names.tsx"), `"use client";\nimport { type Database } from "@catalog/db";`],
      [
        fixture("erased.tsx"),
        `"use client";\nimport type { Database } from "@catalog/db";\nexport type { SQL } from "drizzle-orm";\nimport { act } from "./actions";\nimport "./styles.css";\nimport data from "./data.json";`,
      ],
      [
        fixture("actions.ts"),
        `"use server";\nimport "server-only";\nimport { db } from "@catalog/db";`,
      ],
      [fixture("styles.css"), `.a { color: red }`],
      [fixture("data.json"), `{}`],
      // Every module flavour is walked: .cjs by its full name, .mts without one.
      [fixture("flavours.tsx"), `"use client";\nimport "./common.cjs";\nimport "./module";`],
      [fixture("common.cjs"), `const os = require("os");`],
      [fixture("module.mts"), `export { join } from "node:path";`],
      [fixture("mail.tsx"), `"use client";\nimport { render } from "@react-email/render";`],
      // What the walk cannot read is a hole, not a pass.
      [
        fixture("holes.tsx"),
        `"use client";\nimport x from "#internal";\nimport q from "./query.graphql";\nimport "./missing";\nconst m = (n: string) => import(n);`,
      ],
      [fixture("query.graphql"), `{ products { id } }`],
    ]);
    const host: Host = {
      isFile: (file) => files.has(file) || disk.isFile(file),
      read: (file) => files.get(file) ?? disk.read(file),
    };
    const run = (entry: string) => walk([fixture(entry)], host);

    it("through @/, export … from and a @catalog/shared subpath", () => {
      expect(run("entry.tsx").findings).toEqual([
        [
          relativeFixture("entry.tsx"),
          relativeFixture("a.ts"),
          "packages/shared/src/hash.ts",
          "node:crypto (a Node built-in)",
        ].join("\n  → "),
      ]);
    });

    it("through import()", () => {
      expect(run("lazy.tsx").findings).toEqual([
        [relativeFixture("lazy.tsx"), relativeFixture("b.ts"), "fs (a Node built-in)"].join(
          "\n  → ",
        ),
      ]);
    });

    it("through an import whose names are all types, which still loads the module", () => {
      expect(run("names.tsx").findings).toHaveLength(1);
    });

    it("but not through erased imports, server actions, stylesheets or JSON", () => {
      expect(run("erased.tsx")).toMatchObject({ findings: [], holes: [] });
    });

    it("through .cjs, .mts and the other module flavours", () => {
      expect(run("flavours.tsx").findings).toEqual([
        [
          relativeFixture("flavours.tsx"),
          relativeFixture("common.cjs"),
          "os (a Node built-in)",
        ].join("\n  → "),
        [
          relativeFixture("flavours.tsx"),
          relativeFixture("module.mts"),
          "node:path (a Node built-in)",
        ].join("\n  → "),
      ]);
    });

    it("through the mail renderer", () => {
      expect(run("mail.tsx").findings).toHaveLength(1);
    });

    it("or reported as a hole where the walk cannot see", () => {
      const where = relativeFixture("holes.tsx");
      expect(run("holes.tsx")).toMatchObject({
        findings: [],
        holes: [
          `${where}: import() with a computed specifier`,
          `${where}: "#internal" is a package import (#…), which the walk does not resolve`,
          `${where}: "./query.graphql" is a kind of file the walk cannot read`,
          `${where}: "./missing" resolves to no file`,
        ],
      });
    });
  });
});
