import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATALOG, findEvent } from "@/core/catalog";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { SeatMap } from "@/features/events/components/seat-map/seat-map";
import { TierPicker } from "@/features/events/components/tier-picker";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATALOG.map((event) => ({ slug: event.slug }));
}

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const event = findEvent((await params).slug);
  return event ? { title: event.name, description: event.tagline } : {};
}

export default async function EventPage({ params }: PageProps<"/events/[slug]">) {
  const event = findEvent((await params).slug);
  if (!event) notFound();
  const isReserved = event.seating.kind === "reserved";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <Link href="/" className="-mx-1 inline-flex min-h-8 items-center px-1 text-sm text-ink-3 hover:text-ink">
        ← All events
      </Link>
      <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div>
          <p className="tabular text-xs tracking-[0.12em] text-ink-3 uppercase">
            {formatEventDate(event.startsAt, event.timeZone)} · {formatEventTime(event.startsAt, event.timeZone)}
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-balance">{event.name}</h1>
          <p className="mt-3 text-lg text-pretty text-ink-2">{event.tagline}</p>
          <p className="mt-6 max-w-prose text-pretty">{event.description}</p>
          <dl className="mt-6 grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-3">Venue</dt>
            <dd>
              {event.venue}, {event.city}
            </dd>
            <dt className="text-ink-3">Starts</dt>
            <dd>{formatEventTime(event.startsAt, event.timeZone)}</dd>
          </dl>
        </div>
        <section aria-labelledby="tickets-title">
          <h2 id="tickets-title" className="mb-3 font-display text-lg font-semibold">
            {isReserved ? "Best available" : "Tickets"}
          </h2>
          {isReserved && <p className="mb-3 text-sm text-ink-2">Say how many; we’ll find the best seats together.</p>}
          <TierPicker slug={event.slug} />
        </section>
      </div>
      {isReserved && <SeatMap slug={event.slug} />}
    </div>
  );
}
