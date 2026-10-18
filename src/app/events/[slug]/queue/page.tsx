import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CATALOG, findEvent } from "@/core/catalog";
import { WaitingRoom } from "@/features/queue/components/waiting-room";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATALOG.map((event) => ({ slug: event.slug }));
}

export async function generateMetadata({ params }: PageProps<"/events/[slug]/queue">): Promise<Metadata> {
  const event = findEvent((await params).slug);
  return event ? { title: `Queue — ${event.name}`, robots: { index: false } } : {};
}

/** A sale's waiting room. */
export default async function QueuePage({ params }: PageProps<"/events/[slug]/queue">) {
  const event = findEvent((await params).slug);
  if (!event) notFound();
  return <WaitingRoom slug={event.slug} />;
}
