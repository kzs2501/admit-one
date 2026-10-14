/**
 * The vocabulary the browser tests are written in (page objects, after Playwright's
 * best practices): a `buyer` who goes through the purchase the way a person would —
 * by role and label, never by CSS — and the `sandbox` behind the page, whose state
 * is the tests' oracle. Both are injected with `test.extend`.
 */
import { expect, test as base, type Page } from "@playwright/test";
import { SANDBOX_STORAGE_KEY, type ServerState } from "../src/backend/domain/state";
import type { TestCardLabel } from "../src/features/checkout/domain/test-cards";

export class Buyer {
  constructor(readonly page: Page) {}

  /** The confirmation heading once tickets are issued. */
  get ticketsHeading() {
    return this.page.getByRole("heading", { name: /You’re going to/ });
  }

  async reserve(eventName: RegExp, tierName: string, quantity: number) {
    await this.page.getByRole("link", { name: eventName }).click();
    for (let i = 0; i < quantity; i++) await this.page.getByRole("button", { name: `More: ${tierName}` }).click();
    await this.page.getByRole("button", { name: "Reserve tickets" }).click();
  }

  async fillAttendees(count: number) {
    await expect(this.page.getByRole("heading", { name: "Who’s coming?" })).toBeVisible();
    for (let i = 0; i < count; i++) {
      await this.page
        .getByLabel("Full name")
        .nth(i)
        .fill(`Guest ${i + 1}`);
      await this.page
        .getByLabel(/^Email/)
        .nth(i)
        .fill(`guest${i + 1}@example.com`);
    }
    await this.page.getByRole("button", { name: "Continue" }).click();
  }

  /** Home → the payment step for the ceramics event (which has no extras step). */
  async goToPayment(quantity = 1) {
    await this.reserve(/Open Studio/, "Two-hour session", quantity);
    await this.fillAttendees(quantity);
    await this.page.getByRole("button", { name: "Continue to payment" }).click();
    await expect(this.page.getByRole("heading", { name: "Payment", exact: true })).toBeVisible();
  }

  async pay(card: TestCardLabel = "Succeeds") {
    await this.page.getByRole("button", { name: new RegExp(card) }).click();
    await this.page.getByRole("button", { name: /^Pay ₹/ }).click();
  }
}

export class Sandbox {
  constructor(readonly page: Page) {}

  /** Pick a chaos scenario through the panel, exactly as a visitor would. */
  async choosePreset(label: string) {
    await this.page.getByRole("button", { name: /^Chaos/ }).click();
    const panel = this.page.getByRole("dialog", { name: "Chaos panel" });
    await panel.getByRole("radio", { name: label }).check();
    await panel.getByRole("button", { name: "Close chaos panel" }).click();
    await expect(this.page.getByRole("button", { name: new RegExp(`^Chaos.*${label}`) })).toBeVisible();
  }

  /** The backend's state, read straight from the tab's sandbox. */
  state(): Promise<ServerState> {
    return this.page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key) ?? "null") as ServerState,
      SANDBOX_STORAGE_KEY,
    );
  }
}

// Playwright's fixture callback is usually called `use`; `provide` avoids reading as
// React's use() hook.
export const test = base.extend<{ buyer: Buyer; sandbox: Sandbox }>({
  buyer: async ({ page }, provide) => {
    await provide(new Buyer(page));
  },
  sandbox: async ({ page }, provide) => {
    await provide(new Sandbox(page));
  },
});

export { expect };
