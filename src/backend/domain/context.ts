import type { ChaosConfig } from "@/backend/chaos/presets";
import type { LogKind, ServerState } from "./state";

/** What the outside world provides — injected, so every rule runs on a fake clock in tests. */
export type Deps = {
  now: () => number;
  newId: (prefix: string) => string;
  random: () => number;
};

/**
 * Everything a domain module needs, passed explicitly instead of closed over. `state`
 * is reassigned on reset, so modules read it at call time and never keep a reference.
 */
export type BackendContext = {
  state: ServerState;
  readonly deps: Deps;
  chaos: () => ChaosConfig;
  log: (kind: LogKind, message: string) => void;
};
