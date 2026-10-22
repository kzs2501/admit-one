/**
 * What an event's doors need to know that a ticket can't tell them: which tickets were
 * refunded. A ticket's signature still checks out after a refund, so an organiser's
 * scanner downloads these codes while it's online, and refuses them offline too.
 */
import type { Account } from "@/core/organisations";
import { eventFor } from "./access";
import type { BackendContext } from "./context";
import { map, type Result } from "./errors";
import { own } from "./state";

export interface DoorListView {
  eventSlug: string;
  voidedCodes: string[];
  asOfMs: number;
}

/** The event's voided tickets, for an account that may read its orders. */
export function getDoorList(context: BackendContext, account: Account, eventSlug: string): Result<DoorListView> {
  return map(eventFor(account, eventSlug), (event) => ({
    eventSlug: event.slug,
    voidedCodes: (own(context.state.voidedTickets, event.slug) ?? []).map((ticket) => ticket.code),
    asOfMs: context.deps.now(),
  }));
}
