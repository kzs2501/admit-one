/**
 * What a buyer's page downloads in type (ADR 022): Mukta's regular and medium, Josefin
 * Sans for headings and Limelight for the name, Latin files only, though every price has
 * a ₹ in it. Mukta keeps ₹ in a 60 KB Devanagari file; the device's own font draws it.
 */
import { expect, test } from "./fixtures";

test("an event page fetches four font files, whatever its prices say", { tag: "@both" }, async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(new URL(request.url()).pathname);
  });
  await page.goto("/events/monsoon-strings");
  await expect(page.getByText(/^₹/).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(fonts).toHaveLength(4);
});
