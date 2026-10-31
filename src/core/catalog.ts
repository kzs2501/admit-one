/**
 * The event catalogue: static content, shipped with the app and rendered on the
 * server. Live numbers (what's still available) never live here — they come from
 * the API, because they change while the page is open.
 *
 * All events, venues and people are fictional.
 */
import type { CurrencyCode } from "./money";
import type { OrganisationId } from "./organisations";
import type { SeatPlan } from "./seating";
import { baselineSoldSeatIds, RANGMANCH_PLAN } from "./venues";

export interface TierInfo {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  capacity: number;
  /** Tickets already sold before this sandbox started. */
  baselineSold: number;
}

export interface AddOnInfo {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  /**
   * GST on this extra. Illustrative, not tax advice: an extra's rate depends on what it
   * is (food, clothing, printed matter), and these show the engine handling more than
   * one rate, not a ruling on any of them.
   */
  gstRateBasisPoints: number;
}

/** Whether buyers pick a quantity of each tier, or particular seats. */
export type Seating =
  | { kind: "general" }
  | {
      kind: "reserved";
      plan: SeatPlan;
      /** Seats sold before this sandbox started. */
      baselineSoldSeatIds: ReadonlySet<string>;
    };

export interface EventInfo {
  slug: string;
  /** The organisation that runs it, and whose accounts may see its orders. */
  organiserId: OrganisationId;
  name: string;
  tagline: string;
  /** ISO 8601, with the venue's offset. */
  startsAt: string;
  /** IANA zone the venue is in: event times are shown in it, wherever the visitor is. */
  timeZone: string;
  /** Every price at this event is in this currency (ISO 4217). */
  currency: CurrencyCode;
  venue: string;
  city: string;
  description: string;
  seating: Seating;
  tiers: TierInfo[];
  addOns: AddOnInfo[];
}

const MONSOON_SOLD_SEAT_IDS = baselineSoldSeatIds(RANGMANCH_PLAN, 2026);

/** A reserved tier's capacity and baseline come from its seats, so the two can't disagree. */
function seatedTier(
  plan: SeatPlan,
  soldSeatIds: ReadonlySet<string>,
  tier: Omit<TierInfo, "capacity" | "baselineSold">,
) {
  const seats = plan.seats.filter((seat) => seat.tierId === tier.id);
  return { ...tier, capacity: seats.length, baselineSold: seats.filter((seat) => soldSeatIds.has(seat.id)).length };
}

export const CATALOG: EventInfo[] = [
  {
    slug: "frontend-systems-summit",
    organiserId: "lakeside-live",
    name: "Frontend Systems Summit",
    tagline: "One day of talks on design systems, performance and the web platform.",
    startsAt: "2026-11-21T09:30:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "The Foundry, Hall 2",
    city: "Pune",
    seating: { kind: "general" },
    description:
      "Twelve talks and two hands-on workshops from people who maintain design systems and frontend platforms at scale. Workshop passes include a morning session with a limited room.",
    tiers: [
      {
        id: "fss-general",
        name: "General",
        description: "All talks, coffee, and the evening meetup.",
        priceMinor: 499900,
        capacity: 120,
        baselineSold: 41,
      },
      {
        id: "fss-workshop",
        name: "Workshop + General",
        description: "Everything in General plus a three-hour morning workshop.",
        priceMinor: 1199900,
        capacity: 20,
        baselineSold: 14,
      },
    ],
    addOns: [
      {
        id: "fss-lunch",
        name: "Lunch pass",
        description: "Hot lunch on the day.",
        priceMinor: 45000,
        gstRateBasisPoints: 500,
      },
      {
        id: "fss-tee",
        name: "Summit T-shirt",
        description: "Collected at registration.",
        priceMinor: 79900,
        gstRateBasisPoints: 500,
      },
    ],
  },
  {
    slug: "night-market-jazz",
    organiserId: "lakeside-live",
    name: "Night Market Jazz",
    tagline: "A standing-room trio set in a covered courtyard.",
    startsAt: "2026-11-07T20:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Courtyard at Old Mill Lane",
    city: "Goa",
    seating: { kind: "general" },
    description:
      "A small, standing-only evening with a piano trio. The courtyard holds forty people, and it’s almost full.",
    tiers: [
      {
        id: "nmj-standing",
        name: "Standing",
        description: "Entry from 7:30 pm.",
        priceMinor: 120000,
        capacity: 40,
        baselineSold: 38,
      },
      {
        id: "nmj-student",
        name: "Student standing",
        description: "With a valid student ID. At ₹500 or less, there’s no GST on the ticket.",
        priceMinor: 45000,
        capacity: 10,
        baselineSold: 4,
      },
    ],
    addOns: [],
  },
  {
    slug: "open-studio-ceramics",
    organiserId: "rangmanch-arts",
    name: "Open Studio: Ceramics",
    tagline: "Two hours at the wheel, materials and firing included.",
    startsAt: "2026-12-05T11:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Clayhouse Studio",
    city: "Jaipur",
    seating: { kind: "general" },
    description:
      "A beginner-friendly session on the pottery wheel. Twelve places per session; we fire and glaze your pieces for collection two weeks later.",
    tiers: [
      {
        id: "osc-session",
        name: "Two-hour session",
        description: "Clay, tools, firing and glazing included.",
        priceMinor: 250000,
        capacity: 12,
        baselineSold: 3,
      },
    ],
    addOns: [],
  },
  {
    slug: "monsoon-strings",
    organiserId: "rangmanch-arts",
    name: "Monsoon Strings",
    tagline: "A chamber orchestra plays The Four Seasons, and four new ones written for the monsoon.",
    startsAt: "2026-12-12T19:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Rangmanch Auditorium",
    city: "Bengaluru",
    seating: { kind: "reserved", plan: RANGMANCH_PLAN, baselineSoldSeatIds: MONSOON_SOLD_SEAT_IDS },
    description:
      "Vivaldi’s Four Seasons, paired with four new pieces by Indian composers on the monsoon’s arrival, height and retreat. Every seat is reserved: choose yours on the map, or let us find the best ones left.",
    tiers: [
      seatedTier(RANGMANCH_PLAN, MONSOON_SOLD_SEAT_IDS, {
        id: "ms-premium",
        name: "Premium",
        description: "Stalls rows A–F, closest to the orchestra.",
        priceMinor: 249900,
      }),
      seatedTier(RANGMANCH_PLAN, MONSOON_SOLD_SEAT_IDS, {
        id: "ms-stalls",
        name: "Stalls",
        description: "Stalls rows G–V.",
        priceMinor: 149900,
      }),
      seatedTier(RANGMANCH_PLAN, MONSOON_SOLD_SEAT_IDS, {
        id: "ms-balcony",
        name: "Balcony",
        description: "The upper level, with the whole stage in view.",
        priceMinor: 89900,
      }),
    ],
    addOns: [
      {
        id: "ms-programme",
        name: "Printed programme",
        description: "Notes on every piece; collected at the door.",
        priceMinor: 15000,
        gstRateBasisPoints: 1800,
      },
    ],
  },
  {
    slug: "lakeside-lights",
    organiserId: "lakeside-live",
    name: "Lakeside Lights Festival",
    tagline: "Two days of music by the water, and a lantern parade at dusk.",
    startsAt: "2027-01-16T14:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Lakefront Grounds",
    city: "Udaipur",
    seating: { kind: "general" },
    description:
      "Twenty acts across two stages over a weekend, with food stalls, a craft market and a lantern parade along the shore on both evenings. Day passes are for either day; weekend passes are for both.",
    tiers: [
      {
        id: "llf-day",
        name: "Day pass",
        description: "Either day, gates from 2 pm.",
        priceMinor: 249900,
        capacity: 12_000,
        baselineSold: 8_400,
      },
      {
        id: "llf-weekend",
        name: "Weekend pass",
        description: "Both days.",
        priceMinor: 399900,
        capacity: 7_000,
        baselineSold: 4_550,
      },
      {
        id: "llf-vip",
        name: "VIP weekend",
        description: "Both days, with a raised deck by the main stage and shaded seating.",
        priceMinor: 1299900,
        capacity: 500,
        baselineSold: 360,
      },
    ],
    addOns: [
      {
        id: "llf-parking",
        name: "Parking pass",
        description: "One car, both days.",
        priceMinor: 50000,
        gstRateBasisPoints: 1800,
      },
    ],
  },
];

export const findEvent = (slug: string): EventInfo | undefined => CATALOG.find((event) => event.slug === slug);

/** For slugs that must exist (records only reference catalogue events): a miss is a bug. */
export function getEvent(slug: string): EventInfo {
  const event = findEvent(slug);
  if (!event) throw new Error(`Unknown event ${slug}`);
  return event;
}

/** The hall of an event with reserved seating; asking for one that has none is a bug. */
export function getSeatPlan(slug: string): SeatPlan {
  const { seating } = getEvent(slug);
  if (seating.kind !== "reserved") throw new Error(`${slug} has no reserved seating`);
  return seating.plan;
}

export const findTier = (tierId: string) => {
  for (const event of CATALOG) {
    const tier = event.tiers.find((candidate) => candidate.id === tierId);
    if (tier) return { event, tier };
  }
  return undefined;
};
