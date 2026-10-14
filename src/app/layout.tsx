import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { Providers } from "./providers";
import { ChaosPanel } from "@/features/sandbox/components/chaos-panel";
import { site } from "@/lib/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap", preload: false });

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
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="fixed top-3 left-3 z-50 -translate-y-20 rounded-md bg-ink px-4 py-2 text-sm text-paper focus:translate-y-0"
        >
          Skip to content
        </a>
        <Providers>
          <header className="border-b border-line">
            <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-5 sm:px-8">
              <Link href="/" className="font-display text-lg font-semibold tracking-tight">
                admit<span className="text-accent">·</span>one
              </Link>
              <span className="hidden rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-3 sm:inline">
                Demo — no real payments
              </span>
              <div className="ml-auto">
                <ChaosPanel />
              </div>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-ink-3 sm:px-8">
              <p>All events, venues and people are fictional. The backend runs in your browser.</p>
              <p>
                Built by{" "}
                <a className="underline underline-offset-4 hover:text-ink" href={site.authorUrl}>
                  {site.author}
                </a>{" "}
                ·{" "}
                <a className="underline underline-offset-4 hover:text-ink" href={site.repoUrl}>
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
