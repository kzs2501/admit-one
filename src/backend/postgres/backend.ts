/**
 * The server backend: the buyer's API on Postgres, behind the same port as the
 * sandbox. Stock and seats are the database's business (`stock.ts`); everything else
 * runs the sandbox's own rules on rows loaded for the purpose, so both backends answer
 * alike.
 */
import { eq } from "drizzle-orm";
import { CATALOG, findEvent, getEvent, type EventInfo } from "@/core/catalog";
import { fail, ok, type Result } from "@/backend/domain/errors";
import type { CreateHoldCommand } from "@/backend/domain/inventory";
import { isReservedEvent } from "@/backend/domain/seating";
import {
  eventViewOf,
  toHoldDetailsView,
  type EventView,
  type HoldDetailsView,
  type SeatAvailabilityView,
} from "@/backend/domain/views";
import type { Database } from "./db";
import { contextWith, holdRecordOf, SERVER_SETTINGS, type ServerDeps } from "./records";
import { holds } from "./schema";
import { availability, holdByTiers, holdSeats, unavailableSeatIds } from "./stock";

export function createPostgresBackend(db: Database, deps: ServerDeps) {
  const now = () => new Date(deps.now());

  async function eventView(event: EventInfo): Promise<EventView> {
    const left = await availability(db, event, now());
    return eventViewOf(event, { isQueueActive: false, availableFor: (tierId) => left.get(tierId) ?? 0 });
  }

  async function holdDetails(holdId: string): Promise<Result<HoldDetailsView>> {
    const row = await db.query.holds.findFirst({ where: eq(holds.id, holdId) });
    if (!row) return fail({ code: "not_found", detail: "That reservation doesn’t exist." });
    const hold = holdRecordOf(row);
    return ok(toHoldDetailsView(contextWith(deps, { hold }), hold, await eventView(getEvent(hold.eventSlug))));
  }

  return {
    chaos: () => SERVER_SETTINGS,
    /** The server's record of what happened is its request log, not the sandbox's panel. */
    log: () => undefined,

    listEvents: (): Promise<EventView[]> => Promise.all(CATALOG.map(eventView)),

    async getEvent(slug: string): Promise<Result<EventView>> {
      const event = findEvent(slug);
      return event ? ok(await eventView(event)) : fail({ code: "not_found", detail: "No such event." });
    },

    async getSeatAvailability(eventSlug: string): Promise<Result<SeatAvailabilityView>> {
      const event = findEvent(eventSlug);
      if (!event) return fail({ code: "not_found", detail: "No such event." });
      if (!isReservedEvent(event)) return fail({ code: "not_found", detail: "This event has no reserved seats." });
      return ok({
        eventSlug,
        unavailableSeatIds: [...(await unavailableSeatIds(db, eventSlug, now()))],
        serverTimeMs: deps.now(),
      });
    },

    /** There's no waiting room on the server, so the queue token isn't needed. */
    async createHold(command: CreateHoldCommand): Promise<Result<HoldDetailsView>> {
      const event = findEvent(command.eventSlug);
      if (!event) return fail({ code: "not_found", detail: "No such event." });
      const createdAt = now();
      const draft = {
        id: deps.newId("hold"),
        eventSlug: event.slug,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + SERVER_SETTINGS.holdDurationMs),
      };
      const held =
        "seatIds" in command
          ? await holdSeats(db, event, draft, command.seatIds)
          : await holdByTiers(db, event, draft, command.items);
      return held.ok ? holdDetails(held.value.id) : held;
    },

    getHold: holdDetails,
  };
}

export type PostgresBackend = ReturnType<typeof createPostgresBackend>;
