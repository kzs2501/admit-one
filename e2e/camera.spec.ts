/**
 * The door scanner with a camera: Chromium's fake camera plays a feed with a signed
 * ticket in it (written by global-setup.ts), the way a phone's camera would see one
 * held up to it. The scan log outlives a reload, so the same ticket then reads as used.
 * And only the scanner may have the camera, even with the permission granted.
 */
import { CAMERA_TICKET, STUDIO, withoutNativeDetector } from "./door";
import { expect, test } from "./fixtures";

test("the camera reads a ticket held up to it, and the door remembers it", async ({ page }) => {
  await withoutNativeDetector(page);
  const result = page.getByRole("status", { name: "Last scan" });
  const openDoor = async () => {
    await page.goto("/scan");
    await page.getByLabel("Event at this door").selectOption({ label: STUDIO.name });
    await page.getByRole("button", { name: "Start the camera" }).click();
    await expect(page.getByLabel("Camera view")).toBeVisible();
  };

  await openDoor();
  await expect(result).toContainText("Admitted", { timeout: 10_000 });
  await expect(result).toContainText(CAMERA_TICKET.attendeeName);

  await page.reload();
  await openDoor();
  await expect(result).toContainText("Already scanned", { timeout: 10_000 });
});

test("no other page may use the camera", async ({ page }) => {
  await page.goto("/tickets");
  const refusal = await page.evaluate(() =>
    navigator.mediaDevices.getUserMedia({ video: true }).then(
      () => "allowed",
      (error: unknown) => (error instanceof DOMException ? error.name : "failed"),
    ),
  );
  // The page's Permissions-Policy says camera=(), so the browser refuses before asking.
  expect(refusal).toBe("NotAllowedError");
});
