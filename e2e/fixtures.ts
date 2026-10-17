/**
 * The vocabulary the browser tests are written in (page objects, after Playwright's
 * best practices): a `buyer` who goes through the purchase the way a person would —
 * by role and label, never by CSS — and the `sandbox` behind the page, whose state
 * is the tests' oracle. Both are injected with `test.extend`.
 */
import { expect, test as base, type Page } from "@playwright/test";
import { SANDBOX_STORAGE_KEY, type ServerState } from "../src/backend/domain/state";
import { seatAvailabilityDtoSchema } from "../src/contract/dto";
import { getSeatPlan } from "../src/core/catalog";
import { findSingleSeatGaps, type Seat } from "../src/core/seating";
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

  /**
   * The first `length` free seats side by side, in a row of the given section, that can
   * be chosen without stranding a seat — worked out from the live availability with the
   * same rule the app uses, so a test never picks seats the app would refuse.
   */
  async freeSeatRun(slug: string, length: number, sectionId = "stalls"): Promise<{ seats: Seat[]; rowIndex: number }> {
    const plan = getSeatPlan(slug);
    const body = await this.page.evaluate(async (path): Promise<unknown> => {
      const response = await fetch(path);
      return response.json();
    }, `/api/events/${slug}/seats`);
    const unavailable = new Set(seatAvailabilityDtoSchema.parse(body).unavailableSeatIds);
    const section = plan.sections.find((candidate) => candidate.id === sectionId);
    for (const [rowIndex, row] of (section?.rows ?? []).entries()) {
      for (const block of row.blocks) {
        for (let start = 0; start + length <= block.length; start++) {
          const seats = block.slice(start, start + length);
          if (seats.some((seat) => unavailable.has(seat.id))) continue;
          if (findSingleSeatGaps(plan, unavailable, new Set(seats.map((seat) => seat.id))).length === 0) {
            return { seats, rowIndex };
          }
        }
      }
    }
    throw new Error(`No ${length} free seats together in ${sectionId}`);
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
