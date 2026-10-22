/**
 * The door scanner, by photo: it reads a ticket's code, checks its signature with the
 * public key alone, and remembers whom it has let in, all on the device, so it works
 * offline. It reads with the WebAssembly reader here (as Safari and Firefox do), so
 * these tests run alike wherever Chromium runs. Only it may use the camera or compile
 * WebAssembly; the buyer's pages never load its reader.
 */
import type { Page } from "@playwright/test";
import { signDemoTicket } from "../src/core/demo-ticket-key";
import { forgedTicket, photoOfCode, STUDIO, ticketClaims, withoutNativeDetector } from "./door";
import { axeViolations, expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await withoutNativeDetector(page);
});

class Door {
  constructor(readonly page: Page) {}

  get result() {
    return this.page.getByRole("status", { name: "Last scan" });
  }

  get photo() {
    return this.page.getByLabel("Or scan a photo of a ticket");
  }

  async open(eventName = STUDIO.name) {
    await this.page.goto("/scan");
    await this.page.getByLabel("Event at this door").selectOption({ label: eventName });
    await expect(this.photo).toBeEnabled();
  }

  async scan(file: Awaited<ReturnType<typeof photoOfCode>>) {
    await this.photo.setInputFiles(file);
  }
}

test("a ticket bought here gets in once: a photo of it at the door", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.goToPayment(1);
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  await page.goto("/tickets");
  const code = page.getByRole("img", { name: "Code to scan at the door, for Guest 1" });
  const photo = { name: "ticket.png", mimeType: "image/png", buffer: await code.screenshot() };

  const door = new Door(page);
  await door.open();
  await door.scan(photo);
  await expect(door.result).toContainText("Admitted");
  await expect(door.result).toContainText("Guest 1");
  await expect(page.getByText(`1 ticket let in for ${STUDIO.name} on this device.`)).toBeVisible();

  await door.scan(photo);
  await expect(door.result).toContainText("Already scanned");
  await expect(door.result).toContainText(/First scanned at .+ on this device/);
});

test("a refunded ticket is turned away, once the door has its organiser's list, and the wallet says so", async ({
  page,
  buyer,
  organiser,
}) => {
  await page.goto("/");
  await buyer.goToPayment(1);
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  const orderId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await page.goto("/tickets");
  const code = page.getByRole("img", { name: "Code to scan at the door, for Guest 1" });
  const photo = { name: "ticket.png", mimeType: "image/png", buffer: await code.screenshot() };

  // Rangmanch Arts runs Open Studio: its owner refunds the order.
  await organiser.signInAs(/Farah Iyer/);
  await page.goto(`/organiser/orders/${orderId}`);
  await page.getByRole("button", { name: "Refund…" }).click();
  const dialog = page.getByRole("dialog", { name: /^Refund ₹/ });
  await dialog.getByRole("radio", { name: "The event changed" }).check();
  await dialog.getByRole("button", { name: /^Refund ₹/ }).click();
  await expect(organiser.orderStatus).toHaveText("Refunded", { timeout: 10_000 });

  // The door, signed in on this device, fetches the event's refunded tickets.
  const door = new Door(page);
  await door.open();
  await expect(page.getByText(/^Refunds checked at /)).toBeVisible();
  await door.scan(photo);
  await expect(door.result).toContainText("This ticket was refunded.");

  await page.goto("/tickets");
  await expect(page.getByText("Refunded: this ticket no longer gets anyone in.")).toBeVisible();
  await expect(code).toBeHidden();
});

test("turns away a changed ticket, one for another event, and a code that isn't a ticket", async ({ page }) => {
  const forged = await photoOfCode(page, forgedTicket());
  const otherEvent = await photoOfCode(page, signDemoTicket(ticketClaims({ eventSlug: "monsoon-strings" })));
  const notATicket = await photoOfCode(page, "https://example.com/");
  const door = new Door(page);
  await door.open();

  await door.scan(forged);
  await expect(door.result).toContainText("Not valid");
  await expect(door.result).toContainText("the ticket has been changed");
  await door.scan(otherEvent);
  await expect(door.result).toContainText("This ticket is for Monsoon Strings.");
  await door.scan(notATicket);
  await expect(door.result).toContainText("This isn’t an admit-one ticket.");
});

test("reached by its link from the shop, the door still has its own headers, and reads codes", async ({ page }) => {
  const photo = await photoOfCode(page, signDemoTicket(ticketClaims({ code: "AO-LINK-1" })));
  await page.goto("/");
  await page.getByRole("link", { name: "Door scanner" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Door scanner" })).toBeVisible();
  // A full load, so the page's document came with the scanner's own policy.
  expect(await page.evaluate(() => new URL(performance.getEntriesByType("navigation")[0]?.name ?? "").pathname)).toBe(
    "/scan",
  );
  const door = new Door(page);
  await page.getByLabel("Event at this door").selectOption({ label: STUDIO.name });
  await expect(door.photo).toBeEnabled();
  await door.scan(photo);
  await expect(door.result).toContainText("Admitted");
});

test("works with no network, once it has been opened online", async ({ page, context }) => {
  const photo = await photoOfCode(page, signDemoTicket(ticketClaims({ code: "AO-OFFLINE-1" })));
  const door = new Door(page);
  await door.open();
  // The page, and the reader the page has just loaded, are kept for offline.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cached = await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()));
        const urls = cached.flat().map((request) => new URL(request.url).pathname);
        return urls.includes("/scan") && urls.some((url) => /^\/vendor\/zxing_reader-.+\.wasm$/.test(url));
      }),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByLabel("Event at this door").selectOption({ label: STUDIO.name });
  await expect(door.photo).toBeEnabled();
  await door.scan(photo);
  await expect(door.result).toContainText("Admitted");
});

test("only the scanner may use the camera or compile WebAssembly", { tag: "@both" }, async ({ request }) => {
  for (const path of ["/", "/tickets", `/events/${STUDIO.slug}`]) {
    const headers = (await request.get(path)).headers();
    expect(headers["permissions-policy"], path).toContain("camera=()");
    expect(headers["content-security-policy"], path).not.toContain("wasm-unsafe-eval");
  }
  const scanner = (await request.get("/scan")).headers();
  expect(scanner["permissions-policy"]).toContain("camera=(self)");
  expect(scanner["content-security-policy"]).toContain("'wasm-unsafe-eval'");
  expect(scanner["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("the buyer's pages never load the scanner's reader", async ({ page }) => {
  const readerRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("zxing")) readerRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("link", { name: /Open Studio/ }).click();
  await expect(page.getByRole("button", { name: "Reserve tickets" })).toBeVisible();
  await page.goto("/tickets");
  await expect(page.getByRole("heading", { level: 1, name: "Your tickets" })).toBeVisible();
  expect(readerRequests).toEqual([]);

  // The scanner does load it, so the check above can fail.
  await new Door(page).open();
  expect(readerRequests).not.toEqual([]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`no axe violations at the door (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const admitted = await photoOfCode(page, signDemoTicket(ticketClaims({ code: `AO-AXE-${scheme}` })));
    const door = new Door(page);
    await door.open();
    expect(await axeViolations(page), "ready").toEqual([]);
    await door.scan(admitted);
    await expect(door.result).toContainText("Admitted");
    expect(await axeViolations(page), "admitted").toEqual([]);
    await door.scan(admitted);
    await expect(door.result).toContainText("Already scanned");
    expect(await axeViolations(page), "already scanned").toEqual([]);
  });
}

test("no horizontal scroll at 375px at the door", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await new Door(page).open();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
