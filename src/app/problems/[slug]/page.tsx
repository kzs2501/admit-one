import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findProblemCodeBySlug,
  PROBLEM_CATALOG,
  PROBLEM_CODES,
  problemPathFor,
  problemSlugFor,
} from "@/contract/problems";
import { routes } from "@/lib/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return PROBLEM_CODES.map((code) => ({ slug: problemSlugFor(code) }));
}

export async function generateMetadata({ params }: PageProps<"/problems/[slug]">): Promise<Metadata> {
  const code = findProblemCodeBySlug((await params).slug);
  return code ? { title: PROBLEM_CATALOG[code].title } : {};
}

/** The documentation a problem's `type` URI dereferences to (RFC 9457 §3.1.1). */
export default async function ProblemTypePage({ params }: PageProps<"/problems/[slug]">) {
  const code = findProblemCodeBySlug((await params).slug);
  if (!code) notFound();
  const { status, title, description } = PROBLEM_CATALOG[code];

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <Link
        href={routes.problems()}
        className="-mx-1 inline-flex min-h-8 items-center px-1 text-sm text-ink-3 hover:text-ink"
      >
        ← All problem types
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight">{title}</h1>
      <dl className="mt-6 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-ink-3">code</dt>
        <dd>
          <code>{code}</code>
        </dd>
        <dt className="text-ink-3">status</dt>
        <dd className="tabular">{status}</dd>
        <dt className="text-ink-3">type</dt>
        <dd>
          <code>{problemPathFor(code)}</code> <span className="text-ink-3">on this site’s origin</span>
        </dd>
      </dl>
      <p className="mt-6 max-w-prose text-pretty">{description}</p>
    </div>
  );
}
