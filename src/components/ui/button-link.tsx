import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/** A link that looks like a secondary button — for navigation that sits beside actions. */
export function ButtonLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 press items-center rounded-lg border border-line bg-card px-5 text-sm font-medium hover:bg-sunk"
    >
      {children}
    </Link>
  );
}
