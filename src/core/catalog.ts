/**
 * The event catalogue: static content, shipped with the app and rendered on the
 * server. Live numbers (what's still available) never live here — they come from
 * the API, because they change while the page is open.
 *
 * All events, venues and people are fictional.
 */
import type { CurrencyCode } from "./money";

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
}

export interface EventInfo {
  slug: string;
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
  tiers: TierInfo[];
  addOns: AddOnInfo[];
}

export const CATALOG: EventInfo[] = [
  {
    slug: "frontend-systems-summit",
    name: "Frontend Systems Summit",
    tagline: "One day of talks on design systems, performance and the web platform.",
    startsAt: "2026-11-21T09:30:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "The Foundry, Hall 2",
    city: "Pune",
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
      { id: "fss-lunch", name: "Lunch pass", description: "Hot lunch on the day.", priceMinor: 45000 },
      { id: "fss-tee", name: "Summit T-shirt", description: "Collected at registration.", priceMinor: 79900 },
    ],
  },
  {
    slug: "night-market-jazz",
    name: "Night Market Jazz",
    tagline: "A standing-room trio set in a covered courtyard.",
    startsAt: "2026-11-07T20:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Courtyard at Old Mill Lane",
    city: "Goa",
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
    ],
    addOns: [],
  },
  {
    slug: "open-studio-ceramics",
    name: "Open Studio: Ceramics",
    tagline: "Two hours at the wheel, materials and firing included.",
    startsAt: "2026-12-05T11:00:00+05:30",
    timeZone: "Asia/Kolkata",
    currency: "INR",
    venue: "Clayhouse Studio",
    city: "Jaipur",
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
];

export const findEvent = (slug: string): EventInfo | undefined => CATALOG.find((event) => event.slug === slug);

/** For slugs that must exist (records only reference catalogue events): a miss is a bug. */
export function getEvent(slug: string): EventInfo {
  const event = findEvent(slug);
  if (!event) throw new Error(`Unknown event ${slug}`);
  return event;
}

export const findTier = (tierId: string) => {
  for (const event of CATALOG) {
    const tier = event.tiers.find((candidate) => candidate.id === tierId);
    if (tier) return { event, tier };
  }
  return undefined;
};

export const lowestPriceMinor = (event: EventInfo) => Math.min(...event.tiers.map((tier) => tier.priceMinor));
