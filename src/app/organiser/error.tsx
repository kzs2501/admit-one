"use client"; // error boundaries must be client components

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { reportError } from "@/lib/monitoring";
import { routes } from "@/lib/routes";

/** The organisers' own error boundary: a fault in the dashboard keeps you in the dashboard. */
export default function OrganiserError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { source: "route", digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">The dashboard hit a problem</h1>
      <p className="mt-3 text-ink-2">Nothing was changed. Try again, or go back to the overview.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={retry}>Try again</Button>
        <ButtonLink href={routes.organiser()}>Overview</ButtonLink>
      </div>
    </div>
  );
}
