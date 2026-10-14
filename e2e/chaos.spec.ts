/**
 * One test per chaos preset. Each asserts what the buyer sees AND what the server
 * recorded — the UI being right for the wrong reason doesn't count.
 */
import { expect, test } from "@playwright/test";
import { choosePreset, fillAttendees, pay, reserve, serverState, ticketsHeading, toPayment } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("happy path: confirming, then exactly one ticket per attendee", async ({ page }) => {
  await toPayment(page, 2);
  await pay(page);
  await expect(page).toHaveURL(/\/orders\//);
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Your tickets" }).getByRole("listitem")).toHaveCount(2);

  const state = await serverState(page);
  const order = Object.values(state.orders)[0];
  expect(order.status).toBe("fulfilled");
  expect(state.sold["osc-session"]).toBe(2);
});

test("declined card: inline error, details kept, and a retry succeeds", async ({ page }) => {
  await choosePreset(page, "Declined card");
  await toPayment(page);
  await pay(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Payment didn’t go through");
  await expect(page.getByLabel("Name on card")).toHaveValue("Guest 1");

  await choosePreset(page, "Happy path");
  await pay(page);
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 10_000 });
  const payments = Object.values((await serverState(page)).payments);
  expect(payments.map((p) => p.status).sort()).toEqual(["failed", "succeeded"]);
});

test("3-D Secure: failing lets you retry, approving completes the order", async ({ page }) => {
  await choosePreset(page, "3-D Secure");
  await toPayment(page);
  await pay(page);
  const challenge = page.getByRole("dialog", { name: "Confirm it’s you" });
  await challenge.getByRole("button", { name: "Fail authentication" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Authentication failed");

  await pay(page);
  await challenge.getByRole("button", { name: "Approve" }).click();
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 10_000 });
});

test("3-D Secure survives a refresh mid-challenge", async ({ page }) => {
  await choosePreset(page, "3-D Secure");
  await toPayment(page);
  await pay(page);
  await expect(page.getByRole("dialog", { name: "Confirm it’s you" })).toBeVisible();
  await page.reload();
  await page.getByRole("dialog", { name: "Confirm it’s you" }).getByRole("button", { name: "Approve" }).click();
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 10_000 });
});

test("slow network: a double click reserves once and pays once", async ({ page }) => {
  test.setTimeout(60_000);
  await choosePreset(page, "Slow network");
  await page.getByRole("link", { name: /Open Studio/ }).click();
  await page.getByRole("button", { name: "More: Two-hour session" }).click();
  const reserveButton = page.getByRole("button", { name: "Reserve tickets" });
  await reserveButton.click();
  await expect(page.getByRole("button", { name: "Reserving…" })).toBeDisabled();
  await page
    .getByRole("button", { name: "Reserving…" })
    .click({ force: true })
    .catch(() => {});
  await fillAttendees(page, 1);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Succeeds/ }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Pay \$/ }).dblclick();
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 30_000 });

  const state = await serverState(page);
  expect(Object.keys(state.holds)).toHaveLength(1);
  expect(Object.keys(state.payments)).toHaveLength(1);
});

test("webhook arrives twice: one set of tickets, duplicate logged and ignored", async ({ page }) => {
  await choosePreset(page, "Webhook arrives twice");
  await toPayment(page, 2);
  await pay(page);
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Your tickets" }).getByRole("listitem")).toHaveCount(2);

  await expect
    .poll(async () => (await serverState(page)).log.some((l) => /already processed, ignored/.test(l.message)))
    .toBe(true);
  expect((await serverState(page)).sold["osc-session"]).toBe(2);
});

test("webhook before redirect: the order is already fulfilled when the browser arrives", async ({ page }) => {
  await choosePreset(page, "Webhook before redirect");
  await toPayment(page);
  await pay(page);
  await page.waitForURL(/\/orders\//);
  const order = Object.values((await serverState(page)).orders)[0];
  expect(order.status).toBe("fulfilled");
  await expect(ticketsHeading(page)).toBeVisible();
});

test("webhook delayed: confirming, a reassuring note, then tickets", async ({ page }) => {
  test.setTimeout(40_000);
  await choosePreset(page, "Webhook delayed");
  await toPayment(page);
  await pay(page);
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  await expect(page.getByText("This is taking longer than usual.")).toBeVisible({ timeout: 12_000 });
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 20_000 });
});

test("a refresh while confirming resumes: the webhook waits in the persisted outbox", async ({ page }) => {
  test.setTimeout(40_000);
  await choosePreset(page, "Webhook delayed");
  await toPayment(page);
  await pay(page);
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  expect((await serverState(page)).outbox).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  await expect(ticketsHeading(page)).toBeVisible({ timeout: 20_000 });
  expect((await serverState(page)).outbox).toHaveLength(0);
});

test("hold expires mid-payment: the late payment is refunded and explained", async ({ page }) => {
  test.setTimeout(30_000);
  await choosePreset(page, "Hold expires mid-payment");
  await toPayment(page);
  await pay(page);
  await expect(page.getByRole("heading", { name: "We refunded your payment" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").getByText(/refunded it in full/)).toBeVisible();

  const state = await serverState(page);
  expect(Object.values(state.payments)[0].status).toBe("refunded");
  expect(state.sold["osc-session"] ?? 0).toBe(0);
});

test("crowd: the last tickets go to someone else, and the page says so", async ({ page }) => {
  await choosePreset(page, "Crowd buys the last ticket");
  await reserve(page, /Night Market Jazz/, "Standing", 1);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Someone just got the last of those tickets.");
  await expect(page.getByText("Sold out").first()).toBeVisible();
  expect(Object.keys((await serverState(page)).holds)).toHaveLength(0);
});
