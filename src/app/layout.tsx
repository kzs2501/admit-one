import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { fontVariables } from "./fonts";
import { Providers } from "./providers";
import { WebVitals } from "./web-vitals";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ChaosPanel } from "@/features/sandbox/components/chaos-panel";
import { SimulatedPhone } from "@/features/sandbox/components/simulated-phone";
import { isServerMode } from "@/lib/backend-mode";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "admit-one — a ticketing checkout, done properly", template: "%s · admit-one" },
  description:
    "A demo event-ticketing checkout with timed holds, a typed step registry, idempotent payments and webhooks — plus a chaos panel to break it on purpose.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1714" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <WebVitals />
        <a
          href="#main"
          className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-ink px-4 py-2 text-sm text-paper focus:translate-y-0"
        >
          Skip to content
        </a>
        <Providers>
          <header className="border-b border-line">
            <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-5 sm:gap-4 sm:px-8">
              <Link href="/" className="font-display text-lg font-semibold tracking-tight">
                admit<span className="text-accent">·</span>one
              </Link>
              <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-3 sm:inline">
                Demo — no real payments
              </span>
              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <Link
                  href="/tickets"
                  className="rounded-md px-1.5 py-1 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline sm:px-2"
                >
                  <span className="sm:hidden">Tickets</span>
                  <span className="hidden sm:inline">Your tickets</span>
                </Link>
              </div>
              {/* The organisers' dashboard and the chaos panel are the sandbox's: server mode has neither. */}
              {!isServerMode && (
                <div className="flex items-center gap-2 sm:gap-3">
                  <Link
                    href="/organiser"
                    className="rounded-md px-1.5 py-1 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline sm:px-2"
                  >
                    <span className="sm:hidden">Organisers</span>
                    <span className="hidden sm:inline">For organisers</span>
                  </Link>
                  {/* The panel lives in the root layout, which no error.tsx covers: contain it here. */}
                  <ErrorBoundary
                    fallback={<span className="text-xs text-ink-3">Chaos panel unavailable — reload to retry</span>}
                  >
                    <ChaosPanel />
                  </ErrorBoundary>
                </div>
              )}
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          {/* Outside main: it stands for the buyer's own phone, not part of the shop's page. */}
          {!isServerMode && (
            <ErrorBoundary fallback={null}>
              <SimulatedPhone />
            </ErrorBoundary>
          )}
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-ink-3 sm:px-8">
              <p>
                All events, venues and people are fictional.{" "}
                {isServerMode ? "The backend runs on a server, on Postgres." : "The backend runs in your browser."}
              </p>
              <p>
                <Link className="underline underline-offset-4 hover:text-ink" href="/scan">
                  Door scanner
                </Link>{" "}
                · Built by{" "}
                <a className="underline underline-offset-4 hover:text-ink" href={SITE.authorUrl}>
                  {SITE.author}
                </a>{" "}
                ·{" "}
                <a className="underline underline-offset-4 hover:text-ink" href={SITE.repoUrl}>
                  Source
                </a>
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
