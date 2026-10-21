// @vitest-environment node
/**
 * The scanner trusts the keys tickets are signed with, and never the demo key where a
 * real server signs: anyone can sign with that.
 */
import { describe, expect, it } from "vitest";
import { DEMO_TICKET_KEY_ID, signDemoTicket } from "@/core/demo-ticket-key";
import { signTicket, verifyTicket, type TicketClaims } from "@/core/ticket-token";
import { toBase64Url } from "@/core/base64url";
import { getPublicKey } from "@noble/ed25519";
import { doorKeyringFor } from "./ticket-keys";

const CLAIMS: TicketClaims = {
  code: "AO-TEST-1",
  eventSlug: "open-studio-ceramics",
  attendeeName: "Asha Rao",
  tierName: "Two-hour session",
  seat: null,
};
const serverSecret = new Uint8Array(32).fill(7);
const serverPublicKey = toBase64Url(getPublicKey(serverSecret));
const serverTicket = signTicket(CLAIMS, { kid: "server-1", secretKey: serverSecret });

describe("the door's keyring", () => {
  it("in the sandbox, trusts the demo key it signs with", () => {
    const keyring = doorKeyringFor({ isServerMode: false, isProduction: true, publicKey: serverPublicKey });
    expect([...keyring.keys()]).toEqual([DEMO_TICKET_KEY_ID]);
    expect(verifyTicket(signDemoTicket(CLAIMS), keyring).ok).toBe(true);
  });

  it("for a production server, trusts its public key and never the demo key", () => {
    const keyring = doorKeyringFor({ isServerMode: true, isProduction: true, publicKey: serverPublicKey });
    expect(verifyTicket(serverTicket, keyring).ok).toBe(true);
    expect(verifyTicket(signDemoTicket(CLAIMS), keyring)).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("for a production server with no public key, trusts nothing", () => {
    expect(doorKeyringFor({ isServerMode: true, isProduction: true }).size).toBe(0);
  });

  it("for a server in development, trusts the demo key it falls back to, and its own", () => {
    const keyring = doorKeyringFor({
      isServerMode: true,
      isProduction: false,
      publicKey: serverPublicKey,
      keyId: "door-2",
    });
    expect([...keyring.keys()].sort()).toEqual([DEMO_TICKET_KEY_ID, "door-2"].sort());
  });
});
