import { expect, type Page } from "@playwright/test";

/**
 * The newsletter band, and the check that comes to it late.
 *
 * Every page gets the band's form without react-hook-form and zod; they are
 * fetched when the band nears the screen or the form is touched, and then
 * take it over (`components/forms/newsletter-form.tsx`), which the form shows
 * with `data-enhanced`. A spec about the browser's own check waits for that;
 * one about the time before it holds the check back.
 */

export const newsletterBand = (page: Page) => page.locator("aside[data-newsletter-band]");

/** What only react-hook-form's code says, and what only zod's does. */
export const LIBRARY_MARKERS = {
  "react-hook-form": "shouldUnregister",
  zod: "invalid_type",
} as const;

/**
 * What only the script of the takeover itself says: the bundler registers a
 * module's exports by name, quoted, where the module is; the form that loads
 * it reads the name as a property, unquoted. The libraries under it can come
 * by another way too (a link's prefetch of the cart page, whose order form
 * uses them), so it is this script that says when the check was asked for.
 */
export const ENHANCEMENT_MARKER = '"NewsletterEnhancement"';

/** Bring the band into view, which fetches its check, and wait until it has taken over. */
export async function newsletterChecked(page: Page): Promise<void> {
  await newsletterBand(page).scrollIntoViewIfNeeded();
  await expect(newsletterBand(page).locator("form[data-enhanced]")).toBeAttached();
}

/**
 * Hold back the takeover's script until `release`: the time between a person
 * reaching the form and its check arriving, which on a phone on a slow network
 * is long, made as long as the spec needs. Install before the page loads;
 * every other script passes untouched.
 */
export async function holdTheCheck(
  page: Page,
): Promise<{ requested: Promise<void>; release: () => void }> {
  let release = () => {};
  const released = new Promise<void>((resolve) => (release = resolve));
  let asked = () => {};
  const requested = new Promise<void>((resolve) => (asked = resolve));
  await page.route("**/_next/static/chunks/**", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.includes(ENHANCEMENT_MARKER)) {
      asked();
      await released;
    }
    await route.fulfill({ response, body });
  });
  return { requested, release };
}
