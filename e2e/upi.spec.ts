/**
 * Paying by UPI. The buyer approves on their phone — here, the sandbox's simulated
 * one — and the page learns the outcome the way a real shop does: from the server,
 * which hears it from the provider's webhook.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("approved on the phone: the order page waits for the webhook, then the tickets", async ({
  page,
  buyer,
  sandbox,
}) => {
  await buyer.goToPayment(1);
  const total = (await page.getByRole("button", { name: /^Pay ₹/ }).textContent())?.replace(/^Pay /, "") ?? "";
  await buyer.payByUpi();
  await expect(page.getByRole("img", { name: `QR code to pay ${total} to admit-one with UPI` })).toBeVisible();
  await expect(buyer.phone).toContainText(total);

  await buyer.phone.getByRole("button", { name: "Approve" }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(`Paid ${total} by UPI.`, { exact: false })).toBeVisible();
  await expect(buyer.phone).toBeHidden();

  const [payment] = Object.values((await sandbox.state()).payments);
  expect(payment).toMatchObject({ method: "upi", status: "succeeded" });
});

test("declined on the phone: a focused notice, nothing taken, and a card works", async ({ page, buyer, sandbox }) => {
  await buyer.goToPayment(1);
  await buyer.payByUpi();
  await buyer.phone.getByRole("button", { name: "Decline" }).click();

  const notice = page.getByRole("main").getByRole("alert");
  await expect(notice).toContainText("UPI payment declined", { timeout: 10_000 });
  await expect(notice).toContainText("No money was taken");
  await expect(page.locator(":focus")).toContainText("UPI payment declined");

  await page.getByRole("radio", { name: /^Card/ }).check();
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  const payments = Object.values((await sandbox.state()).payments);
  expect(payments.map(({ method, status, failureCode }) => [method, status, failureCode])).toEqual([
    ["upi", "failed", "upi_declined"],
    ["card", "succeeded", null],
  ]);
});

test("declined by the bank after the buyer approves: the webhook says so", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("UPI declined");
  await buyer.goToPayment(1);
  await buyer.payByUpi();
  await buyer.phone.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("UPI payment declined", { timeout: 10_000 });
  await expect(page).toHaveURL(/\/payment$/);
});

test("a request nobody approves runs out; asking again starts a new one", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("UPI request expires"); // 15 seconds
  await buyer.goToPayment(1);
  await buyer.payByUpi();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("UPI request expired", { timeout: 20_000 });
  await expect(buyer.phone).toBeHidden();

  await page.getByRole("button", { name: /with UPI$/ }).click();
  await expect(buyer.phone).toBeVisible();
  const payments = Object.values((await sandbox.state()).payments);
  expect(payments.map((payment) => payment.status)).toEqual(["failed", "requires_action"]);
});

test("a refresh keeps the waiting request, and it can still be approved", async ({ page, buyer }) => {
  await buyer.goToPayment(1);
  await buyer.payByUpi();
  await page.reload();
  await expect(page.getByRole("heading", { name: /in your UPI app$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Card/ })).toBeDisabled();
  await buyer.phone.getByRole("button", { name: "Approve" }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});

test("cancelling a request brings the choice back, and nothing is taken", async ({ page, buyer, sandbox }) => {
  await buyer.goToPayment(1);
  await buyer.payByUpi();
  await page.getByRole("button", { name: "Cancel and pay another way" }).click();
  await expect(page.locator(":focus")).toContainText("UPI request cancelled");
  await expect(buyer.phone).toBeHidden();
  await expect(page.getByRole("radio", { name: /^Card/ })).toBeEnabled();

  const [payment] = Object.values((await sandbox.state()).payments);
  expect(payment).toMatchObject({ status: "failed", failureCode: "cancelled" });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`no axe violations while a request waits, phone included (${scheme})`, async ({ page, buyer }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await buyer.goToPayment(1);
      await buyer.payByUpi();
      await expect(buyer.phone).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }

  test("on a phone: an app to open instead of a code to scan, and no sideways scroll", async ({ page, buyer }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await buyer.goToPayment(1);
    await buyer.payByUpi();
    await expect(page.getByRole("link", { name: "Open your UPI app" })).toHaveAttribute("href", /^upi:\/\/pay\?/);
    await expect(page.getByRole("img", { name: /QR code to pay/ })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});
