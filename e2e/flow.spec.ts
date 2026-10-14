import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("extras appear only for events that have them", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.reserve(/Frontend Systems Summit/, "General", 1);
  await buyer.fillAttendees(1);
  await expect(page.getByRole("heading", { name: "Add extras" })).toBeVisible();
  await page.getByRole("button", { name: "More: Lunch pass" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your order" })).toBeVisible();
  await expect(page.getByText("1 × Lunch pass").first()).toBeVisible();
});

test("refresh mid-form keeps what you typed", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.reserve(/Open Studio/, "Two-hour session", 2);
  await page.getByLabel("Full name").first().fill("Asha Rao");
  await page
    .getByLabel(/^Email/)
    .first()
    .fill("asha@example.com");
  await page.reload();
  await expect(page.getByLabel("Full name").first()).toHaveValue("Asha Rao");
  await expect(page.getByLabel(/^Email/).first()).toHaveValue("asha@example.com");
});

test("you can't skip ahead: a deep link to payment lands on the first unfinished step", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.reserve(/Open Studio/, "Two-hour session", 1);
  await expect(page).toHaveURL(/\/attendees$/);
  await page.goto(page.url().replace(/attendees$/, "payment"));
  await expect(page).toHaveURL(/\/attendees$/);
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
});

test("focus moves to the new step's heading", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.reserve(/Open Studio/, "Two-hour session", 1);
  await buyer.fillAttendees(1);
  await expect(page.getByRole("heading", { name: "Review your order" })).toBeFocused();
});

test("an expired hold offers to reserve the same tickets again, keeping the draft", async ({ page, buyer }) => {
  await page.clock.install();
  await page.goto("/");
  await buyer.reserve(/Open Studio/, "Two-hour session", 1);
  await page.getByLabel("Full name").fill("Asha Rao");
  await page.getByLabel(/^Email/).fill("asha@example.com");
  await page.clock.fastForward("05:01");
  await expect(page.getByRole("heading", { name: "Your reservation expired" })).toBeVisible();
  await page.getByRole("button", { name: "Reserve the same tickets again" }).click();
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Asha Rao");
});

test("the countdown announces thresholds, not every second", async ({ page, buyer }) => {
  await page.clock.install();
  await page.goto("/");
  await buyer.reserve(/Open Studio/, "Two-hour session", 1);
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible(); // the hold exists now
  const live = page.locator('[role="status"]').filter({ hasText: /left to complete your order/ });
  await page.clock.fastForward("03:01"); // 5:00 → 1:59
  await expect(live).toHaveText("2 minutes left to complete your order.");
});

test("a problem's type URI opens its documentation", async ({ page }) => {
  await page.goto("/problems/sold-out");
  await expect(page.getByRole("heading", { level: 1, name: "Not enough tickets left" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("sold_out");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("an unknown reservation explains itself", async ({ page }) => {
  await page.goto("/checkout/hold_doesnotexist/attendees");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("We can’t find that reservation");
});

test.describe("accessibility", () => {
  const scan = async (page: Page) => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    return results.violations.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    );
  };

  for (const scheme of ["light", "dark"] as const) {
    test(`a hovered primary button keeps its contrast (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/events/frontend-systems-summit");
      await page.getByRole("button", { name: "More: General" }).click();
      await page.getByRole("button", { name: "Reserve tickets" }).hover();
      await page.waitForTimeout(300); // let the hover transition finish
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).include("form").analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }

  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations across the purchase (${scheme})`, async ({ page, buyer }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(
        page
          .getByRole("main")
          .getByText(/\d+ left|Sold out/)
          .first(),
      ).toBeVisible();
      expect(await scan(page), "home").toEqual([]);

      await page.getByRole("link", { name: /Frontend Systems Summit/ }).click();
      await expect(page.getByRole("button", { name: "Reserve tickets" })).toBeVisible();
      expect(await scan(page), "event").toEqual([]);

      await page.getByRole("button", { name: "More: General" }).click();
      await page.getByRole("button", { name: "Reserve tickets" }).click();
      await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click(); // show validation errors too
      await expect(page.getByText("Enter the attendee’s full name.")).toBeVisible();
      expect(await scan(page), "attendees with errors").toEqual([]);

      await page.getByLabel("Full name").fill("Asha Rao");
      await page.getByLabel(/^Email/).fill("asha@example.com");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("heading", { name: "Add extras" })).toBeVisible();
      expect(await scan(page), "extras").toEqual([]);

      await page.getByRole("button", { name: "Continue without extras" }).click();
      await page.getByRole("button", { name: "Continue to payment" }).click();
      await expect(page.getByRole("heading", { name: "Payment", exact: true })).toBeVisible();
      expect(await scan(page), "payment").toEqual([]);

      await buyer.pay();
      await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
      expect(await scan(page), "tickets").toEqual([]);

      await page.getByRole("button", { name: /^Chaos/ }).click();
      await expect(page.getByRole("dialog", { name: "Chaos panel" })).toBeVisible();
      expect(await scan(page), "chaos panel").toEqual([]);
    });
  }
});

test("no horizontal scroll at 375px through checkout", async ({ page, buyer }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const noOverflow = async (where: string) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), where).toBeLessThanOrEqual(0);
  await page.goto("/");
  await noOverflow("home");
  await buyer.goToPayment(2);
  await noOverflow("payment");
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  await noOverflow("tickets");
});

test("reduced motion: the whole purchase still works", async ({ page, buyer }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});
