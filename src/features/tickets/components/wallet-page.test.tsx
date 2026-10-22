import "fake-indexeddb/auto";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { attendeesFor, cardPayment, CONCERT, holdFor, orderFor } from "@/contract/testing/dto-fixtures";
import { saveTickets, ticketsFromOrder } from "@/lib/wallet";
import { WalletPage } from "./wallet-page";

describe("the wallet page", () => {
  it("says when there are no tickets on this device yet", async () => {
    render(<WalletPage />);
    expect(await screen.findByText("No tickets on this device yet")).toBeInTheDocument();
  });

  it("shows each saved ticket with its seat and a code to scan at the door", async () => {
    const order = orderFor(
      holdFor(CONCERT),
      { attendees: attendeesFor(2), addOns: {} },
      { status: "fulfilled", payment: cardPayment() },
    );
    await saveTickets(ticketsFromOrder(order));
    render(<WalletPage />);
    const list = await screen.findByRole("list", { name: "Your tickets" });
    const tickets = within(list).getAllByRole("article");
    expect(tickets).toHaveLength(2);
    const first = within(tickets[0] ?? list);
    expect(first.getByText("Stalls, row D, seat 11")).toBeInTheDocument();
    expect(first.getByRole("img", { name: "Code to scan at the door, for Asha Rao" })).toBeInTheDocument();
  });

  it("shows a refunded ticket as refunded, with no code to scan", async () => {
    const order = orderFor(
      holdFor(CONCERT),
      { attendees: attendeesFor(1), addOns: {} },
      { status: "fulfilled", payment: cardPayment() },
    );
    await saveTickets(ticketsFromOrder(order).map((ticket) => ({ ...ticket, code: "AO-REF-1", isRefunded: true })));
    render(<WalletPage />);
    const refunded = await screen.findByText("Refunded: this ticket no longer gets anyone in.");
    expect(refunded).toBeInTheDocument();
    const card = refunded.closest("article");
    expect(card && within(card).queryByRole("img")).toBeNull();
  });
});
