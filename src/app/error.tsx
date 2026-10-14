"use client"; // error boundaries must be client components

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { routes } from "@/lib/routes";

/**
 * The route-level error boundary: something in a page threw while rendering. Say so
 * plainly, offer a retry, and log the error where a monitoring tool would pick it up.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-ink-2">
        This page hit an unexpected error. Your reservation, if you have one, is unaffected.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={retry}>Try again</Button>
        <ButtonLink href={routes.home()}>Browse events</ButtonLink>
      </div>
    </div>
  );
}
