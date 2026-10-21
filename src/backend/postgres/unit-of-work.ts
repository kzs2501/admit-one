/**
 * One hold's records, as the sandbox's rules see them: loaded under a lock on the hold's
 * row, changed by the sandbox's own functions, and written back in the same
 * transaction. Everything about an order happens to its hold, so locking the hold
 * serialises every change to it (a payment, its webhook, another attempt), across
 * processes. Stock is the exception, shared between holds; `stock.ts` keeps it.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BackendContext } from "@/backend/domain/context";
import type { Database } from "./db";
import {
  contextWith,
  holdRecordOf,
  orderRecordOf,
  orderRowOf,
  paymentRecordOf,
  paymentRowOf,
  providerEventRowOf,
  type HoldRecords,
  type ServerDeps,
} from "./records";
import { holds, inventory, orders, payments, providerEvents, seatClaims } from "./schema";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | Transaction;

/** How a request names the hold it's about: directly, or by its order or a payment. */
export type HoldReference = { holdId: string } | { orderId: string } | { paymentId: string };

async function holdIdFor(db: Queryable, reference: HoldReference): Promise<string | null> {
  if ("holdId" in reference) return reference.holdId;
  if ("orderId" in reference) {
    const [row] = await db.select({ holdId: orders.holdId }).from(orders).where(eq(orders.id, reference.orderId));
    return row?.holdId ?? null;
  }
  const [row] = await db
    .select({ holdId: orders.holdId })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(payments.id, reference.paymentId));
  return row?.holdId ?? null;
}

async function loadHoldRecords(db: Queryable, holdId: string, { isLocked }: { isLocked: boolean }) {
  const query = db.select().from(holds).where(eq(holds.id, holdId));
  const [holdRow] = isLocked ? await query.for("update") : await query;
  if (!holdRow) return null;
  const orderRows = await db.select().from(orders).where(eq(orders.holdId, holdId));
  const paymentRows = orderRows.length
    ? await db
        .select()
        .from(payments)
        .where(
          inArray(
            payments.orderId,
            orderRows.map((order) => order.id),
          ),
        )
    : [];
  return {
    hold: holdRecordOf(holdRow),
    orders: orderRows.map(orderRecordOf),
    payments: paymentRows.map(paymentRecordOf),
  } satisfies HoldRecords;
}

/** Write back what the sandbox's rules changed: the hold, its orders and payments, events to send, and stock sold. */
async function persist(tx: Transaction, context: BackendContext, holdId: string) {
  const { state } = context;
  const hold = state.holds[holdId];
  if (hold) {
    await tx
      .update(holds)
      .set({
        isExtended: hold.isExtended,
        expiresAt: new Date(hold.expiresAtMs),
        orderId: hold.orderId,
        ...(hold.isConverted ? { status: "converted" as const } : {}),
      })
      .where(eq(holds.id, holdId));
  }
  for (const order of Object.values(state.orders)) {
    const row = orderRowOf(order);
    await tx.insert(orders).values(row).onConflictDoUpdate({ target: orders.id, set: row });
  }
  for (const payment of Object.values(state.payments)) {
    const row = paymentRowOf(payment);
    await tx.insert(payments).values(row).onConflictDoUpdate({ target: payments.id, set: row });
  }
  if (state.outbox.length) await tx.insert(providerEvents).values(state.outbox.map(providerEventRowOf));

  // A converted hold's tickets move from held to sold, and its seats' claims become sales.
  const soldTiers = Object.entries(state.sold).sort(([left], [right]) => left.localeCompare(right));
  for (const [tierId, quantity] of soldTiers) {
    await tx
      .update(inventory)
      .set({ sold: sql`${inventory.sold} + ${quantity}`, held: sql`${inventory.held} - ${quantity}` })
      .where(eq(inventory.tierId, tierId));
  }
  if (state.soldSeatIds.length) {
    await tx
      .update(seatClaims)
      .set({ status: "sold" })
      .where(
        and(
          eq(seatClaims.holdId, holdId),
          inArray(seatClaims.seatId, state.soldSeatIds),
          isNull(seatClaims.releasedAt),
        ),
      );
  }
}

/**
 * Run the sandbox's rules on a hold's records, holding a lock on the hold's row until
 * what they changed is written. Null when there's no such hold.
 */
export function withHold<T>(
  db: Database,
  deps: ServerDeps,
  reference: HoldReference,
  run: (context: BackendContext, records: HoldRecords) => T,
): Promise<T | null> {
  return db.transaction((tx) => withHoldIn(tx, deps, reference, run));
}

/** The same, inside a transaction already open, so its writes commit with the caller's. */
export async function withHoldIn<T>(
  tx: Transaction,
  deps: ServerDeps,
  reference: HoldReference,
  run: (context: BackendContext, records: HoldRecords) => T,
): Promise<T | null> {
  const holdId = await holdIdFor(tx, reference);
  const records = holdId ? await loadHoldRecords(tx, holdId, { isLocked: true }) : null;
  if (!holdId || !records) return null;
  const context = contextWith(deps, records);
  const result = run(context, records);
  await persist(tx, context, holdId);
  return result;
}

/** Read a hold's records, for views: no lock, and nothing written. Null when there's no such hold. */
export async function readHold<T>(
  db: Database,
  deps: ServerDeps,
  reference: HoldReference,
  run: (context: BackendContext, records: HoldRecords) => T,
): Promise<T | null> {
  const holdId = await holdIdFor(db, reference);
  const records = holdId ? await loadHoldRecords(db, holdId, { isLocked: false }) : null;
  return records ? run(contextWith(deps, records), records) : null;
}
