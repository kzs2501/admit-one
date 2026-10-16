/**
 * One test per chaos preset. Each asserts what the buyer sees AND what the server
 * recorded — the UI being right for the wrong reason doesn't count.
 */
import { expect, test } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("happy path: confirming, then exactly one ticket per attendee", async ({ page, buyer, sandbox }) => {
  await buyer.goToPayment(2);
  await buyer.pay();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Your tickets" }).getByRole("listitem")).toHaveCount(2);

  const state = await sandbox.state();
  const [order] = Object.values(state.orders);
  expect(order?.status).toBe("fulfilled");
  expect(state.sold["osc-session"]).toBe(2);
});

test("declined card: inline error, details kept, and a retry succeeds", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("Declined card");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Payment didn’t go through");
  await expect(page.getByLabel("Name on card")).toHaveValue("Guest 1");

  await sandbox.choosePreset("Happy path");
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  const payments = Object.values((await sandbox.state()).payments);
  expect(payments.map((payment) => payment.status).sort()).toEqual(["failed", "succeeded"]);
});

test("3-D Secure: failing lets you retry, approving completes the order", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("3-D Secure");
  await buyer.goToPayment();
  await buyer.pay();
  const challenge = page.getByRole("dialog", { name: "Confirm it’s you" });
  await challenge.getByRole("button", { name: "Fail authentication" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Authentication failed");

  await buyer.pay();
  await challenge.getByRole("button", { name: "Approve" }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});

test("3-D Secure survives a refresh mid-challenge", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("3-D Secure");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(page.getByRole("dialog", { name: "Confirm it’s you" })).toBeVisible();
  await page.reload();
  await page.getByRole("dialog", { name: "Confirm it’s you" }).getByRole("button", { name: "Approve" }).click();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
});

test("slow network: a double click reserves once and pays once", async ({ page, buyer, sandbox }) => {
  test.setTimeout(60_000);
  await sandbox.choosePreset("Slow network");
  await page.getByRole("link", { name: /Open Studio/ }).click();
  await page.getByRole("button", { name: "More: Two-hour session" }).click();
  await page.getByRole("button", { name: "Reserve tickets" }).dblclick();
  await expect(page.getByRole("button", { name: "Reserving…" })).toBeDisabled();
  await buyer.fillAttendees(1);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Succeeds/ }).click({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Pay ₹/ }).dblclick();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 30_000 });

  const state = await sandbox.state();
  expect(Object.keys(state.holds)).toHaveLength(1);
  expect(Object.keys(state.payments)).toHaveLength(1);
});

test("connection drops: paying again is safe, and a failed status check keeps the page", async ({
  page,
  buyer,
  sandbox,
}) => {
  test.setTimeout(40_000);
  await sandbox.choosePreset("Connection drops");
  await buyer.goToPayment();
  await buyer.pay();
  // The charge went through, but its answer was lost: the buyer only knows something failed.
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Connection problem");
  await page.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/orders\//);

  // Status checks fail for a while: the page keeps what it knows, and a toast says so.
  await expect(page.getByRole("status").filter({ hasText: "Couldn’t refresh" })).toBeVisible({ timeout: 15_000 });
  // Shorter than the next poll (1 s): a page that swapped to an error state and back
  // would pass an assertion allowed to wait for the comeback.
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible({ timeout: 500 });
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 15_000 });

  const state = await sandbox.state();
  expect(Object.keys(state.payments)).toHaveLength(1);
  expect(state.log.some((entry) => entry.message.includes("Idempotency-Key replayed"))).toBe(true);
});

test("webhook arrives twice: one set of tickets, duplicate logged and ignored", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("Webhook arrives twice");
  await buyer.goToPayment(2);
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("list", { name: "Your tickets" }).getByRole("listitem")).toHaveCount(2);

  await expect
    .poll(async () => (await sandbox.state()).log.some((entry) => entry.message.includes("already processed, ignored")))
    .toBe(true);
  expect((await sandbox.state()).sold["osc-session"]).toBe(2);
});

test("webhook before redirect: the order is already fulfilled when the browser arrives", async ({
  page,
  buyer,
  sandbox,
}) => {
  await sandbox.choosePreset("Webhook before redirect");
  await buyer.goToPayment();
  await buyer.pay();
  await page.waitForURL(/\/orders\//);
  const [order] = Object.values((await sandbox.state()).orders);
  expect(order?.status).toBe("fulfilled");
  await expect(buyer.ticketsHeading).toBeVisible();
});

test("webhook delayed: confirming, a reassuring note, then tickets", async ({ page, buyer, sandbox }) => {
  test.setTimeout(40_000);
  await sandbox.choosePreset("Webhook delayed");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  await expect(page.getByText("This is taking longer than usual.")).toBeVisible({ timeout: 12_000 });
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 20_000 });
});

test("a refresh while confirming resumes: the webhook waits in the persisted outbox", async ({
  page,
  buyer,
  sandbox,
}) => {
  test.setTimeout(40_000);
  await sandbox.choosePreset("Webhook delayed");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  expect((await sandbox.state()).outbox).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Confirming your payment…" })).toBeVisible();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 20_000 });
  expect((await sandbox.state()).outbox).toHaveLength(0);
});

test("hold expires mid-payment: the late payment is refunded and explained", async ({ page, buyer, sandbox }) => {
  test.setTimeout(30_000);
  await sandbox.choosePreset("Hold expires mid-payment");
  await buyer.goToPayment();
  await buyer.pay();
  await expect(page.getByRole("heading", { name: "We refunded your payment" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("main").getByText(/refunded it in full/)).toBeVisible();

  const state = await sandbox.state();
  expect(Object.values(state.payments)[0]?.status).toBe("refunded");
  expect(state.sold["osc-session"] ?? 0).toBe(0);
});

test("crowd: the last tickets go to someone else, and the page says so", async ({ page, buyer, sandbox }) => {
  await sandbox.choosePreset("Crowd buys the last ticket");
  await buyer.reserve(/Night Market Jazz/, "Standing", 1);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Someone just got the last of those tickets.");
  await expect(page.getByText("Sold out").first()).toBeVisible();
  expect(Object.keys((await sandbox.state()).holds)).toHaveLength(0);
});
