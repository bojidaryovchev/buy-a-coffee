import { expect, test } from "@playwright/test";
import { BG, PRODUCT_LINK } from "./support/paths";

/**
 * The illy X7.1 is an Iperespresso machine, and nothing on the site may offer
 * it pods (`test/illy-x7-correction.test.ts` holds the data and the wizard's
 * parsing; this holds what a production build serves). Until 20 October 2026
 * it was listed for ESE pods, with no source.
 *
 * Literal addresses and words, as the other specs write them.
 */

test.describe("the illy X7.1", () => {
  test("is on the illy page among the machines we have nothing for, and nowhere else", async ({
    page,
  }) => {
    await page.goto(BG.machineBrand("illy"));
    const unsupported = page.locator("main section", {
      has: page.getByRole("heading", { name: "Модели, за които не предлагаме кафе" }),
    });
    await expect(unsupported).toContainText("X7.1 Iperespresso");
    // Not in a pods group, if the page has one, and no anchor under the old slug.
    const pods = page.locator("main section", {
      has: page.getByRole("heading", { name: "Дози ESE", exact: true }),
    });
    // Read, not awaited: today the page has no pods group at all.
    expect((await pods.allInnerTexts()).join(" ")).not.toContain("X7");
    await expect(page.locator("main #illy-x7-ese")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("X7.1 (версия за дози)");
  });

  test("is not among the machines a pod's own page fits", async ({ page }) => {
    await page.goto(BG.pods);
    const first = await page.locator(`main ${PRODUCT_LINK}`).first().getAttribute("href");
    await page.goto(first as string);
    const fits = page.locator("main section", {
      has: page.getByRole("heading", { name: "Става за тези машини" }),
    });
    await expect(fits).toContainText("De'Longhi Dedica");
    await expect(fits).not.toContainText("X7");
  });

  /*
   * The wizard recommends only with a system, and the X7.1 under either slug
   * never leaves one standing: the result page sends the visitor back to the
   * first question instead of listing pods.
   */
  for (const query of [
    "machine=illy-x7",
    "machine=illy-x7&system=ese-pod",
    "machine=illy-x7-ese",
    "machine=illy-x7-ese&system=ese-pod",
    "machine=illy-x7-ese&system=ese-pod&brew=pod&taste=intense&volume=light",
  ]) {
    test(`gets no pods from the wizard: ${query}`, async ({ request }) => {
      const response = await request.get(`${BG.wizardResult}?${query}`, { maxRedirects: 0 });
      expect([302, 303, 307, 308]).toContain(response.status());
      expect(new URL(response.headers()["location"] ?? "", "http://shop.test").pathname).toBe(
        BG.wizard,
      );
    });
  }

  test("the wizard's own page lists no pods for an old X7.1 link", async ({ page }) => {
    await page.goto(
      `${BG.wizard}?machine=illy-x7-ese&system=ese-pod&brew=pod&taste=intense&volume=light`,
    );
    await expect(page.locator(`main a[href*="-kafe-dozi-"]`)).toHaveCount(0);
  });
});
