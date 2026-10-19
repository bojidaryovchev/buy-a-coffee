#!/usr/bin/env tsx
/**
 * Take the web app manifest's screenshots (`src/app/manifest.ts`) from real
 * pages of a running production build.
 *
 *   pnpm --filter @catalog/web build && pnpm --filter @catalog/web start
 *   pnpm --filter @catalog/web exec tsx scripts/pwa-screenshots.ts --base-url http://127.0.0.1:3000
 *
 * Writes `public/screenshots/*.jpg` at exactly the sizes the manifest
 * declares, which `test/manifest.test.ts` checks against the files. The
 * install sheet shows them as they are, so they are the shop's own pages with
 * its own photographs — retake them when the design changes, against a
 * catalog with real images (production data, or the local one after a sync
 * mirrored the photographs).
 *
 * Read-only against whatever it is pointed at: it loads pages, nothing else.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, devices } from "@playwright/test";

const SHOTS = [
  {
    file: "home-narrow.jpg",
    path: "/bg",
    // 360 × 640 CSS pixels at 3×: 1080 × 1920, a phone in portrait.
    context: { ...devices["Pixel 7"], viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 },
  },
  {
    file: "product-narrow.jpg",
    // A product page: the pack whole, its price and its price per cup. The
    // first product the Nespresso listing shows, found when the script runs.
    path: "first-product:/bg/nespresso-kapsuli",
    context: { ...devices["Pixel 7"], viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 },
  },
  {
    file: "home-wide.jpg",
    path: "/bg",
    // 1280 × 720 at 1.5×: 1920 × 1080, a laptop screen.
    context: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 },
  },
] as const;

/** The first product card's address on a listing. */
async function firstProduct(baseUrl: string, listing: string): Promise<string> {
  const html = await (await fetch(`${baseUrl}${listing}`)).text();
  for (const article of html.matchAll(/<article\b[\s\S]*?<\/article>/g)) {
    const link = /<a\b[^>]*\bhref="(\/bg\/[a-z0-9-]+)"/.exec(article[0]);
    if (link) return link[1]!;
  }
  throw new Error(`${listing} lists no product`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--base-url");
  const baseUrl = (at === -1 ? "http://127.0.0.1:3000" : argv[at + 1]!).replace(/\/+$/, "");
  const out = path.resolve(import.meta.dirname, "../public/screenshots");
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch();
  try {
    for (const shot of SHOTS) {
      const target = shot.path.startsWith("first-product:")
        ? await firstProduct(baseUrl, shot.path.slice("first-product:".length))
        : shot.path;
      const context = await browser.newContext({ ...shot.context, reducedMotion: "reduce" });
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}${target}`, { waitUntil: "load" });
      if (response?.status() !== 200) throw new Error(`${target} answered ${response?.status()}`);
      /*
       * Every image in the viewport decoded, so no grey placeholder is
       * captured. Only those: a lazy image further down never loads until it
       * is scrolled to, and waiting for it would wait forever. Bounded anyway.
       */
      await page.evaluate(async () => {
        const visible = [...document.images].filter((image) => {
          const box = image.getBoundingClientRect();
          return box.bottom > 0 && box.top < window.innerHeight && box.width > 0;
        });
        await Promise.race([
          Promise.all(
            visible.map((image) => (image.complete ? null : image.decode().catch(() => null))),
          ),
          new Promise((resolve) => setTimeout(resolve, 8000)),
        ]);
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, shot.file), type: "jpeg", quality: 82 });
      console.log(`wrote public/screenshots/${shot.file} from ${target}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
