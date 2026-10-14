import type { Metadata } from "next";
import Link from "next/link";
import { PROBLEM_CATALOG, PROBLEM_CODES } from "@/contract/problems";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "API problem types",
  description: "Every error the admit-one API can return, as RFC 9457 problem details.",
};

/** The index of problem types: where a `type` URI's documentation lives. */
export default function ProblemsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <p className="tabular text-xs tracking-[0.16em] text-ink-3 uppercase">API reference</p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Problem types</h1>
      <p className="mt-4 text-pretty text-ink-2">
        Errors are returned as <code>application/problem+json</code> (RFC 9457). Each has a stable <code>code</code> to
        branch on and a <code>type</code> URI that points here.
      </p>
      <ul className="mt-8 divide-y divide-line rounded-xl border border-line bg-card">
        {PROBLEM_CODES.map((code) => (
          <li key={code}>
            <Link href={routes.problem(code)} className="flex items-baseline justify-between gap-4 p-4 hover:bg-sunk">
              <span>
                <code className="text-sm">{code}</code>
                <span className="ml-3 text-sm text-ink-2">{PROBLEM_CATALOG[code].title}</span>
              </span>
              <span className="tabular text-sm text-ink-3">{PROBLEM_CATALOG[code].status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
