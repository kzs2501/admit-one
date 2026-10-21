/**
 * The buyer's tickets on this device, in IndexedDB: there offline, after a reload, after
 * the tab is closed. The order page saves them when they arrive; the wallet reads them.
 * Storage can be refused (a private window, a full disk), so both ways say whether it
 * worked rather than throw.
 */
import { createStore, setMany, values, type UseStore } from "idb-keyval";
import type { OrderDto } from "@/contract/dto";
import { getEvent } from "@/core/catalog";
import { formatSeat } from "./format";

/** A ticket as the wallet keeps it: everything needed to show it, and the token the door checks. */
export interface WalletTicket {
  code: string;
  token: string;
  orderId: string;
  eventSlug: string;
  eventName: string;
  startsAt: string;
  timeZone: string;
  venue: string;
  city: string;
  attendeeName: string;
  tierName: string;
  seat: string | null;
}

export function ticketsFromOrder(order: OrderDto): WalletTicket[] {
  const event = getEvent(order.eventSlug);
  return order.tickets.map((ticket) => ({
    code: ticket.code,
    token: ticket.token,
    orderId: order.id,
    eventSlug: event.slug,
    eventName: event.name,
    startsAt: event.startsAt,
    timeZone: event.timeZone,
    venue: event.venue,
    city: event.city,
    attendeeName: ticket.attendeeName,
    tierName: ticket.tierName,
    seat: ticket.seat ? formatSeat(ticket.seat) : null,
  }));
}

// Opened on first use: there's no IndexedDB on the server.
let store: UseStore | null = null;
const walletStore = () => (store ??= createStore("admit-one-wallet", "tickets"));

/** Keep tickets on this device, by event and code, so saving the same order twice keeps one of each. */
export async function saveTickets(tickets: readonly WalletTicket[]): Promise<boolean> {
  try {
    await setMany(
      tickets.map((ticket) => [`${ticket.eventSlug}/${ticket.code}`, ticket]),
      walletStore(),
    );
    return true;
  } catch {
    return false;
  }
}

/** The tickets on this device, soonest event first; null if storage isn't available here. */
export async function listTickets(): Promise<WalletTicket[] | null> {
  try {
    const tickets = await values<WalletTicket>(walletStore());
    return tickets.sort(
      (left, right) => left.startsAt.localeCompare(right.startsAt) || left.code.localeCompare(right.code),
    );
  } catch {
    return null;
  }
}
