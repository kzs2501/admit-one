/**
 * The wallet works with no network: the service worker caches its page and the
 * build's assets once a page has loaded, and the tickets are on the device. Pages that
 * need the network say so, offline, and point to the wallet. Chromium's offline mode
 * covers the service worker's own requests too, so a page served here came from the
 * worker's cache, not the server.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { axeViolations, expect, test } from "./fixtures";

/** The app's service worker, which a page has started. */
function serviceWorkerOf(context: BrowserContext) {
  const [worker] = context.serviceWorkers();
  if (!worker) throw new Error("No service worker has started");
  return worker;
}

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

test("a cache that can't be written to doesn't turn an answered page into “offline”", async ({ page, context }) => {
  await page.goto("/");
  await waitUntilReadyOffline(page);
  const worker = serviceWorkerOf(context);
  // A full disk: every write to the cache fails, and nothing is cached yet.
  await worker.evaluate(async () => {
    for (const name of await caches.keys()) await caches.delete(name);
    Cache.prototype.put = () => Promise.reject(new DOMException("The disk is full", "QuotaExceededError"));
  });
  await page.goto("/tickets");
  await expect(page.getByRole("heading", { level: 1, name: "Your tickets" })).toBeVisible();
});

test("a buyer's device doesn't cache the door scanner, and a door's does", async ({ page }) => {
  const isCached = (path: string) =>
    page.evaluate(async (wanted) => Boolean(await caches.match(wanted, { ignoreVary: true })), path);
  await page.goto("/");
  await waitUntilReadyOffline(page);
  expect(await isCached("/scan")).toBe(false);
  await page.goto("/scan");
  await expect.poll(() => isCached("/scan")).toBe(true);
});

test("the sandbox's mock backend sees the API, and nothing else", async ({ page, context }) => {
  await page.goto("/");
  await waitUntilReadyOffline(page);
  const worker = serviceWorkerOf(context);
  // Count what reaches MSW's own request handler, inside the worker.
  await worker.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(globalThis, "__mswSaw", seen);
    /** All this test needs of a service worker's fetch event. */
    interface Fetched {
      request: Request;
    }
    const handle = Reflect.get(globalThis, "handleRequest") as (event: Fetched, id: string) => unknown;
    Reflect.set(globalThis, "handleRequest", (event: Fetched, id: string) => {
      seen.push(new URL(event.request.url).pathname);
      return handle(event, id);
    });
  });
  // The kinds of request a page makes besides the API: the manifest, an icon, a React
  // Server Components payload (as a client-side navigation fetches it); and one API call.
  await page.evaluate(() =>
    Promise.all([
      fetch("/manifest.webmanifest"),
      fetch("/icons/icon-192.png"),
      fetch("/tickets?_rsc=test", { headers: { RSC: "1" } }),
      fetch("/api/events"),
    ]),
  );
  const seen = await worker.evaluate(() => Reflect.get(globalThis, "__mswSaw") as string[]);
  expect(seen).toEqual(["/api/events"]);
});

test("the service worker is checked for a new version on every load", { tag: "@both" }, async ({ request }) => {
  for (const path of ["/sw.js", "/mockServiceWorker.js"]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()["cache-control"], path).toBe("no-cache");
  }
});
