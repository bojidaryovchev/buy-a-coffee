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
 *  - Fetches a fixed set of representative public pages once, politely.
 *  - Truncates the two very large listing payloads to a curated subset that
 *    still contains every known edge case, so fixtures stay reviewable.
 *  - Sanitises Cloudflare's rotating email tokens to a constant, so fixtures
 *    are byte-stable across rebuilds.
 *  - Redacts the third-party CMS tenant key. It is public on the source site,
 *    but copying someone else's credential into this repository is not our
 *    call to make.
 *
 * No form is ever submitted.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.kafezona.com";
const OUT_DIR = path.resolve(process.cwd(), "fixtures/kafezona");
const UA = "KafeZonaCatalogSync/0.1 (fixture builder; authorised reseller catalog sync)";
const DELAY_MS = 500;

/** Products kept in the trimmed search fixture: every edge case we rely on. */
const KEEP_PRODUCT_URLS = new Set([
  "/borbone-crema-classica/", // URL collision: two real products, one URL
  "/eurocaf-piacere-oro/", // duplicated CMS record that must collapse
  "/lavazza-gusto-forte/", // genuinely has no price
  "/dg-molini-napoli/", // comma decimal price "€4,90"
  "/kimbo-aroma-gold/", // empty brandSlug despite a brand page existing
  "/lavazza-gran-espresso/", // non-conforming image path /img/66123-...
  "/lavazza-super-crema/", // ordinary well-formed product
  "/rema-caffe-intenso/", // no price and no weight
  "/nespresso-lavazza-crema-gusto-forte-10/", // capsules, piece-count weight
]);

const PAGES = [
  { name: "home.html", url: "/" },
  { name: "search-filter-init.html", url: "/search/", transform: trimFilterInitProducts },
  { name: "category-kapsuli.html", url: "/kapsuli/", transform: (html) => trimProductItems(html, 6) },
  { name: "category-empty.html", url: "/vending-zona/" },
  { name: "brand-lavazza.html", url: "/lavazza/", transform: (html) => trimProductItems(html, 4) },
  { name: "brand-empty.html", url: "/kimbo/" },
  { name: "brands-index.html", url: "/brands/" },
  { name: "product-lavazza-super-crema.html", url: "/lavazza-super-crema/" },
  { name: "product-no-price.html", url: "/lavazza-gusto-forte/" },
  { name: "product-comma-price.html", url: "/dg-molini-napoli/" },
  { name: "promo-empty.html", url: "/promo/" },
  { name: "blog-empty.html", url: "/blog/" },
  { name: "legal-privacy.html", url: "/privacy/" },
  { name: "soft-404.html", url: "/__definitely-not-a-real-page-fixture/" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(urlPath) {
  const res = await fetch(new URL(encodeURI(urlPath), BASE), { headers: { "user-agent": UA } });
  return { status: res.status, body: await res.text() };
}

/** Balanced-bracket scan, mirroring the parser so trimming stays faithful. */
function extractArrayAfterKey(source, key) {
  const match = new RegExp(`(?:^|[{,\\s])${key}\\s*:\\s*\\[`, "m").exec(source);
  if (!match) return null;
  const start = source.indexOf("[", match.index);
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      quote = c;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start, i + 1), start, end: i + 1 };
    }
  }
  return null;
}

function trimFilterInitProducts(html) {
  const anchor = html.indexOf("window.FILTER_INIT");
  if (anchor === -1) throw new Error("FILTER_INIT not found on /search/");
  const tail = html.slice(anchor);
  const found = extractArrayAfterKey(tail, "products");
  if (!found) throw new Error("products array not found in FILTER_INIT");

  const all = JSON.parse(found.text);
  const kept = all.filter((p) => KEEP_PRODUCT_URLS.has(p.url));
  const missing = [...KEEP_PRODUCT_URLS].filter((u) => !kept.some((p) => p.url === u));
  if (missing.length) {
    console.warn(`  ! curated products no longer present upstream: ${missing.join(", ")}`);
  }
  const replaced = tail.slice(0, found.start) + JSON.stringify(kept) + tail.slice(found.end);
  console.log(`  trimmed products ${all.length} -> ${kept.length}`);
  return html.slice(0, anchor) + replaced;
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

/** Make fixtures deterministic and free of third-party credentials. */
function sanitise(html) {
  return html
    .replace(/data-cfemail="[^"]*"/g, 'data-cfemail="0000000000"')
    .replace(/\/cdn-cgi\/l\/email-protection#[0-9a-fA-F]*/g, "/cdn-cgi/l/email-protection#0000")
    .replace(/kz1_[0-9a-f]{16,}/g, "REDACTED_THIRD_PARTY_TENANT_KEY")
    .replace(/(X-Tenant-Key'?\s*:\s*)['"][^'"]*['"]/g, "$1'REDACTED_THIRD_PARTY_TENANT_KEY'");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const manifest = [];
  for (const page of PAGES) {
    await sleep(DELAY_MS);
    console.log(`fetching ${page.url}`);
    const { status, body } = await get(page.url);
    let html = body;
    if (page.transform) html = page.transform(html);
    html = sanitise(html);
    await writeFile(path.join(OUT_DIR, page.name), html, "utf8");
    manifest.push({ name: page.name, sourcePath: page.url, status, bytes: html.length });
    console.log(`  -> ${page.name} (${status}, ${html.length} bytes)`);
  }
  await writeFile(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ base: BASE, generatedBy: "scripts/build-fixtures.mjs", pages: manifest }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nwrote ${manifest.length} fixtures to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
