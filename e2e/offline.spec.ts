/**
 * The wallet works with no network: the service worker caches its page and the
 * build's assets once a page has loaded, and the tickets are on the device. Pages that
 * need the network say so, offline, and point to the wallet. Chromium's offline mode
 * covers the service worker's own requests too, so a page served here came from the
 * worker's cache, not the server.
 */
import type { Page } from "@playwright/test";
import { axeViolations, expect, test } from "./fixtures";

/** The worker caches the wallet once a page has loaded; wait until it has. */
async function waitUntilReadyOffline(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => Boolean(await caches.match("/tickets", { ignoreVary: true }))))
    .toBe(true);
}

test(
  "a ticket opens with no network: after a reload, and in a new tab",
  { tag: "@both" },
  async ({ page, context, buyer }) => {
    await page.goto("/");
    await buyer.goToPayment(1);
    await buyer.pay();
    await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Saved on this device/)).toBeVisible();
    await waitUntilReadyOffline(page);

    await context.setOffline(true);
    const code = (tab: Page) => tab.getByRole("img", { name: "Code to scan at the door, for Guest 1" });
    await page.goto("/tickets");
    await expect(code(page)).toBeVisible();
    await page.reload();
    await expect(code(page)).toBeVisible();

    // A tab opened later, after the others have gone, still finds the worker.
    await page.close({ runBeforeUnload: true });
    const tab = await context.newPage();
    await tab.goto("/tickets");
    await expect(code(tab)).toBeVisible();
  },
);

test(
  "offline, a page that needs the network says so and points to the wallet",
  { tag: "@both" },
  async ({ page, context }) => {
    await page.goto("/");
    await waitUntilReadyOffline(page);
    await context.setOffline(true);

    const response = await page.goto("/events/open-studio-ceramics");
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { level: 1, name: "You’re offline" })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("link", { name: "Open your tickets" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your tickets" })).toBeVisible();
  },
);

test("the service worker is checked for a new version on every load", { tag: "@both" }, async ({ request }) => {
  for (const path of ["/sw.js", "/mockServiceWorker.js"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()["cache-control"], path).toBe("no-cache");
  }
});
