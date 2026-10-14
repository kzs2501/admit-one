/**
 * The event catalogue: static content, shipped with the app and rendered on the
 * server. Live numbers (what's still available) never live here — they come from
 * the API, because they change while the page is open.
 *
 * All events, venues and people are fictional.
 */
export type Tier = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  capacity: number;
  /** Tickets already sold before this sandbox started. */
  baselineSold: number;
};

export type AddOn = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
};

export type EventInfo = {
  slug: string;
  name: string;
  tagline: string;
  startsAt: string; // ISO 8601 with offset
  venue: string;
  city: string;
  description: string;
  tiers: Tier[];
  addOns: AddOn[];
};

export const MAX_TICKETS_PER_ORDER = 6;

export const catalog: EventInfo[] = [
  {
    slug: "frontend-systems-summit",
    name: "Frontend Systems Summit",
    tagline: "One day of talks on design systems, performance and the web platform.",
    startsAt: "2026-11-21T09:30:00+05:30",
    venue: "The Foundry, Hall 2",
    city: "Pune",
    description:
      "Twelve talks and two hands-on workshops from people who maintain design systems and frontend platforms at scale. Workshop passes include a morning session with a limited room.",
    tiers: [
      {
        id: "fss-general",
        name: "General",
        description: "All talks, coffee, and the evening meetup.",
        priceCents: 14900,
        capacity: 120,
        baselineSold: 41,
      },
      {
        id: "fss-workshop",
        name: "Workshop + General",
        description: "Everything in General plus a three-hour morning workshop.",
        priceCents: 34900,
        capacity: 20,
        baselineSold: 14,
      },
    ],
    addOns: [
      { id: "fss-lunch", name: "Lunch pass", description: "Hot lunch on the day.", priceCents: 1800 },
      { id: "fss-tee", name: "Summit T-shirt", description: "Collected at registration.", priceCents: 2500 },
    ],
  },
  {
    slug: "night-market-jazz",
    name: "Night Market Jazz",
    tagline: "A standing-room trio set in a covered courtyard.",
    startsAt: "2026-11-07T20:00:00+05:30",
    venue: "Courtyard at Old Mill Lane",
    city: "Goa",
    description:
      "A small, standing-only evening with a piano trio. The courtyard holds forty people, and it’s almost full.",
    tiers: [
      {
        id: "nmj-standing",
        name: "Standing",
        description: "Entry from 7:30 pm.",
        priceCents: 3500,
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
    venue: "Clayhouse Studio",
    city: "Jaipur",
    description:
      "A beginner-friendly session on the pottery wheel. Twelve places per session; we fire and glaze your pieces for collection two weeks later.",
    tiers: [
      {
        id: "osc-session",
        name: "Two-hour session",
        description: "Clay, tools, firing and glazing included.",
        priceCents: 6000,
        capacity: 12,
        baselineSold: 3,
      },
    ],
    addOns: [],
  },
];

export const getEventInfo = (slug: string) => catalog.find((e) => e.slug === slug);

export const findTier = (tierId: string) => {
  for (const event of catalog) {
    const tier = event.tiers.find((t) => t.id === tierId);
    if (tier) return { event, tier };
  }
  return undefined;
};

export const lowestPriceCents = (event: EventInfo) => Math.min(...event.tiers.map((t) => t.priceCents));
