/**
 * The orders from before this sandbox started: about 10,000 of them, generated from
 * a seed rather than stored. That many would overflow the sandbox's storage and slow
 * every save, and a seed gives the same history every time.
 *
 * The history agrees with the catalogue. Fulfilled orders add up to exactly each
 * tier's `baselineSold`, and a seated hall's sold seats are its orders' seats, so the
 * organiser's "sold" and the event page's "left" can't disagree.
 */
import { CATALOG, type EventInfo } from "@/core/catalog";
import { priceOrder, type Amounts } from "@/core/pricing";
import { seededRandom } from "@/core/random";
import type { PaymentMethod } from "@/core/statuses";

const SEED = 20_261_019;
const DAY_MS = 24 * 60 * 60_000;
/** The history covers the 30 days before the sandbox started. */
export const HISTORY_DAYS = 30;

/** Of every hundred orders that sold tickets, how many others ended each other way. */
const OTHER_OUTCOMES = { refunded: 0.03, failed: 0.05, expired: 0.09 } as const;
/** Holds that never became an order, per order: the top of the funnel. */
const ABANDONED_HOLDS_PER_ORDER = 0.5;
const UPI_SHARE = 0.62;
const ADD_ON_SHARE = 0.25;

export type HistoricalStatus = "fulfilled" | keyof typeof OTHER_OUTCOMES;

export interface HistoricalOrder {
  id: string;
  eventSlug: string;
  tierId: string;
  quantity: number;
  /** Reserved seating: the seats sold. Empty otherwise, and for orders that sold nothing. */
  seatIds: readonly string[];
  addOns: Readonly<Record<string, number>>;
  buyer: { name: string; email: string };
  amounts: Amounts;
  status: HistoricalStatus;
  method: PaymentMethod;
  /** Cards only. */
  last4: string | null;
  /** How long before the sandbox started the order was placed. */
  agoMs: number;
  /** For orders that were paid: how long the payment provider's webhook took. */
  webhookLagMs: number | null;
}

export interface History {
  /** Oldest first. */
  orders: readonly HistoricalOrder[];
  /** Holds that never became an order, per event. */
  abandonedHolds: Readonly<Record<string, number>>;
}

const FIRST_NAMES = [
  "Aarav",
  "Aditi",
  "Akash",
  "Ananya",
  "Arjun",
  "Bhavna",
  "Chetan",
  "Deepa",
  "Dev",
  "Divya",
  "Farhan",
  "Gauri",
  "Harsh",
  "Ishita",
  "Jai",
  "Kavya",
  "Kiran",
  "Lakshmi",
  "Manav",
  "Meera",
  "Neha",
  "Nikhil",
  "Pooja",
  "Pranav",
  "Rahul",
  "Riya",
  "Sahil",
  "Sana",
  "Tara",
  "Vikram",
];
const LAST_NAMES = [
  "Agarwal",
  "Bose",
  "Chopra",
  "Das",
  "D’Souza",
  "Fernandes",
  "Ghosh",
  "Gupta",
  "Iyer",
  "Joshi",
  "Kapoor",
  "Khan",
  "Kulkarni",
  "Menon",
  "Mukherjee",
  "Nair",
  "Pandey",
  "Patel",
  "Pillai",
  "Rao",
  "Reddy",
  "Saxena",
  "Sen",
  "Shah",
  "Sharma",
  "Singh",
  "Thomas",
  "Varma",
  "Verma",
  "Yadav",
];

type Random = () => number;

const pick = <T>(random: Random, items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("Nothing to pick from");
  return item;
};

/** Most orders are for one or two people. Mean about 1.7 tickets. */
const partySize = (random: Random) => {
  const roll = random();
  return roll < 0.5 ? 1 : roll < 0.85 ? 2 : roll < 0.93 ? 3 : 4;
};

/** Busiest the day sales opened, quieter after, picking up again in the last week. */
function daysAgo(random: Random) {
  const weights = Array.from({ length: HISTORY_DAYS }, (_, day) =>
    day === HISTORY_DAYS - 1 ? 8 : day < 7 ? 2.5 - day * 0.15 : 1,
  );
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [day, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return day;
  }
  return 0;
}

/** Usually a second or two; now and then a provider is slow, and the tail is long. */
const webhookLag = (random: Random) =>
  Math.round(500 + 900 * -Math.log(1 - random()) + (random() < 0.03 ? 8_000 + random() * 32_000 : 0));

/** What sold, as orders: general admission split into parties; a hall's sold seats taken run by run. */
function soldParties(event: EventInfo, random: Random) {
  const { seating } = event;
  if (seating.kind === "reserved") {
    return seating.plan.sections.flatMap((section) =>
      section.rows.flatMap((row) =>
        row.blocks.flatMap((block) => {
          const runs: string[][] = [];
          let run: string[] = [];
          for (const seat of block) {
            if (seating.baselineSoldSeatIds.has(seat.id)) run.push(seat.id);
            else if (run.length) [runs[runs.length], run] = [run, []];
          }
          if (run.length) runs.push(run);
          return runs.map((seatIds) => ({ tierId: row.tierId, quantity: seatIds.length, seatIds }));
        }),
      ),
    );
  }
  return event.tiers.flatMap((tier) => {
    const parties: { tierId: string; quantity: number; seatIds: string[] }[] = [];
    for (let left = tier.baselineSold; left > 0;) {
      const quantity = Math.min(left, partySize(random));
      parties.push({ tierId: tier.id, quantity, seatIds: [] });
      left -= quantity;
    }
    return parties;
  });
}

export function generateHistory(seed = SEED): History {
  const random = seededRandom(seed);
  const priced = new Map<string, Amounts>();
  const orders: Omit<HistoricalOrder, "id">[] = [];
  const abandonedHolds: Record<string, number> = {};

  for (const event of CATALOG) {
    const fulfilled = soldParties(event, random).map((party) => ({ ...party, status: "fulfilled" as const }));
    const others = Object.entries(OTHER_OUTCOMES).flatMap(([status, share]) =>
      Array.from({ length: Math.round(fulfilled.length * share) }, () => ({
        tierId: pick(random, event.tiers).id,
        quantity: partySize(random),
        seatIds: [],
        status: status as keyof typeof OTHER_OUTCOMES,
      })),
    );
    const placed = [...fulfilled, ...others];
    abandonedHolds[event.slug] = Math.round(placed.length * ABANDONED_HOLDS_PER_ORDER);

    for (const { tierId, quantity, seatIds, status } of placed) {
      const addOns = Object.fromEntries(
        event.addOns.filter(() => random() < ADD_ON_SHARE).map((addOn) => [addOn.id, 1]),
      );
      const key = `${tierId}:${String(quantity)}:${Object.keys(addOns).join(",")}`;
      const amounts = priced.get(key) ?? priceOrder(event, [{ tierId, quantity }], addOns);
      priced.set(key, amounts);
      const first = pick(random, FIRST_NAMES);
      const last = pick(random, LAST_NAMES);
      const method: PaymentMethod = random() < UPI_SHARE ? "upi" : "card";
      const isPaid = status === "fulfilled" || status === "refunded";
      orders.push({
        eventSlug: event.slug,
        tierId,
        quantity,
        seatIds,
        addOns,
        buyer: {
          name: `${first} ${last}`,
          email:
            `${first}.${last.replace(/\W/g, "")}${String(Math.floor(random() * 90) + 10)}@example.com`.toLowerCase(),
        },
        amounts,
        status,
        method,
        last4: method === "card" ? String(1000 + Math.floor(random() * 9000)) : null,
        agoMs: daysAgo(random) * DAY_MS + Math.floor(random() * DAY_MS),
        webhookLagMs: isPaid ? webhookLag(random) : null,
      });
    }
  }

  // Oldest first, numbered in that order, so ids read like a real sequence.
  orders.sort((older, newer) => newer.agoMs - older.agoMs);
  return {
    orders: orders.map((order, i) => ({ id: `ord_h${String(i + 1).padStart(5, "0")}`, ...order })),
    abandonedHolds,
  };
}

/** Another buyer in this sandbox — the crowd — made up from their sale's number, the same every time. */
export function otherBuyer(seq: number) {
  const random = seededRandom(SEED + seq);
  const first = pick(random, FIRST_NAMES);
  const last = pick(random, LAST_NAMES);
  const method: PaymentMethod = random() < UPI_SHARE ? "upi" : "card";
  return {
    name: `${first} ${last}`,
    email: `${first}.${last.replace(/\W/g, "")}.${String(seq)}@example.com`.toLowerCase(),
    method,
    last4: method === "card" ? String(1000 + Math.floor(random() * 9000)) : null,
    webhookLagMs: webhookLag(random),
  };
}

let history: History | null = null;
let byId: ReadonlyMap<string, HistoricalOrder> | null = null;

/** Generated on first use (an organiser's first request), then kept: buyers never pay for it. */
export function getHistory(): History {
  history ??= generateHistory();
  return history;
}

export function findHistoricalOrder(orderId: string): HistoricalOrder | undefined {
  byId ??= new Map(getHistory().orders.map((order) => [order.id, order]));
  return byId.get(orderId);
}
