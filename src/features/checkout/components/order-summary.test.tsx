import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { priceOrder } from "@/core/pricing";
import { formatMoney } from "@/lib/format";
import { eventDtoFor } from "@/features/checkout/testing/fixtures";
import { OrderSummary } from "./order-summary";

describe("OrderSummary", () => {
  it("lists every part of the price — tickets, booking fee, GST on each — and the all-in total", () => {
    const event = eventDtoFor("frontend-systems-summit");
    const items = [{ tierId: "fss-general", quantity: 2 }];
    render(<OrderSummary event={event} items={items} seats={[]} addOns={{ "fss-lunch": 1 }} />);
    const summary = screen.getByRole("complementary");
    const amounts = priceOrder(event, items, { "fss-lunch": 1 });

    expect(within(summary).getByText("Booking fee (3% per ticket)")).toBeInTheDocument();
    expect(within(summary).getByText("GST on tickets (18%)")).toBeInTheDocument();
    expect(within(summary).getByText("GST on the booking fee (18%)")).toBeInTheDocument();
    expect(within(summary).getByText("GST on extras (5%)")).toBeInTheDocument();
    const total = within(summary).getByText("Total").nextElementSibling;
    expect(total).toHaveTextContent(formatMoney(amounts.totalMinor, "INR"));
  });

  it("says when a ticket carries no GST, rather than leaving the line out", () => {
    const event = eventDtoFor("night-market-jazz");
    render(<OrderSummary event={event} items={[{ tierId: "nmj-student", quantity: 1 }]} seats={[]} addOns={{}} />);
    expect(screen.getByText("No GST on tickets of ₹500.00 or less")).toBeInTheDocument();
  });
});
