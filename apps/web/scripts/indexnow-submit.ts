#!/usr/bin/env tsx
/**
 * Submit every URL in the live sitemap to IndexNow, once.
 *
 *   INDEXNOW_KEY=… pnpm --filter @catalog/web indexnow:submit -- --dry-run
 *   INDEXNOW_KEY=… pnpm --filter @catalog/web indexnow:submit
 *
 * For the day the key is first deployed, and after a change that moved many
 * URLs at once. Day to day the catalog sync submits only the product pages it
 * changed, through the same `submitIndexNow` (`@catalog/shared/indexnow`).
 *
 * Before sending anything it checks that the site really serves the key at
 * `/<key>.txt`: the engines fetch that file and refuse the whole submission
 * when it is missing, and a refusal is easier to explain before than after.
 * `--dry-run` stops after that check and lists what would be sent.
 *
 * Options:
 *   --site <url>     the site (default NEXT_PUBLIC_SITE_URL, else https://buy-a-coffee.com)
 *   --sitemap <url>  the sitemap to read (default <site>/sitemap.xml)
 *   --dry-run        check and list, send nothing
 *
 * The key is read from INDEXNOW_KEY only, never from an argument, so it does
 * not end up in shell history. Without it the script says so and exits 1.
 */
import { indexNowKeyLocation, isIndexNowKey, submitIndexNow } from "@catalog/shared/indexnow";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

/** Every `<loc>` in a sitemap, in order, each once. */
export function sitemapLocations(xml: string): string[] {
  const decode = (text: string) =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]!)))];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const site = (
    option(argv, "site") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://buy-a-coffee.com"
  ).replace(/\/+$/, "");
  const sitemap = option(argv, "sitemap") ?? `${site}/sitemap.xml`;
  const dryRun = argv.includes("--dry-run");
  const key = process.env.INDEXNOW_KEY?.trim();

  if (!isIndexNowKey(key)) {
    console.error(
      key
        ? "INDEXNOW_KEY is not a valid key: 8 to 128 characters of a-z, A-Z, 0-9 and dashes."
        : "INDEXNOW_KEY is not set. Nothing to submit with.",
    );
    process.exitCode = 1;
    return;
  }

  const location = indexNowKeyLocation(site, key);
  const served = await fetch(location, { redirect: "manual" });
  const body = served.ok ? (await served.text()).trim() : "";
  if (body !== key) {
    console.error(
      `${location} answered ${served.status}${served.ok ? " without the key" : ""}. ` +
        "Deploy INDEXNOW_KEY to the site first: the engines would refuse every URL.",
    );
    process.exitCode = 1;
    return;
  }

  const response = await fetch(sitemap);
  if (!response.ok) throw new Error(`${sitemap} answered ${response.status}`);
  const urls = sitemapLocations(await response.text());
  console.log(`${urls.length} URLs in ${sitemap}; key served at ${location}.`);

  if (dryRun) {
    for (const url of urls) console.log(`  ${url}`);
    console.log("Dry run: nothing sent.");
    return;
  }

  const result = await submitIndexNow({ siteUrl: site, key, urls });
  console.log(
    `Submitted ${result.submitted} URLs (${result.foreign} not on ${new URL(site).host}, left out); ` +
      `IndexNow answered ${result.statuses.join(", ") || "nothing"}.`,
  );
  if (!result.ok) process.exitCode = 1;
}

/* Run only as a script, so a test can import `sitemapLocations`. */
if (process.argv[1] && /indexnow-submit\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
