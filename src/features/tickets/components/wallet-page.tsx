"use client";

import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";
import { routes } from "@/lib/routes";
import { useWallet } from "@/features/tickets/hooks/use-wallet";
import { TicketCard } from "./ticket-card";

/**
 * The tickets kept on this device. It reads only local storage, and the app's service
 * worker keeps the page itself, so it opens with no network at all: at a door in a
 * basement, in airplane mode.
 */
export function WalletPage() {
  const wallet = useWallet();
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Your tickets</h1>
      <p className="mt-2 text-ink-2">
        Kept on this device, so they open without a connection. Turn your screen brightness up at the door.
      </p>
      <div className="mt-8">
        {wallet.kind === "loading" && (
          <div className="flex justify-center py-12">
            <Spinner label="Loading your tickets" className="size-6 text-ink-3" />
          </div>
        )}
        {wallet.kind === "unavailable" && (
          <Notice tone="warn" title="This browser isn’t keeping tickets">
            It may be a private window, or storage is turned off. Your tickets are still on each order’s page.
          </Notice>
        )}
        {wallet.kind === "ready" && wallet.tickets.length === 0 && (
          <Notice title="No tickets on this device yet">
            Tickets you buy here are saved for offline as soon as they’re issued.{" "}
            <Link href={routes.home()} className="underline underline-offset-4">
              Browse events
            </Link>
          </Notice>
        )}
        {wallet.kind === "ready" && wallet.tickets.length > 0 && (
          <ul aria-label="Your tickets" className="space-y-5">
            {wallet.tickets.map((ticket) => (
              <li key={`${ticket.eventSlug}/${ticket.code}`}>
                <TicketCard ticket={ticket} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
