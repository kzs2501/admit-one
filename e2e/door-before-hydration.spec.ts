/**
 * A door chosen before the page is interactive. On a slow phone the scanner's HTML
 * arrives well before its JavaScript, and a choice made in between must not be lost.
 */
import { signDemoTicket } from "../src/core/demo-ticket-key";
import { photoOfCode, STUDIO, ticketClaims, withoutNativeDetector } from "./door";
import { expect, test } from "./fixtures";

test("an event chosen before the page is interactive is the one the door checks", async ({ page }) => {
  await withoutNativeDetector(page);
  const photo = await photoOfCode(page, signDemoTicket(ticketClaims({ code: "AO-EARLY-1" })));
  // The page's scripts arrive two seconds late, as on a slow connection.
  await page.route("**/_next/static/chunks/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await page.goto("/scan", { waitUntil: "commit" });
  await page.getByLabel("Event at this door").selectOption({ label: STUDIO.name });
  const photoInput = page.getByLabel("Or scan a photo of a ticket");
  await expect(photoInput).toBeEnabled({ timeout: 15_000 });
  await photoInput.setInputFiles(photo);
  await expect(page.getByRole("status", { name: "Last scan" })).toContainText("Admitted");
});
