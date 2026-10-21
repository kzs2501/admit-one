// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEMO_TICKET_KEY_ID, DEMO_TICKET_PUBLIC_KEY, signDemoTicket } from "@/core/demo-ticket-key";
import { signTicket, ticketKeyFrom, type TicketClaims } from "@/core/ticket-token";
import { checkTicket, doorOutcome } from "./check-ticket";

const EVENT = "open-studio-ceramics";
const CLAIMS: TicketClaims = {
  code: "AO-DOOR-1",
  eventSlug: EVENT,
  attendeeName: "Asha Rao",
  tierName: "Two-hour session",
  seat: null,
};
const keyring = new Map([[DEMO_TICKET_KEY_ID, ticketKeyFrom(DEMO_TICKET_PUBLIC_KEY)]]);
const ticket = signDemoTicket(CLAIMS);

describe("checking a ticket at the door", () => {
  it("accepts a ticket signed with a trusted key, for this event", () => {
    expect(checkTicket(ticket, EVENT, keyring)).toEqual({ ok: true, claims: CLAIMS });
  });

  it("turns away a ticket for another event, and names it", () => {
    expect(checkTicket(signDemoTicket({ ...CLAIMS, eventSlug: "monsoon-strings" }), EVENT, keyring)).toEqual({
      ok: false,
      rejection: { reason: "other-event", eventName: "Monsoon Strings" },
    });
  });

  it("turns away a changed ticket: a new name on someone else's signature", () => {
    const [version, kid, , signature] = ticket.split(".");
    const [, payload] = signDemoTicket({ ...CLAIMS, attendeeName: "Someone Else" })
      .split(".")
      .slice(1);
    const forged = [version, kid, payload, signature].join(".");
    expect(checkTicket(forged, EVENT, keyring)).toEqual({ ok: false, rejection: { reason: "forged" } });
  });

  it("turns away a ticket signed with a key it doesn't trust", () => {
    const other = signTicket(CLAIMS, { kid: "elsewhere-1", secretKey: new Uint8Array(32).fill(3) });
    expect(checkTicket(other, EVENT, keyring)).toEqual({ ok: false, rejection: { reason: "unknown-key" } });
  });

  it("says when a code isn't a ticket at all", () => {
    for (const code of ["https://example.com", "", "upi://pay?pa=x@bank"]) {
      expect(checkTicket(code, EVENT, keyring)).toEqual({ ok: false, rejection: { reason: "not-a-ticket" } });
    }
  });
});

describe("the door's decision", () => {
  const valid = checkTicket(ticket, EVENT, keyring);

  it("lets a ticket in on its first scan here", () => {
    expect(doorOutcome(valid, { isFirst: true, firstScannedAt: 1_000 })).toEqual({
      kind: "admitted",
      claims: CLAIMS,
      isRemembered: true,
    });
  });

  it("turns it away on every scan after, with when it was first scanned", () => {
    expect(doorOutcome(valid, { isFirst: false, firstScannedAt: 1_000 })).toEqual({
      kind: "already-scanned",
      claims: CLAIMS,
      firstScannedAt: 1_000,
    });
  });

  it("lets it in, unremembered, where the browser keeps nothing", () => {
    expect(doorOutcome(valid, null)).toMatchObject({ kind: "admitted", isRemembered: false });
  });

  it("turns away a code that didn't check out, whatever the device remembers", () => {
    const forged = checkTicket("ao1.demo-2026.e30.AAAA", EVENT, keyring);
    expect(doorOutcome(forged, { isFirst: true, firstScannedAt: 1_000 })).toMatchObject({ kind: "rejected" });
  });
});
