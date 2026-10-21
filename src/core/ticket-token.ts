/**
 * Tickets that verify themselves: a token a door scanner can check with nothing but a
 * public key, offline.
 *
 * `ao1.<kid>.<payload>.<signature>`
 * - `ao1` is this format's version, and pins its one algorithm, Ed25519 (RFC 8032), so
 *   there's no header to trust and no algorithm to downgrade, unlike a JWT;
 * - `kid` names the key that signed it, so keys can rotate;
 * - `payload` is base64url JSON of the claims, short-keyed to keep the QR code small;
 * - `signature` is base64url of the Ed25519 signature over `ao1.<kid>.<payload>`, so the
 *   version and key id are signed too.
 *
 * A ticket is signed once, as it's issued, by the backend's rules, which are synchronous
 * (as Web Crypto isn't), so signing uses @noble/ed25519, audited and synchronous. The
 * signatures are standard, and deterministic: the same ticket always gets the same
 * token. Verifying uses the same library, so it works on any browser, Ed25519 in Web
 * Crypto or not.
 */
import { hashes, sign, verify } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { fromBase64Url, toBase64Url } from "./base64url";
import { z } from "./zod";

hashes.sha512 = sha512;

export const TICKET_TOKEN_VERSION = "ao1";

/** What a ticket says about itself, as the door needs it. */
export interface TicketClaims {
  code: string;
  eventSlug: string;
  attendeeName: string;
  tierName: string;
  /** "Stalls, row D, seat 11", for reserved seating. */
  seat: string | null;
}

const wireClaimsSchema = z.object({
  c: z.string().min(1),
  e: z.string().min(1),
  n: z.string(),
  t: z.string(),
  s: z.string().nullable(),
});

/** A key that signs tickets: its id, and its 32-byte secret key. */
export interface TicketSigningKey {
  kid: string;
  secretKey: Uint8Array;
}

/** The public keys a scanner trusts, by key id: 32 bytes each. */
export type TicketKeyring = ReadonlyMap<string, Uint8Array>;

export type TicketVerdict =
  | { ok: true; claims: TicketClaims; kid: string }
  | { ok: false; reason: "malformed" | "unknown-key" | "bad-signature" };

const KID_PATTERN = /^[a-z0-9-]{1,32}$/;
const utf8 = new TextEncoder();

export function signTicket(claims: TicketClaims, { kid, secretKey }: TicketSigningKey): string {
  if (!KID_PATTERN.test(kid)) throw new Error(`Not a key id: ${kid}`);
  const wire: z.infer<typeof wireClaimsSchema> = {
    c: claims.code,
    e: claims.eventSlug,
    n: claims.attendeeName,
    t: claims.tierName,
    s: claims.seat,
  };
  const signed = `${TICKET_TOKEN_VERSION}.${kid}.${toBase64Url(utf8.encode(JSON.stringify(wire)))}`;
  return `${signed}.${toBase64Url(sign(utf8.encode(signed), secretKey))}`;
}

/** Whether a token was signed by a key the keyring trusts, and what it says if so. */
export function verifyTicket(token: string, keyring: TicketKeyring): TicketVerdict {
  const parts = token.trim().split(".");
  const [version, kid, payload, signaturePart] = parts;
  if (parts.length !== 4 || version !== TICKET_TOKEN_VERSION || !kid || !payload || !signaturePart) {
    return { ok: false, reason: "malformed" };
  }
  const publicKey = keyring.get(kid);
  if (!publicKey) return { ok: false, reason: "unknown-key" };
  const signature = fromBase64Url(signaturePart);
  const payloadBytes = fromBase64Url(payload);
  if (signature?.length !== 64 || !payloadBytes) return { ok: false, reason: "malformed" };
  if (!verify(signature, utf8.encode(`${version}.${kid}.${payload}`), publicKey)) {
    return { ok: false, reason: "bad-signature" };
  }

  // Signed by a trusted key, so it's ours: but parse it anyway rather than trust its shape.
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const wire = wireClaimsSchema.safeParse(json);
  if (!wire.success) return { ok: false, reason: "malformed" };
  const { c, e, n, t, s } = wire.data;
  return { ok: true, kid, claims: { code: c, eventSlug: e, attendeeName: n, tierName: t, seat: s } };
}

/** A 32-byte key (public, or secret) from base64url. */
export function ticketKeyFrom(text: string): Uint8Array {
  const bytes = fromBase64Url(text);
  if (bytes?.length !== 32) throw new Error("An Ed25519 key is 32 bytes.");
  return bytes;
}
