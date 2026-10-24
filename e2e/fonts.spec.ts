/**
 * What a buyer's page downloads in type: Inter and Space Grotesk, their Latin files
 * only, though every price has a ₹ in it (ADR 010's note on mobile performance).
 */
import { expect, test } from "./fixtures";

test("an event page fetches two font files, whatever its prices say", { tag: "@both" }, async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(new URL(request.url()).pathname);
  });
  await page.goto("/events/monsoon-strings");
  await expect(page.getByText(/^₹/).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts).toHaveLength(2);
});
