import type { ChaosConfig } from "@/backend/chaos/presets";
import type { TicketClaims } from "@/core/ticket-token";
import type { LogKind, ServerState } from "./state";

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
}
