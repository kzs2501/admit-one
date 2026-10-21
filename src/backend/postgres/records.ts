/**
 * Rows as the sandbox's records. The server backend loads one hold's rows into the
 * sandbox's own shapes and runs the sandbox's rules on them (see `unit-of-work.ts`), so
 * both backends keep the same rules and show the same views.
 */
import { DEFAULT_CHAOS, type ChaosConfig } from "@/backend/chaos/presets";
import type { BackendContext, Deps } from "@/backend/domain/context";
import { createInitialState, type HoldRecord } from "@/backend/domain/state";
import type { holds } from "./schema";

/**
 * The server's settings, where the sandbox has chaos presets: no simulated latency, and
 * no rate limit here, since one limiter in a process would count every client together
 * (a real deployment limits per client, at the edge). The simulated provider still
 * takes a moment to send its webhook, as real ones do.
 */
export const SERVER_SETTINGS: ChaosConfig = {
  ...DEFAULT_CHAOS,
  latencyRangeMs: [0, 0],
  extraPaymentLatencyMs: 0,
  holdRateLimit: null,
};

export type ServerDeps = Omit<Deps, "newToken">;

export const holdRecordOf = (row: typeof holds.$inferSelect): HoldRecord => ({
  id: row.id,
  eventSlug: row.eventSlug,
  items: row.items,
  seatIds: row.seatIds,
  createdAtMs: row.createdAt.getTime(),
  expiresAtMs: row.expiresAt.getTime(),
  isConverted: row.status === "converted",
  isExtended: row.isExtended,
  orderId: row.orderId,
});

/** The sandbox's context, holding only the given records: enough for its rules and views to run on. */
export function contextWith(deps: ServerDeps, { hold }: { hold?: HoldRecord }): BackendContext {
  const state = createInitialState("happy", deps.now());
  if (hold) state.holds[hold.id] = hold;
  return {
    state,
    deps: {
      ...deps,
      newToken: () => {
        throw new Error("The server backend issues no session tokens.");
      },
    },
    chaos: () => SERVER_SETTINGS,
    log: () => undefined,
  };
}
