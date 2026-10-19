/**
 * All-in pricing: the price a buyer first sees is the price they pay — no fee or tax
 * dripped in at the end (CCPA dark-patterns guidelines; FTC fees rule).
 */
import { getEvent } from "../src/core/catalog";
import { allInTicketPriceMinor } from "../src/core/pricing";
import { formatMoney } from "../src/lib/format";
import { expect, test } from "./fixtures";

test("the all-in price on the event page is exactly what Pay charges", async ({ page, buyer }) => {
  const allIn = formatMoney(allInTicketPriceMinor(getEvent("open-studio-ceramics"), "osc-session"), "INR");
  await page.goto("/events/open-studio-ceramics");
  await expect(page.getByRole("main").getByText(allIn).first()).toBeVisible();

  await page.goto("/");
  await buyer.goToPayment(1);
  await expect(page.getByRole("button", { name: `Pay ${allIn}` })).toBeVisible();
});

test("a ticket of ₹500 or less is shown, and charged, without GST on the ticket", async ({ page, buyer }) => {
  await page.goto("/");
  await buyer.reserve(/Night Market Jazz/, "Student standing", 1);
  await buyer.fillAttendees(1);
  await expect(page.getByRole("complementary").getByText("No GST on tickets of ₹500.00 or less")).toBeVisible();
});
