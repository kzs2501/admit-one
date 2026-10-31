import Link from "next/link";
import { CATALOG } from "@/core/catalog";
import { lowestAllInPriceMinor } from "@/core/pricing";
import { formatEventDate, formatEventTime, formatMoney } from "@/lib/format";
import { AvailabilityBadge } from "@/features/events/components/availability-badge";
import { routes } from "@/lib/routes";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="tabular text-xs tracking-[0.16em] text-ink-3 uppercase">Upcoming</p>
      <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Find a seat for tonight.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-pretty text-ink-2">
        Concerts, talks and workshops across five Indian cities. Everything here works the way a real box office does,
        and nothing is charged. Open the <strong className="font-medium text-ink">Chaos panel</strong> to decline a
        card, send a webhook twice, or let a crowd chase the last seat.
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOG.map((event) => (
          <li key={event.slug}>
            <Link
              href={routes.event(event.slug)}
              className="group block h-full rounded-xl border border-line bg-card p-5 transition-colors hover:border-ink-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="tabular text-xs text-ink-3">
                  {formatEventDate(event.startsAt, event.timeZone)} · {formatEventTime(event.startsAt, event.timeZone)}
                </p>
                <AvailabilityBadge slug={event.slug} />
              </div>
              <h2 className="mt-3 font-display text-xl font-semibold tracking-tight group-hover:text-accent">
                {event.name}
              </h2>
              <p className="mt-1.5 text-sm text-pretty text-ink-2">{event.tagline}</p>
              <p className="mt-4 text-sm text-ink-3">
                {event.venue}, {event.city}
              </p>
              <p className="mt-1 text-sm">
                From{" "}
                <span className="tabular font-medium">{formatMoney(lowestAllInPriceMinor(event), event.currency)}</span>{" "}
                <span className="text-ink-3">all in</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
