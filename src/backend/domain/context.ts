import type { ChaosConfig } from "@/backend/chaos/presets";
import type { PaymentMethod } from "@/core/statuses";
import type { TicketClaims } from "@/core/ticket-token";
import type { HoldRecord, LogKind, ServerState } from "./state";

/** What the outside world provides — injected, so every rule runs on a fake clock in tests. */
export interface Deps {
  now: () => number;
  newId: (prefix: string) => string;
  /** A secret, such as a session token: unguessable, unlike an id. */
  newToken: () => string;
  random: () => number;
  /** Sign a ticket as it's issued, so a door can verify it offline (core/ticket-token). */
  signTicket: (claims: TicketClaims) => string;
}

/**
 * Everything a domain module needs, passed explicitly instead of closed over. `state`
 * is reassigned on reset, so modules read it at call time and never keep a reference.
 */
export interface BackendContext {
  state: ServerState;
  readonly deps: Deps;
  chaos: () => ChaosConfig;
  log: (kind: LogKind, message: string) => void;
  /**
   * Whether a hold still has its tickets, so a payment for it can still become a sale.
   * Storage answers this: the sandbox's holds give their tickets back the moment they
   * run out (lazy expiry), the server's keep them until another hold sweeps them up.
   */
  hasItsTickets: (hold: HoldRecord) => boolean;
  /** The ways to pay that this backend's provider takes: the sandbox simulates more than the server can. */
  readonly paymentMethods: readonly PaymentMethod[];
}
