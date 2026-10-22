import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { cardPayment, CONCERT, holdFor, orderFor, SUMMIT, attendeesFor } from "@/contract/testing/dto-fixtures";
import { listTickets, markRefunded, saveTickets, ticketsFromOrder } from "./wallet";

const fulfilled = (scene: typeof SUMMIT, count: number) =>
  orderFor(
    holdFor(scene),
    { attendees: attendeesFor(count), addOns: {} },
    { status: "fulfilled", payment: cardPayment() },
  );

describe("the wallet", () => {
  it("keeps what the door needs and what the buyer reads, seats named", () => {
    const [ticket] = ticketsFromOrder(fulfilled(CONCERT, 2));
    expect(ticket).toMatchObject({
      eventName: "Monsoon Strings",
      attendeeName: "Asha Rao",
      seat: "Stalls, row D, seat 11",
      token: expect.stringMatching(/^ao1\./) as unknown,
    });
  });

  it("saves tickets on the device, once each, soonest event first", async () => {
    const summit = ticketsFromOrder(fulfilled(SUMMIT, 2));
    const concert = ticketsFromOrder(fulfilled(CONCERT, 1));
    expect(await saveTickets([...concert, ...summit])).toBe(true);
    expect(await saveTickets(summit)).toBe(true);
    const saved = await listTickets();
    expect(saved?.map((ticket) => ticket.eventSlug)).toEqual([
      "frontend-systems-summit",
      "frontend-systems-summit",
      "monsoon-strings",
    ]);
  });

  it("marks a refunded order's tickets, and only that order's", async () => {
    const refunded = ticketsFromOrder(fulfilled(SUMMIT, 1));
    const kept = ticketsFromOrder(fulfilled(CONCERT, 1)).map((ticket) => ({ ...ticket, orderId: "ord_kept" }));
    await saveTickets([...refunded.map((ticket) => ({ ...ticket, orderId: "ord_refunded" })), ...kept]);
    expect(await markRefunded("ord_refunded")).toBe(true);
    const tickets = await listTickets();
    expect(tickets?.filter((ticket) => ticket.orderId === "ord_refunded").every((ticket) => ticket.isRefunded)).toBe(
      true,
    );
    expect(tickets?.filter((ticket) => ticket.orderId === "ord_kept").some((ticket) => ticket.isRefunded)).toBe(false);
  });
});
