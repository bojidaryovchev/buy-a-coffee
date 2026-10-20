import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForHydration } from "./support/hydration";
import { BG } from "./support/paths";
import {
  ENHANCEMENT_MARKER,
  LIBRARY_MARKERS,
  asNewVisitor,
  holdTheCheck,
  newsletterBand,
} from "./support/newsletter";

/**
 * The newsletter band's check, which no page loads with itself.
 *
 * The band is on almost every page, below the fold, and its check in the
 * browser is react-hook-form and zod. A page now loads the plain form only;
 * the check is fetched when the band nears the screen or the form is touched,
 * and takes the form over without redrawing it
 * (`components/forms/newsletter-form.tsx`). What these prove, with the
 * network as the evidence rather than a clock:
 *
 *   - the home page, left alone for three seconds after its load, fetches no
 *     script with either library in it, its own or a prefetched page's, and
 *     the takeover's script is asked for only once the band is scrolled near;
 *   - what is typed before the check arrives is still there after it, in the
 *     same field, with the focus and the caret where they were, nothing on
 *     the page moves, and it is sent;
 *   - a press before the check arrives is refused by the plain form if the
 *     field is empty, without a request, and otherwise answered by the
 *     server; that answer is still the one on the screen after the takeover,
 *     and goes as the field is put right.
 *
 * Without JavaScript the form is unchanged: `frame.spec.ts` subscribes and
 * `forms.spec.ts` is refused, both with scripts off. The browser's check once
 * it is in is `forms.spec.ts` too.
 */

const form = (page: Page) => newsletterBand(page).locator("form");
const email = (page: Page) => newsletterBand(page).getByRole("textbox", { name: "Имейл адрес" });
const enhanced = (page: Page) => newsletterBand(page).locator("form[data-enhanced]");
/** The form as drawn, less the one attribute that tells the two forms apart. */
const drawn = (page: Page) =>
  form(page).evaluate((element) => element.outerHTML.replace(' data-enhanced=""', ""));
/**
 * Where the form is on the page rather than in the window: focusing a field
 * scrolls to it, smoothly (`scroll-behavior: smooth`), so a box read from the
 * window can differ from one read a moment later with nothing having moved.
 */
const place = (page: Page) =>
  form(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
  });

const EMAIL_MISSING = "Въведете имейл адреса си.";
const EMAIL_FORMAT = "Въведете целия имейл адрес, например ivan@example.com.";

const uniqueAddress = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** Server-action POSTs from this page, counted as they leave. */
function countActions(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) count += 1;
  });
  return () => count;
}

/** The message under a field, by the error paragraph its `aria-describedby` names. */
async function expectError(field: Locator, message: string): Promise<void> {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const id = ((await field.getAttribute("aria-describedby")) ?? "")
    .split(/\s+/)
    .find((value) => value.endsWith("-error"));
  expect(id).toBeTruthy();
  await expect(field.page().locator(`[id="${id}"]`)).toHaveText(message);
}

/**
 * Layout shifts from now on that involve the band, every one of them: CLS
 * leaves out those just after input, and the takeover may come just after a
 * keystroke, so this does not.
 */
async function watchShifts(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const band = document.querySelector("aside[data-newsletter-band]");
    const record = window as unknown as { bandShift: number };
    record.bandShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        sources?: { node?: Node | null }[];
      }[]) {
        const involved = (entry.sources ?? []).some(
          (source) => source.node && (band?.contains(source.node) || source.node.contains(band)),
        );
        if (involved) record.bandShift += entry.value;
      }
    }).observe({ type: "layout-shift" });
  });
  return () => page.evaluate(() => (window as unknown as { bandShift: number }).bandShift);
}

test.describe("the newsletter band's check", () => {
  /* A script asked for as a test ends (a prefetch of a link that has come into
     view) can still be in `holdTheCheck`'s handler when the page closes;
     letting it go quietly keeps a finished test from failing on it. */
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("is not loaded by the home page, idle, at all; only as the band nears the screen", async ({
    page,
    request,
  }) => {
    let scrolled = false;
    const scripts: { url: string; scrolled: boolean }[] = [];
    page.on("request", (sent) => {
      if (sent.resourceType() === "script") scripts.push({ url: sent.url(), scrolled });
    });
    await page.goto(BG.home);
    // Three seconds of a page left alone after its load: no scroll, no input.
    // Prefetches of the links on the screen happen in this time.
    await page.waitForTimeout(3000);
    const text = async (url: string) => (await request.get(url)).text();

    // Far enough down that only scrolling brings it near: more than the
    // margin, a screen and a half, below the first screen.
    const viewport = page.viewportSize()!;
    const top = await newsletterBand(page).evaluate((band) => band.getBoundingClientRect().top);
    expect(top).toBeGreaterThan(viewport.height * 2.5);

    // Every script fetched so far, the document's own and whatever came after:
    // neither library, and not the takeover.
    const idle = scripts.filter((script) => !script.scrolled);
    expect(idle.length).toBeGreaterThan(0);
    for (const { url } of idle) {
      const body = await text(url);
      expect(body, url).not.toContain(LIBRARY_MARKERS["react-hook-form"]);
      expect(body, url).not.toContain(LIBRARY_MARKERS.zod);
      expect(body, url).not.toContain(ENHANCEMENT_MARKER);
    }
    await expect(enhanced(page)).toHaveCount(0);

    scrolled = true;
    await newsletterBand(page).scrollIntoViewIfNeeded();
    await expect(enhanced(page)).toHaveCount(1);
    const fetched = await Promise.all(
      scripts.filter((script) => script.scrolled).map((script) => text(script.url)),
    );
    expect(fetched.some((body) => body.includes(ENHANCEMENT_MARKER))).toBe(true);
    expect(fetched.some((body) => body.includes(LIBRARY_MARKERS["react-hook-form"]))).toBe(true);
  });

  test("keeps what was typed before it arrived — the same field, focus and caret — and sends it", async ({
    page,
  }) => {
    await asNewVisitor(page);
    const hold = await holdTheCheck(page);
    await page.goto(BG.delivery);
    await waitForHydration(page);
    const sent = countActions(page);

    const address = uniqueAddress();
    await email(page).click();
    await hold.requested;
    await page.keyboard.type(address);
    // The caret back before „.com“, where only a caret that was kept can be.
    for (let step = 0; step < 4; step += 1) await page.keyboard.press("ArrowLeft");
    await email(page).evaluate((field) => field.setAttribute("data-e2e-typed-here", ""));
    await expect(enhanced(page)).toHaveCount(0);
    const box = await place(page);
    const shifts = await watchShifts(page);

    hold.release();
    await expect(enhanced(page)).toHaveCount(1);
    // Not a field drawn again with the text put back: the one typed in.
    await expect(email(page)).toHaveAttribute("data-e2e-typed-here", "");
    await expect(email(page)).toBeFocused();
    await expect(email(page)).toHaveValue(address);
    expect(await place(page)).toEqual(box);
    expect(await shifts()).toBe(0);

    await page.keyboard.type("x");
    await expect(email(page)).toHaveValue(address.replace(/\.com$/, "x.com"));
    await page.keyboard.press("Backspace");
    await expect(email(page)).toHaveValue(address);

    await page.keyboard.press("Enter");
    await expect(newsletterBand(page).getByRole("status")).toContainText("Благодарим");
    expect(sent()).toBe(1);
  });

  test("answers a press made before it arrived from the server, and leaves that answer as it was", async ({
    page,
  }) => {
    await asNewVisitor(page);
    const hold = await holdTheCheck(page);
    await page.goto(BG.delivery);
    await waitForHydration(page);
    const sent = countActions(page);

    // An empty field the plain form refuses itself: no request, no try spent.
    await email(page).press("Enter");
    await hold.requested;
    await expectError(email(page), EMAIL_MISSING);
    expect(sent()).toBe(0);

    await email(page).fill("ivan@example");
    await email(page).press("Enter");
    // The plain form sent it, and the server's message is under the field.
    await expectError(email(page), EMAIL_FORMAT);
    await expect(email(page)).toBeFocused();
    expect(sent()).toBe(1);
    await expect(enhanced(page)).toHaveCount(0);
    const before = await drawn(page);
    const box = await place(page);
    const shifts = await watchShifts(page);

    hold.release();
    await expect(enhanced(page)).toHaveCount(1);
    expect(await drawn(page)).toBe(before);
    expect(await place(page)).toEqual(box);
    expect(await shifts()).toBe(0);
    await expect(email(page)).toBeFocused();

    // From now on the browser checks, and the refusal goes as it is put right.
    await email(page).fill("ivan@example.com");
    await expect(email(page)).not.toHaveAttribute("aria-invalid", "true");
    await email(page).fill("");
    await email(page).press("Enter");
    await expectError(email(page), EMAIL_MISSING);
    expect(sent()).toBe(1);

    await email(page).fill(uniqueAddress());
    await email(page).press("Enter");
    await expect(newsletterBand(page).getByRole("status")).toContainText("Благодарим");
    expect(sent()).toBe(2);
  });
});
