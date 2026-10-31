/**
 * What the door decides about a scanned code, as pure functions: the scanner passes
 * in the code, the event it's checking, the keys it trusts, and what the device
 * remembers of the ticket, so every rule is tested without a camera or a network.
 */
import { findEvent } from "@/core/catalog";
import { verifyTicket, type TicketClaims, type TicketKeyring } from "@/core/ticket-token";
import type { ScanMemory } from "@/lib/scan-log";

/** Why a code doesn't get someone in. */
export type Rejection =
  /** Not a Dress Circle ticket at all: some other QR code, or a damaged one. */
  | { reason: "not-a-ticket" }
  /** Signed, but with a key this door doesn't trust (another deployment's, or an old one). */
  | { reason: "unknown-key" }
  /** The signature doesn't match: the ticket was changed, or made up. */
  | { reason: "forged" }
  /** A real ticket, for another event. */
  | { reason: "other-event"; eventName: string }
  /** A real ticket for this event, refunded since: its signature still checks out. */
  | { reason: "refunded" };

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; rejection: Rejection };

const REJECTIONS = {
  malformed: { reason: "not-a-ticket" },
  "unknown-key": { reason: "unknown-key" },
  "bad-signature": { reason: "forged" },
} as const satisfies Record<string, Rejection>;

/**
 * A real ticket, for this event, not refunded: checked with the trusted keys, and the
 * refunded tickets this door has been told of.
 */
export function checkTicket(
  code: string,
  eventSlug: string,
  keyring: TicketKeyring,
  refundedCodes: ReadonlySet<string> = new Set(),
): TicketCheck {
  const verdict = verifyTicket(code, keyring);
  if (!verdict.ok) return { ok: false, rejection: REJECTIONS[verdict.reason] };
  const { claims } = verdict;
  if (claims.eventSlug !== eventSlug) {
    const eventName = findEvent(claims.eventSlug)?.name ?? claims.eventSlug;
    return { ok: false, rejection: { reason: "other-event", eventName } };
  }
  if (refundedCodes.has(claims.code)) return { ok: false, rejection: { reason: "refunded" } };
  return { ok: true, claims };
}

export type DoorOutcome =
  /** `isRemembered` is false where the browser keeps nothing, so a second scan can't be caught. */
  | { kind: "admitted"; claims: TicketClaims; isRemembered: boolean }
  | { kind: "already-scanned"; claims: TicketClaims; firstScannedAt: number }
  | { kind: "rejected"; rejection: Rejection };

/** A real ticket's first scan here lets them in; every later one is turned away. */
export function doorOutcome(check: TicketCheck, memory: ScanMemory | null): DoorOutcome {
  if (!check.ok) return { kind: "rejected", rejection: check.rejection };
  if (!memory) return { kind: "admitted", claims: check.claims, isRemembered: false };
  return memory.isFirst
    ? { kind: "admitted", claims: check.claims, isRemembered: true }
    : { kind: "already-scanned", claims: check.claims, firstScannedAt: memory.firstScannedAt };
}
