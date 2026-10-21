/**
 * The sandbox's ticket-signing key: a DEMO KEY, NOT A SECRET.
 *
 * The browser sandbox runs its backend in the page, so whatever key it signs tickets
 * with ships in the page too, and anyone who reads the bundle can sign tickets the demo
 * scanner accepts. That's the honest limit of a demo with no server. Server mode signs
 * with its own key (`TICKET_SIGNING_KEY`), which never reaches the browser; scanners
 * trust it by its public key alone.
 */
import { signTicket, ticketKeyFrom, type TicketClaims } from "./ticket-token";

export const DEMO_TICKET_KEY_ID = "demo-2026";
export const DEMO_TICKET_PUBLIC_KEY = "8kgCCvVhTPJAnN1Tuxn23Jaxt39DXvVM3nKxmMOVhVk";
const DEMO_TICKET_SECRET_KEY = "P0Cq2V0YOuafawbSi7X30_0gBYCwg17myZuMAjqxzMg";

/** Sign a ticket as the demo does. */
export const signDemoTicket = (claims: TicketClaims) =>
  signTicket(claims, { kid: DEMO_TICKET_KEY_ID, secretKey: ticketKeyFrom(DEMO_TICKET_SECRET_KEY) });
