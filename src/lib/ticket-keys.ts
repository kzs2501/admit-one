/**
 * The keys the door scanner trusts, by key id. It checks a ticket's signature with
 * these alone, so it needs no network. They follow who signs:
 *
 * - the sandbox signs with the demo key, so its scanner trusts that;
 * - a server signs with `TICKET_SIGNING_KEY`, so its scanner trusts the matching public
 *   key, `NEXT_PUBLIC_TICKET_PUBLIC_KEY` (id `NEXT_PUBLIC_TICKET_KEY_ID`);
 * - a server outside production falls back to the demo key (`backend/server.ts`), so its
 *   scanner trusts that too. A production server never signs with it, and anyone can,
 *   so a production server's scanner never trusts it.
 */
import { DEMO_TICKET_KEY_ID, DEMO_TICKET_PUBLIC_KEY } from "@/core/demo-ticket-key";
import { DEFAULT_SERVER_KEY_ID, ticketKeyFrom, type TicketKeyring } from "@/core/ticket-token";
import { isServerMode } from "./backend-mode";

export interface DoorKeyConfig {
  isServerMode: boolean;
  isProduction: boolean;
  publicKey?: string | undefined;
  keyId?: string | undefined;
}

export function doorKeyringFor(config: DoorKeyConfig): TicketKeyring {
  const keys = new Map<string, Uint8Array>();
  if (!config.isServerMode || !config.isProduction) keys.set(DEMO_TICKET_KEY_ID, ticketKeyFrom(DEMO_TICKET_PUBLIC_KEY));
  if (config.isServerMode && config.publicKey) {
    keys.set(config.keyId ?? DEFAULT_SERVER_KEY_ID, ticketKeyFrom(config.publicKey));
  }
  return keys;
}

export const DOOR_KEYRING = doorKeyringFor({
  isServerMode,
  isProduction: process.env.NODE_ENV === "production",
  publicKey: process.env["NEXT_PUBLIC_TICKET_PUBLIC_KEY"],
  keyId: process.env["NEXT_PUBLIC_TICKET_KEY_ID"],
});
