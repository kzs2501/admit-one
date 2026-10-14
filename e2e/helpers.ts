import { expect, type Page } from "@playwright/test";
import { SANDBOX_STORAGE_KEY, type ServerState } from "../src/backend/domain/state";

/** Pick a chaos scenario through the panel, exactly as a visitor would. */
export async function choosePreset(page: Page, label: string) {
  await page.getByRole("button", { name: /^Chaos/ }).click();
  const panel = page.getByRole("dialog", { name: "Chaos panel" });
  await panel.getByRole("radio", { name: label }).check();
  await panel.getByRole("button", { name: "Close chaos panel" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^Chaos.*${label}`) })).toBeVisible();
}

/** The simulated server's state, read straight from the tab's sandbox — the test's oracle. */
export const serverState = (page: Page) =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null") as ServerState, SANDBOX_STORAGE_KEY);

export async function reserve(page: Page, eventName: RegExp, tierName: string, qty: number) {
  await page.getByRole("link", { name: eventName }).click();
  for (let i = 0; i < qty; i++) await page.getByRole("button", { name: `More: ${tierName}` }).click();
  await page.getByRole("button", { name: "Reserve tickets" }).click();
}

export async function fillAttendees(page: Page, count: number) {
  await expect(page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
  for (let i = 0; i < count; i++) {
    await page
      .getByLabel("Full name")
      .nth(i)
      .fill(`Guest ${i + 1}`);
    await page
      .getByLabel(/^Email/)
      .nth(i)
      .fill(`guest${i + 1}@example.com`);
  }
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Home → payment step for the ceramics event (no extras step). */
export async function toPayment(page: Page, qty = 1) {
  await reserve(page, /Open Studio/, "Two-hour session", qty);
  await fillAttendees(page, qty);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByRole("heading", { name: "Payment", exact: true })).toBeVisible();
}

export async function pay(page: Page, card: "Succeeds" | "Declined" | "Needs 3-D Secure" = "Succeeds") {
  await page.getByRole("button", { name: new RegExp(card) }).click();
  await page.getByRole("button", { name: /^Pay \$/ }).click();
}

export const ticketsHeading = (page: Page) => page.getByRole("heading", { name: /You’re going to/ });
