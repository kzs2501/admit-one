import { describe, expect, it } from "vitest";
import { keygen, sign } from "@noble/ed25519";
import { toBase64Url } from "./base64url";
import { signTicket, ticketKeyFrom, verifyTicket, type TicketClaims, type TicketKeyring } from "./ticket-token";

const claims: TicketClaims = {
  code: "K7F2-9QX4",
  eventSlug: "monsoon-strings",
  attendeeName: "Asha Rao",
  tierName: "Premium",
  seat: "Stalls, row D, seat 11",
};

const door = keygen();
const stranger = keygen();
const signing = { kid: "door-2026", secretKey: door.secretKey };
const keyring: TicketKeyring = new Map([["door-2026", door.publicKey]]);

/** Swap one character for another the alphabet allows, so the token still parses. */
const flip = (text: string, at: number) => text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);

describe("signed ticket tokens", () => {
  it("verify with the public key, and say what they're for", () => {
    const token = signTicket(claims, signing);
    expect(token).toMatch(/^ao1\.door-2026\.[\w-]+\.[\w-]+$/);
    expect(verifyTicket(token, keyring)).toEqual({ ok: true, kid: "door-2026", claims });
  });

  it("are the same every time a ticket is signed (Ed25519 is deterministic)", () => {
    expect(signTicket(claims, signing)).toBe(signTicket(claims, signing));
  });

  it("are refused if the payload, the signature or the key id is changed", () => {
    const [version, kid, payload, signature] = signTicket(claims, signing).split(".") as [
      string,
      string,
      string,
      string,
    ];
    const otherPayload = signTicket({ ...claims, attendeeName: "Someone Else" }, signing).split(".")[2];
    expect(verifyTicket([version, kid, otherPayload, signature].join("."), keyring)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    expect(verifyTicket([version, kid, payload, flip(signature, 5)].join("."), keyring)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    expect(verifyTicket([version, "stranger", payload, signature].join("."), keyring)).toEqual({
      ok: false,
      reason: "unknown-key",
    });
  });

  it("are refused when signed by a key the scanner doesn't trust, even under a trusted key id", () => {
    const impostor = signTicket(claims, { kid: "door-2026", secretKey: stranger.secretKey });
    expect(verifyTicket(impostor, keyring)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses anything that isn't a token", () => {
    for (const junk of ["", "hello", "ao1.door-2026.only-three", "jwt.door-2026.a.b", "ao1.door-2026.%%%.abc"]) {
      expect(verifyTicket(junk, keyring)).toMatchObject({ ok: false });
    }
  });

  it("refuses a correctly signed payload that isn't a ticket's claims", () => {
    const encode = (text: string) => toBase64Url(new TextEncoder().encode(text));
    for (const payload of [encode("not json"), encode(JSON.stringify({ c: "only a code" }))]) {
      const signed = `ao1.door-2026.${payload}`;
      const token = `${signed}.${toBase64Url(sign(new TextEncoder().encode(signed), door.secretKey))}`;
      expect(verifyTicket(token, keyring)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("won't sign under an id that isn't a key id, or read a key of the wrong size", () => {
    expect(() => signTicket(claims, { kid: "Not A Kid!", secretKey: door.secretKey })).toThrow();
    expect(() => ticketKeyFrom(toBase64Url(new Uint8Array(31)))).toThrow(/32 bytes/);
    expect(ticketKeyFrom(toBase64Url(door.publicKey))).toEqual(door.publicKey);
  });
});
