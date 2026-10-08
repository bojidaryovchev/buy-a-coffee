#!/usr/bin/env node
/**
 * Build bounded, sanitised parser fixtures from live source pages.
 *
 * Run manually when the source HTML changes shape:
 *
 *     node scripts/build-fixtures.mjs
 *
 * What it does, and why:
 *
 *  - Fetches a fixed set of representative public pages once, politely:
 *    sequentially, at least one second apart, after reading robots.txt, with
 *    the crawler's own user agent (CRAWL_USER_AGENT, as in .env.example).
 *  - Refuses to write anything unless every page answered with the status the
 *    list below expects. The source changed shape once already; a fixture that
 *    silently captured an error page would make the parser tests lie.
 *  - Truncates the two bulky listing pages to a curated subset. The catalog
 *    index on /search/ is NOT trimmed: the diff tests need every record.
 *  - Sanitises Cloudflare's rotating email tokens to a constant, so fixtures
 *    are byte-stable across rebuilds.
 *  - Replaces plain-text e-mail addresses with a reserved placeholder.
 *  - Redacts the third-party CMS tenant key. It is public on the source site,
 *    but copying someone else's credential into this repository is not our
 *    call to make. The script then re-checks every output and aborts if a
 *    key-shaped string survived.
 *  - Derives `soft-404.html`. The source used to answer unknown routes with
 *    HTTP 200 and its home page, and the fetcher still calibrates for that
 *    because the source has behaved both ways. That behaviour can no longer be
 *    observed, so the fixture is the home page shell by definition.
 *
 * Options:
 *
 *     --raw-dir <dir>   Also save the unsanitised responses under <dir>.
 *     --offline         Read responses from --raw-dir instead of the network
 *                       (rebuild after changing a transform without
 *                       spending a single request).
 *
 * No form is ever submitted.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.kafezona.com";
const OUT_DIR = path.resolve(process.cwd(), "fixtures/kafezona");
// Same default as packages/scraper-core/src/config.ts. Override with the
// environment exactly as the crawler is overridden.
const UA =
  process.env.CRAWL_USER_AGENT ??
  "KafeZonaCatalogSync/0.1 (+catalog synchronisation for an authorised reseller; contact: ops@example.com)";
const DELAY_MS = 1200;

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const rawDirIndex = args.indexOf("--raw-dir");
const RAW_DIR = rawDirIndex === -1 ? null : path.resolve(args[rawDirIndex + 1] ?? "");
if (OFFLINE && !RAW_DIR) throw new Error("--offline needs --raw-dir <dir>");

/**
 * `expect` is the HTTP status the page must return. Fixture file names stay
 * stable where the page kind is unchanged; a file name is not a URL (the
 * source renamed its product URLs).
 */
const PAGES = [
  { name: "home.html", url: "/" },
  { name: "search-filter-init.html", url: "/search/" },
  { name: "category-kapsuli.html", url: "/kafe-kapsuli/", transform: (html) => trimProductItems(html, 6) },
  // Real navigation categories that currently hold no products.
  { name: "category-empty.html", url: "/vending-zona/" },
  { name: "category-konsumativi.html", url: "/konsumativi/" },
  { name: "brand-lavazza.html", url: "/lavazza/", transform: (html) => trimProductItems(html, 4) },
  { name: "brand-empty.html", url: "/jacobs/" },
  { name: "brands-index.html", url: "/brands/" },
  { name: "promo.html", url: "/promo/" },
  { name: "blog-index.html", url: "/blog/" },
  {
    name: "blog-article.html",
    url: "/blog/kafezona-na-festivala-za-komunikatsiya-i-lichnostno-razvitie/",
  },
  { name: "legal-privacy.html", url: "/privacy/" },
  // A real HTTP 404 (unknown routes used to answer 200 with the home shell).
  { name: "not-found-404.html", url: "/__definitely-not-a-real-page-fixture/", expect: 404 },

  // Product pages. The first is the renamed URL of a product the previous
  // fixtures knew as /lavazza-super-crema/; each other page covers one
  // pattern the product parser has to cope with.
  { name: "product-lavazza-super-crema.html", url: "/lavazza-super-crema-1/" }, // renamed URL; composition without figures
  { name: "product-caffitaly-intenso.html", url: "/caffitaly-espresso-intenso-10/" }, // 70/30, JSON-LD, origin in prose
  { name: "product-amann-cascada.html", url: "/amann-cascada-500/" }, // 100 % arabica, labelled origin
  { name: "product-eurocaf-rosso-fuoco.html", url: "/eurocaf-rosso-fuoco-1/" }, // 100 % robusta, roast in prose
  { name: "product-bianchi-gold.html", url: "/bianchi-gold-100/" }, // robusta listed first
  { name: "product-borbone-superiore.html", url: "/borbone-crema-superiore-500/" }, // hedged "около 80%"
  { name: "product-illy-classico.html", url: "/illy-classico-250/" }, // characteristics as <p>, not <ul>
  { name: "product-dg-molini-napoli.html", url: "/dg-molini-napoli-16/" }, // malformed list markup
  { name: "product-lollo-terra.html", url: "/nespresso-lollo-caffe-terra-10/" }, // roast "Тъмното изпичане"
  { name: "product-lavazza-gusto-forte.html", url: "/lavazza-gusto-forte-1/" }, // "робуста" with no figure
  { name: "product-foodness.html", url: "/dg-foodness-marmaid-latte-10/" }, // not coffee, no composition facts
  { name: "product-rema-intenso.html", url: "/rema-caffe-intenso-100/" }, // no origin, roast in prose
];

/** Written by this script from another fixture, never fetched. */
const DERIVED = [
  {
    name: "soft-404.html",
    from: "home.html",
    note: "Historical behaviour: unknown routes answered 200 with the home page shell.",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rawFileName(urlPath) {
  return `${urlPath.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.raw`;
}

/** Minimal robots.txt reader: the `*` group's Disallow prefixes. */
function disallowedPrefixes(robotsTxt) {
  const out = [];
  let inStar = false;
  for (const line of robotsTxt.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split("#")[0].split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") inStar = value === "*";
    else if (inStar && key === "disallow" && value) out.push(value);
  }
  return out;
}

async function get(urlPath) {
  const cached = RAW_DIR ? path.join(RAW_DIR, rawFileName(urlPath)) : null;
  if (OFFLINE) {
    const text = await readFile(cached, "utf8");
    const newline = text.indexOf("\n");
    return { status: Number(text.slice(0, newline)), body: text.slice(newline + 1) };
  }
  const res = await fetch(new URL(encodeURI(urlPath), BASE), { headers: { "user-agent": UA } });
  const body = await res.text();
  if (cached) {
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(cached, `${res.status}\n${body}`, "utf8");
  }
  return { status: res.status, body };
}

/** Keep the first N `.product-item` blocks and drop the rest. */
function trimProductItems(html, keep) {
  const marker = '<div class="product-item"';
  const indices = [];
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    indices.push(at);
    from = at + marker.length;
  }
  if (indices.length <= keep) return html;

  const cutStart = indices[keep];
  const lastEnd = endOfDiv(html, indices[indices.length - 1]);
  if (lastEnd === -1) return html;
  console.log(`  trimmed product-item ${indices.length} -> ${keep}`);
  return `${html.slice(0, cutStart)}<!-- fixture: ${indices.length - keep} further product-item blocks removed -->${html.slice(lastEnd)}`;
}

function endOfDiv(html, startIdx) {
  const re = /<\/?div\b[^>]*>/g;
  re.lastIndex = startIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

const REDACTION = "REDACTED_THIRD_PARTY_TENANT_KEY";

/** Make fixtures deterministic and free of third-party credentials. */
function sanitise(html) {
  return (
    html
      // The footer now prints the shop's mailbox in clear. It is not needed
      // by any parser and does not belong in a public repository.
      .replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|bg|net|org|eu)\b/g,
        "mailbox@example.invalid",
      )
      .replace(/data-cfemail="[^"]*"/g, 'data-cfemail="0000000000"')
      .replace(/\/cdn-cgi\/l\/email-protection#[0-9a-fA-F]*/g, "/cdn-cgi/l/email-protection#0000")
      // The key's prefix could change; its shape (short tag, underscore, long hex) will not.
      .replace(/\bkz\d*_[0-9a-f]{12,}/gi, REDACTION)
      // Whatever the key looks like, never keep what is assigned to it.
      .replace(
        /(\w*TENANT_KEY\w*\s*=\s*)(['"])(?!REDACTED_THIRD_PARTY_TENANT_KEY)[^'"]*\2/g,
        "$1'REDACTED_THIRD_PARTY_TENANT_KEY'",
      )
      .replace(
        /(X-Tenant-Key'?\s*:\s*)['"](?!REDACTED_THIRD_PARTY_TENANT_KEY)[^'"]*['"]/g,
        "$1'REDACTED_THIRD_PARTY_TENANT_KEY'",
      )
  );
}

/** Abort rather than commit a credential. */
function assertNoTenantKey(name, html) {
  if (/\bkz\d*_[0-9a-f]{12,}/i.test(html)) {
    throw new Error(`${name}: a tenant-key-shaped string survived sanitising`);
  }
  for (const m of html.matchAll(/\w*TENANT_KEY\w*\s*=\s*['"]([^'"]*)['"]/g)) {
    if (m[1] !== REDACTION) {
      throw new Error(`${name}: TENANT_KEY is assigned something other than the redaction marker`);
    }
  }
}

async function main() {
  const fetched = [];
  let requests = 0;

  let disallowed = [];
  if (!OFFLINE) {
    console.log("fetching /robots.txt");
    const robots = await get("/robots.txt");
    requests += 1;
    if (robots.status === 200) disallowed = disallowedPrefixes(robots.body);
    console.log(`  robots.txt: ${robots.status}, disallowed prefixes: ${disallowed.join(", ") || "none"}`);
  }

  for (const page of PAGES) {
    if (disallowed.some((prefix) => page.url.startsWith(prefix))) {
      throw new Error(`robots.txt disallows ${page.url}; refusing to fetch it`);
    }
    if (!OFFLINE) await sleep(DELAY_MS);
    console.log(`fetching ${page.url}`);
    const { status, body } = await get(page.url);
    requests += OFFLINE ? 0 : 1;
    const expected = page.expect ?? 200;
    if (status !== expected) {
      throw new Error(`${page.url}: expected HTTP ${expected}, got ${status}. No fixture was written.`);
    }
    let html = body;
    if (page.transform) html = page.transform(html);
    html = sanitise(html);
    assertNoTenantKey(page.name, html);
    fetched.push({ page, status, html });
    console.log(`  -> ${page.name} (${status}, ${html.length} bytes)`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const { page, status, html } of fetched) {
    await writeFile(path.join(OUT_DIR, page.name), html, "utf8");
    manifest.push({ name: page.name, sourcePath: page.url, status, bytes: html.length });
  }
  for (const derived of DERIVED) {
    const source = fetched.find((entry) => entry.page.name === derived.from);
    if (!source) throw new Error(`derived fixture ${derived.name}: ${derived.from} was not built`);
    await writeFile(path.join(OUT_DIR, derived.name), source.html, "utf8");
    manifest.push({
      name: derived.name,
      derivedFrom: derived.from,
      note: derived.note,
      bytes: source.html.length,
    });
  }
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ base: BASE, generatedBy: "scripts/build-fixtures.mjs", pages: manifest }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nwrote ${manifest.length} fixtures to ${OUT_DIR}`);
  console.log(`HTTP requests made: ${requests}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
