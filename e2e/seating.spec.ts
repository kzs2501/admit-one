/**
 * Reserved seating, end to end: the map by keyboard and by mouse, a seat lost to
 * another buyer, the server's best available, accessibility, and a responsiveness
 * budget for a thousand interactive seats.
 */
import type { Page } from "@playwright/test";
import type { Seat } from "../src/core/seating";
import { axeViolations, expect, test } from "./fixtures";

declare global {
  interface Window {
    interactionDurations?: number[];
  }
}

const SLUG = "monsoon-strings";
const seatCell = (page: Page, seat: Seat) =>
  page.getByRole("gridcell", { name: new RegExp(`^Row ${seat.rowLabel}, seat ${seat.number},`) }).first();

/** The two seats of a pair, or a clear failure. */
function pairOf(seats: readonly Seat[]): [Seat, Seat] {
  const [first, second] = seats;
  if (!first || !second) throw new Error("Expected two seats");
  return [first, second];
}

async function openMap(page: Page) {
  await page.goto(`/events/${SLUG}`);
  // The hall is server-rendered; seats are usable once availability has arrived.
  await expect(page.getByRole("grid", { name: "Stalls" })).not.toHaveAttribute("aria-busy");
}

/** Extras, review and payment, after the attendees step. */
async function payForSeats(page: Page) {
  await expect(page.getByRole("heading", { name: "Add extras" })).toBeVisible();
  await page.getByRole("button", { name: "Continue without extras" }).click();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Succeeds/ }).click();
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
}

test("keyboard only: choose seats on the map, and they're printed on the tickets", async ({ page, buyer, sandbox }) => {
  await openMap(page);
  const { seats, rowIndex } = await sandbox.freeSeatRun(SLUG, 2);
  const [first] = pairOf(seats);

  // Into the stalls grid; to its first seat; down to the row; along to the seat.
  await page.getByRole("grid", { name: "Stalls" }).locator('[tabindex="0"]').focus();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < rowIndex; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let i = 1; i < first.number; i++) await page.keyboard.press("ArrowRight");
  await expect(seatCell(page, first)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  for (const seat of seats) await expect(seatCell(page, seat)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status").filter({ hasText: "2 of 6 seats chosen" })).toBeAttached();

  await page.getByRole("button", { name: "Reserve 2 seats" }).press("Enter");
  await buyer.fillAttendees(2);
  await payForSeats(page);
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  const tickets = page.getByRole("list", { name: "Your tickets" });
  for (const seat of seats) await expect(tickets).toContainText(`Stalls, row ${seat.rowLabel}, seat ${seat.number}`);

  const state = await sandbox.state();
  expect(state.soldSeatIds).toEqual(seats.map((seat) => seat.id));
});

test("seat snatched: nothing is held, the lost seat is named, and the rest stay chosen", async ({ page, sandbox }) => {
  await page.goto("/");
  await sandbox.choosePreset("Seat snatched");
  await openMap(page);
  const { seats } = await sandbox.freeSeatRun(SLUG, 2);
  const [kept, snatched] = pairOf(seats);
  await seatCell(page, kept).click();
  await seatCell(page, snatched).click();
  await page.getByRole("button", { name: "Reserve 2 seats" }).click();

  const notice = page.getByRole("alert").filter({ hasText: "Someone got there first" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(`Stalls, row ${snatched.rowLabel}, seat ${snatched.number} was just taken`);
  await expect(seatCell(page, snatched)).toHaveAttribute("aria-disabled", "true");
  await expect(seatCell(page, kept)).toHaveAttribute("aria-selected", "true");
  expect(Object.keys((await sandbox.state()).holds)).toHaveLength(0);

  // The seat that's left can still be had.
  await page.getByRole("button", { name: "Reserve seat" }).click();
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
});

test("best available seats a party together, and a refresh keeps the seats", async ({ page }) => {
  await page.goto(`/events/${SLUG}`);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "More: Stalls" }).click();
  await page.getByRole("button", { name: "Find the best seats" }).click();
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
  const legends = page.getByRole("group", { name: /^Ticket \d/ });
  await expect(legends).toHaveCount(3);
  const labels = await legends.evaluateAll((groups) =>
    groups.map((group) => group.querySelector("legend")?.textContent),
  );
  const seats = labels.map((label) => /row (\w+), seat (\d+)/.exec(label ?? ""));
  const rows = new Set(seats.map((match) => match?.[1]));
  const numbers = seats.map((match) => Number(match?.[2]));
  expect(rows.size).toBe(1);
  expect(numbers).toEqual(numbers.map((_, i) => (numbers[0] ?? 0) + i));

  await page.reload();
  await expect(page.getByRole("group", { name: /^Ticket 1 · Stalls, row/ })).toBeVisible();
});

test.describe("seat map accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations, with seats chosen (${scheme})`, async ({ page, sandbox }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openMap(page);
      const { seats } = await sandbox.freeSeatRun(SLUG, 2);
      for (const seat of seats) await seatCell(page, seat).click();
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("at 375 px the map scrolls on its own, and the page doesn't", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openMap(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("responsiveness: choosing seats stays under 200 ms with the CPU slowed four times", async ({
  page,
  sandbox,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttling needs the Chrome DevTools Protocol");
  await openMap(page);
  const { seats } = await sandbox.freeSeatRun(SLUG, 2);
  await page.evaluate(() => {
    const durations: number[] = [];
    window.interactionDurations = durations;
    // Event Timing: how long each interaction took, from input to the next paint.
    const options: PerformanceObserverInit & { durationThreshold: number } = { type: "event", durationThreshold: 16 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    }).observe(options);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  for (let i = 0; i < 10; i++) {
    for (const seat of seats) await seatCell(page, seat).click();
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const durations = await page.evaluate(() => window.interactionDurations ?? []);
  const longest = Math.max(0, ...durations);
  test.info().annotations.push({ type: "longest interaction", description: `${Math.round(longest)} ms` });
  expect(longest).toBeLessThan(200);
});
