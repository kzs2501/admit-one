/**
 * The organisers' dashboard: what an organiser sees, what they may do, and how it
 * stays true while sales go on around it. Expected numbers come from the same seeded
 * history the server generates, so nothing is written down twice.
 */
import { readFileSync } from "node:fs";
import { getHistory } from "../src/backend/domain/history";
import { CATALOG, getEvent } from "../src/core/catalog";
import { formatCount, formatMoney } from "../src/lib/format";
import { axeViolations, expect, test } from "./fixtures";

const LAKESIDE_EVENTS = new Set(
  CATALOG.filter((event) => event.organiserId === "lakeside-live").map((event) => event.slug),
);
const lakesideOrders = getHistory().orders.filter((order) => LAKESIDE_EVENTS.has(order.eventSlug));
const festivalOrder = (nth: number) =>
  getHistory().orders.filter((order) => order.eventSlug === "lakeside-lights" && order.status === "fulfilled")[nth]
    ?.id ?? "";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("overview: sign in, and see the festival's tickets sold", async ({ page, organiser }) => {
  await page.getByRole("link", { name: /organisers/i }).click();
  await expect(page).toHaveURL(/\/organiser\/sign-in$/);
  await organiser.signInAs(/Nandini Rao/);
  await page.getByLabel("Show").selectOption({ label: "Lakeside Lights Festival" });
  await expect(page).toHaveURL(/\?event=lakeside-lights$/);
  const sold = getEvent("lakeside-lights").tiers.reduce((sum, tier) => sum + tier.baselineSold, 0);
  await expect(organiser.kpi("Tickets sold")).toHaveText(formatCount(sold));
  await expect(page.getByRole("img", { name: new RegExp(`^${formatCount(sold)} tickets sold from`) })).toBeVisible();
});

test("filters live in the URL: a reload keeps them, and Back undoes the last one", async ({ page, organiser }) => {
  await organiser.signInAs(/Nandini Rao/);
  await organiser.openOrders();
  await expect(organiser.orderCount).toHaveText(`${formatCount(lakesideOrders.length)} orders`);

  await page.getByRole("checkbox", { name: "Refunded" }).check();
  await expect(page).toHaveURL(/status=refunded/);
  await page.getByLabel("Paid with").selectOption("upi");
  await expect(page).toHaveURL(/status=refunded&method=upi/);
  const refundedByUpi = lakesideOrders.filter((order) => order.status === "refunded" && order.method === "upi");
  await expect(organiser.orderCount).toHaveText(`${formatCount(refundedByUpi.length)} orders`);

  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Refunded" })).toBeChecked();
  await expect(page.getByLabel("Paid with")).toHaveValue("upi");

  await page.goBack();
  await expect(page.getByLabel("Paid with")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "Refunded" })).toBeChecked();
});

test("the table is whole though virtualised: sorted by the server, loading as it scrolls, keeping focus", async ({
  page,
  organiser,
}) => {
  await organiser.signInAs(/Nandini Rao/);
  await organiser.openOrders();
  const table = page.getByRole("table");
  await expect(table).toHaveAttribute("aria-rowcount", String(lakesideOrders.length + 1));
  expect(await table.locator("tbody tr[data-index]").count()).toBeLessThan(60);

  await page.getByRole("button", { name: "Total" }).click();
  await expect(page).toHaveURL(/orderBy=totalMinor\+desc/);
  await expect(page.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending");
  const largest = Math.max(...lakesideOrders.map((order) => order.amounts.totalMinor));
  await expect(table.locator("tbody tr[data-index]").first()).toContainText(formatMoney(largest, "INR"));

  const firstLink = table.locator("tbody tr[data-index]").first().getByRole("link");
  await firstLink.focus();
  const region = page.getByRole("region", { name: /^Orders,/ });
  await expect
    .poll(async () => {
      await region.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      return Math.max(
        ...(await table
          .locator("tbody tr[data-index]")
          .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute("aria-rowindex"))))),
      );
    })
    .toBeGreaterThan(250);
  await expect(firstLink).toBeFocused(); // still drawn, though far out of view
});

test("exports the filtered orders as CSV", async ({ page, organiser }) => {
  await organiser.signInAs(/Nandini Rao/);
  await organiser.openOrders();
  await page.getByRole("checkbox", { name: "Expired" }).check();
  const expired = lakesideOrders.filter((order) => order.status === "expired");
  await expect(organiser.orderCount).toHaveText(`${formatCount(expired.length)} orders`);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^lakeside-live-orders-\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, ...records] = readFileSync(await download.path(), "utf8")
    .trimEnd()
    .split("\r\n");
  expect(header).toBe(
    "﻿order_id,event,created_at_local,buyer_name,buyer_email,tickets,status,payment_method,total,currency",
  );
  expect(records).toHaveLength(expired.length);
  expect(records.every((record) => record.includes(",expired,"))).toBe(true);
});

test("a refund shows as pending at once, then refunded when the provider confirms", async ({ page, organiser }) => {
  await organiser.signInAs(/Nandini Rao/);
  await page.goto(`/organiser/orders/${festivalOrder(0)}`);
  await expect(organiser.orderStatus).toHaveText("Fulfilled");

  await page.getByRole("button", { name: "Refund…" }).click();
  const dialog = page.getByRole("dialog", { name: /^Refund ₹/ });
  await dialog.getByRole("radio", { name: "The event changed" }).check();
  await dialog.getByRole("button", { name: /^Refund ₹/ }).click();

  await expect(organiser.orderStatus).toHaveText("Refund pending");
  await expect(page.getByText("Refund started.", { exact: false })).toBeFocused();
  await expect(organiser.orderStatus).toHaveText("Refunded", { timeout: 10_000 });
  await expect(page.getByRole("listitem").filter({ hasText: "The event changed" })).toContainText("refunded");
});

test("when the provider refuses, the refund rolls back and says why", async ({ page, organiser, sandbox }) => {
  await organiser.signInAs(/Nandini Rao/);
  await sandbox.choosePreset("Refunds fail");
  await page.goto(`/organiser/orders/${festivalOrder(1)}`);
  await page.getByRole("button", { name: "Refund…" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Refund ₹/ })
    .click();

  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("The refund didn’t go through");
  await expect(alert).toContainText("couldn’t start the refund");
  await expect(page.locator(":focus")).toContainText("The refund didn’t go through");
  await expect(organiser.orderStatus).toHaveText("Fulfilled");
  await expect(page.getByRole("button", { name: "Refund…" })).toBeVisible();
});

test("each account sees only its organisation's orders, and only what its role allows", async ({ page, organiser }) => {
  await organiser.signInAs(/Arjun Mehta/);
  await page.goto(`/organiser/orders/${festivalOrder(2)}`);
  await expect(organiser.orderStatus).toHaveText("Fulfilled");
  await expect(page.getByRole("button", { name: "Refund…" })).toHaveCount(0);
  // The button is only a convenience: the server refuses the box office too.
  const status = await page.evaluate(async (orderId) => {
    const { token } = JSON.parse(sessionStorage.getItem("admit-one:organiser-session") ?? "{}") as { token?: string };
    const response = await fetch(`/api/organiser/orders/${orderId}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token ?? ""}`,
        "Idempotency-Key": "box-office-try",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "other" }),
    });
    return response.status;
  }, festivalOrder(2));
  expect(status).toBe(403);

  await page.getByRole("button", { name: "Sign out" }).click();
  await organiser.signInAs(/Farah Iyer/);
  await page.goto(`/organiser/orders/${festivalOrder(2)}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("That order isn’t here");
});

test("live: other buyers' sales appear without a reload, and pausing stops them", async ({
  page,
  organiser,
  sandbox,
}) => {
  await organiser.signInAs(/Farah Iyer/);
  const sold = organiser.kpi("Tickets sold");
  const before = await sold.textContent();
  await sandbox.choosePreset("Busy on-sale");
  await expect(sold).not.toHaveText(before ?? "", { timeout: 20_000 });

  await page.getByRole("button", { name: "Pause live updates" }).click();
  await expect(organiser.liveStatus).toHaveText("Paused");
  const paused = await sold.textContent();
  const rangmanchTiers = new Set(
    CATALOG.filter((event) => event.organiserId === "rangmanch-arts").flatMap((event) =>
      event.tiers.map((tier) => tier.id),
    ),
  );
  const theirSales = async () =>
    (await sandbox.state()).liveSales.filter((sale) => rangmanchTiers.has(sale.tierId)).length;
  const salesWhenPaused = await theirSales();
  await expect.poll(theirSales, { timeout: 30_000 }).toBeGreaterThan(salesWhenPaused + 1);
  await expect(sold).toHaveText(paused ?? "");

  // Stop the crowd, so nothing new happens after resuming: only catching up on what was
  // missed while paused can change the number now.
  await sandbox.choosePreset("Happy path");
  await page.getByRole("button", { name: "Pause live updates" }).click();
  await expect(organiser.liveStatus).toHaveText("Live");
  await expect(sold).not.toHaveText(paused ?? "");
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations on the dashboard, the table, an order and the refund dialog (${scheme})`, async ({
      page,
      organiser,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await organiser.signInAs(/Nandini Rao/);
      await expect(page.getByRole("img", { name: /tickets sold from/ })).toBeVisible();
      expect(await axeViolations(page), "overview").toEqual([]);
      await organiser.openOrders();
      await expect(organiser.orderCount).toBeVisible();
      expect(await axeViolations(page), "orders").toEqual([]);
      await page.goto(`/organiser/orders/${festivalOrder(3)}`);
      await expect(organiser.orderStatus).toBeVisible();
      expect(await axeViolations(page), "order").toEqual([]);
      await page.getByRole("button", { name: "Refund…" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await axeViolations(page), "refund dialog").toEqual([]);
    });
  }

  test("no sideways scroll at 375 px — the table scrolls inside its own region", async ({ page, organiser }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await organiser.signInAs(/Nandini Rao/);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await organiser.openOrders();
    await expect(page.getByRole("table")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

test("responsiveness: filtering and sorting stay under 200 ms with the CPU slowed four times", async ({
  page,
  organiser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttling needs the Chrome DevTools Protocol");
  await organiser.signInAs(/Nandini Rao/);
  await organiser.openOrders();
  await expect(organiser.orderCount).toBeVisible();
  await page.evaluate(() => {
    const durations: number[] = [];
    window.interactionDurations = durations;
    const options: PerformanceObserverInit & { durationThreshold: number } = { type: "event", durationThreshold: 16 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    }).observe(options);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (const status of ["Fulfilled", "Refunded", "Expired"]) {
    await page.getByRole("checkbox", { name: status }).click();
    await expect(page.getByRole("checkbox", { name: status })).toBeChecked();
  }
  await page.getByRole("button", { name: "Total" }).click();
  await expect(page.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const longest = Math.max(0, ...(await page.evaluate(() => window.interactionDurations ?? [])));
  test.info().annotations.push({ type: "longest interaction", description: `${String(Math.round(longest))} ms` });
  expect(longest).toBeLessThan(200);
});

test("buyers' pages never load the dashboard's table libraries", async ({ page }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/events/monsoon-strings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const bodies = await Promise.all(scripts);
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.some((body) => body.includes("getVirtualItems") || body.includes("getHeaderGroups"))).toBe(false);
});
