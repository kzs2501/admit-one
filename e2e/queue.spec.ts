/**
 * High demand, end to end: the waiting room for a flash sale, and the rate limit on
 * reserving. Each checks what the buyer sees and what the server recorded.
 */
import type { Page } from "@playwright/test";
import { axeViolations, expect, test } from "./fixtures";

const QUEUE_PAGE = /\/events\/open-studio-ceramics\/queue$/;

/** The headline number on the queue page: how many people are ahead. */
async function peopleAhead(page: Page) {
  const label = page.getByText("people ahead of you", { exact: true });
  const text = await label.locator("xpath=preceding-sibling::p[1]").innerText();
  return Number(text.replaceAll(",", ""));
}

async function joinTheQueue(page: Page) {
  await page.getByRole("link", { name: /Open Studio/ }).click();
  await expect(page.getByRole("heading", { name: "This sale has a queue" })).toBeVisible();
  await page.getByRole("button", { name: "Join the queue" }).click();
  await expect(page).toHaveURL(QUEUE_PAGE);
  await expect(page.getByRole("heading", { name: "You’re in the queue" })).toBeVisible();
}

test("flash sale: join the queue, keep your place through a refresh, and reserve on your turn", async ({
  page,
  sandbox,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await sandbox.choosePreset("Flash sale");
  await joinTheQueue(page);
  expect(await peopleAhead(page)).toBe(40_000);

  // The line moves a batch at a time; a refresh keeps the place it had reached.
  await expect.poll(() => peopleAhead(page), { timeout: 10_000 }).toBeLessThan(40_000);
  const before = await peopleAhead(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "You’re in the queue" })).toBeVisible();
  expect(await peopleAhead(page)).toBeLessThanOrEqual(before);

  // Your turn: said, focused, and in the tab's title — but no redirect.
  const turn = page.getByRole("heading", { name: "It’s your turn" });
  await expect(turn).toBeFocused({ timeout: 15_000 });
  await expect(page).toHaveTitle(/It’s your turn/);
  await expect(page).toHaveURL(QUEUE_PAGE);

  await page.getByRole("link", { name: "Choose tickets" }).click();
  await expect(page.getByRole("main").getByText("Reserve within")).toBeVisible();
  await page.getByRole("button", { name: "More: Two-hour session" }).click();
  await page.getByRole("button", { name: "Reserve tickets" }).click();
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();

  const state = await sandbox.state();
  expect(Object.values(state.queueEntries)).toHaveLength(1);
  expect(Object.keys(state.holds)).toHaveLength(1);
});

test("too many attempts: the fourth reserve waits out the server's Retry-After, then works", async ({
  page,
  sandbox,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await sandbox.choosePreset("Too many attempts"); // 3 tries per 15 s
  await page.getByRole("link", { name: /Open Studio/ }).click();
  const reserveButton = page.getByRole("button", { name: "Reserve tickets" });

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole("button", { name: "More: Two-hour session" }).click();
    await reserveButton.click();
    await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
    await page.goBack();
  }

  await page.getByRole("button", { name: "More: Two-hour session" }).click();
  await reserveButton.click();
  // Heard once, in words, and seen counting down.
  const notice = page.getByRole("status").filter({ hasText: "Too many attempts" });
  await expect(notice).toContainText(/You can try again in \d+ seconds?\./);
  await expect(page.getByText(/You can try again in \d:\d\d\./)).toBeVisible();
  await expect(reserveButton).toBeDisabled();

  // Waiting exactly as long as the server said always works.
  await expect(reserveButton).toBeEnabled({ timeout: 20_000 });
  await reserveButton.click();
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
  expect(Object.keys((await sandbox.state()).holds)).toHaveLength(4);
});

test.describe("queue page accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations while waiting (${scheme})`, async ({ page, sandbox }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await sandbox.choosePreset("Flash sale");
      await joinTheQueue(page);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test("no horizontal scroll at 375 px", async ({ page, sandbox }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await sandbox.choosePreset("Flash sale");
    await joinTheQueue(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});
