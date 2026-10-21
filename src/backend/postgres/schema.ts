/**
 * The server backend's tables. Where the sandbox relies on being single-threaded, these
 * rely on the database: a row's own counters for stock, and a unique index for seats,
 * so two buyers can't both get the last ticket or the same seat, whatever the timing.
 * Times are stored as `timestamptz` and always come from the app's clock, never the
 * database's `now()`, so tests on a fake clock behave exactly as the sandbox's do.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { LineItem } from "@/core/ticketing";

const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Tickets of each general-admission tier. `sold` includes those sold before the demo;
 * `held` counts tickets in holds not yet released. Holding is one conditional update of
 * this row (see `holds.ts`), and the check is the database's own promise that a bug
 * elsewhere still can't oversell.
 */
export const inventory = pgTable(
  "inventory",
  {
    tierId: text("tier_id").primaryKey(),
    eventSlug: text("event_slug").notNull(),
    capacity: integer("capacity").notNull(),
    sold: integer("sold").notNull().default(0),
    held: integer("held").notNull().default(0),
  },
  (table) => [
    check(
      "inventory_within_capacity",
      sql`${table.sold} >= 0 AND ${table.held} >= 0 AND ${table.sold} + ${table.held} <= ${table.capacity}`,
    ),
  ],
);

export const holds = pgTable(
  "holds",
  {
    id: text("id").primaryKey(),
    eventSlug: text("event_slug").notNull(),
    items: jsonb("items").$type<LineItem[]>().notNull(),
    /** Reserved seating: the seats held, in the order they'll go to attendees. */
    seatIds: text("seat_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status", { enum: ["active", "converted", "expired"] })
      .notNull()
      .default("active"),
    /** Payment start may extend a hold once, so a buyer mid-payment isn't cut off. */
    isExtended: boolean("is_extended").notNull().default(false),
    orderId: text("order_id"),
    createdAt: at("created_at").notNull(),
    expiresAt: at("expires_at").notNull(),
  },
  (table) => [
    index("holds_active_by_expiry")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
  ],
);

/**
 * One row per seat that's taken: held, or sold. The partial unique index is the lock:
 * the database refuses a second unreleased claim on a seat, however the requests
 * interleave. A sale updates the claim in place, so there's never a moment between
 * "held" and "sold" when the seat looks free.
 */
export const seatClaims = pgTable(
  "seat_claims",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventSlug: text("event_slug").notNull(),
    seatId: text("seat_id").notNull(),
    /** Null for seats sold before the demo. */
    holdId: text("hold_id").references(() => holds.id),
    status: text("status", { enum: ["held", "sold"] }).notNull(),
    claimedAt: at("claimed_at").notNull(),
    releasedAt: at("released_at"),
  },
  (table) => [
    uniqueIndex("one_claim_per_seat")
      .on(table.eventSlug, table.seatId)
      .where(sql`${table.releasedAt} IS NULL`),
    index("seat_claims_by_hold").on(table.holdId),
  ],
);
