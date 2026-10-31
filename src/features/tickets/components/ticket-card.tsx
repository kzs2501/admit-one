import { QrCode } from "@/components/ui/qr-code";
import { formatEventDate, formatEventTime } from "@/lib/format";
import type { WalletTicket } from "@/lib/wallet";

/** A ticket as the door needs it: who, where, and the signed code to scan. */
export function TicketCard({ ticket }: { ticket: WalletTicket }) {
  return (
    <article
      aria-label={`Ticket for ${ticket.attendeeName}, ${ticket.eventName}`}
      className="overflow-hidden rounded-xl border-4 border-double border-line bg-card"
    >
      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="tabular text-[11px] tracking-[0.16em] text-ink-3 uppercase">Admit one</p>
          <h3 className="mt-1 font-display text-lg font-semibold">{ticket.eventName}</h3>
          <p className="mt-1 text-sm text-ink-2">
            {formatEventDate(ticket.startsAt, ticket.timeZone)} · {formatEventTime(ticket.startsAt, ticket.timeZone)}
          </p>
          <p className="text-sm text-ink-2">
            {ticket.venue}, {ticket.city}
          </p>
          {ticket.seat && <p className="mt-3 font-medium">{ticket.seat}</p>}
          <p className={`${ticket.seat ? "mt-1" : "mt-3"} text-sm text-ink-2`}>
            {ticket.attendeeName} · {ticket.tierName}
          </p>
        </div>
        {ticket.isRefunded ? (
          <p className="justify-self-center rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm font-medium sm:max-w-40">
            Refunded: this ticket no longer gets anyone in.
          </p>
        ) : (
          <QrCode
            value={ticket.token}
            label={`Code to scan at the door, for ${ticket.attendeeName}`}
            className="size-44 justify-self-center sm:size-40"
          />
        )}
      </div>
      <div className="perforation mx-5" aria-hidden="true" />
      <div className="flex items-center justify-between gap-4 p-5">
        <span className="text-sm text-ink-3">Ticket code</span>
        <span className="tabular text-lg font-medium tracking-[0.2em]">{ticket.code}</span>
      </div>
    </article>
  );
}
