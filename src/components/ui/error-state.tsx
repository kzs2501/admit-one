import Link from "next/link";
import type { Route } from "next";
import { Notice } from "./notice";

/** A page-level failure: what went wrong, and a way out. */
export function ErrorState({
  title,
  children,
  action = { href: "/", label: "Browse events" },
}: {
  title: string;
  children: string;
  action?: { href: Route; label: string };
}) {
  return (
    <div className="mx-auto max-w-lg px-5 py-16 sm:px-8">
      <Notice tone="bad" title={title} role="alert">
        {children}{" "}
        <Link href={action.href} className="underline underline-offset-4">
          {action.label}
        </Link>
      </Notice>
    </div>
  );
}
