/**
 * Server mode taking payment through Razorpay's checkout, end to end, against the
 * stand-in for Razorpay (`playwright.razorpay.config.ts`). Each purchase starts from the
 * event page, as a buyer's does, so the checkout is reached without a document load:
 * the policy that lets Checkout in has to be the one the event page was served with.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>;
  }
}

/** Every policy violation on any page this test opens (as `security.spec.ts` collects them). */
async function collectViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation?.(`${event.effectiveDirective} blocked ${event.blockedURI}`);
    });
  });
  return violations;
}

const checkout = (page: Page) => page.getByRole("dialog", { name: "Razorpay Checkout (test stand-in)" });
const payWithRazorpay = (page: Page) => page.getByRole("button", { name: /^Pay ₹.* with Razorpay$/ });

test("a buyer pays on Razorpay's checkout and gets their tickets, within the policy", async ({ page, buyer }) => {
  const violations = await collectViolations(page);
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline' http://localhost:4191");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");

  await buyer.goToPayment();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Razorpay’s test mode" })).toBeVisible();
  await payWithRazorpay(page).click();
  await checkout(page).getByRole("button", { name: "Pay", exact: true }).click();

  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  expect(violations).toEqual([]);
});

test("a declined attempt leaves the checkout open, and paying then works", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.goToPayment();
  await payWithRazorpay(page).click();
  await checkout(page).getByRole("button", { name: "Decline" }).click();
  await expect(checkout(page)).toBeVisible();
  await checkout(page).getByRole("button", { name: "Pay", exact: true }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});

test("closing the checkout cancels it, and the buyer can pay again", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.goToPayment();
  await payWithRazorpay(page).click();
  await checkout(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checkout closed" })).toBeVisible();

  await payWithRazorpay(page).click();
  await checkout(page).getByRole("button", { name: "Pay", exact: true }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});

test("a payment whose page lost Checkout's result is settled by Razorpay's webhook", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.goToPayment();
  await payWithRazorpay(page).click();
  await checkout(page).getByRole("button", { name: "Pay, then lose the page" }).click();
  // Nothing tells the page: it keeps asking, and finds the order paid.
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 15_000 });
});
