import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button-link";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-5 py-16 text-center sm:px-8">
      <p className="tabular text-xs tracking-[0.16em] text-ink-3 uppercase">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">That page doesn’t exist</h1>
      <p className="mt-3 text-ink-2">The link may be old, or the event may have finished.</p>
      <div className="mt-6 flex justify-center">
        <ButtonLink href={routes.home()}>Browse events</ButtonLink>
      </div>
    </div>
  );
}
