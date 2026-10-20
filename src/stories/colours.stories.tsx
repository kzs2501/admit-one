import type { Meta, StoryObj } from "@storybook/nextjs-vite";

/** The colour tokens, as Tailwind classes. Light is the base; dark follows the OS. */
const SURFACES = [
  { name: "paper", className: "bg-paper", use: "The page" },
  { name: "card", className: "bg-card", use: "Raised surfaces: cards, panels, dialogs" },
  { name: "sunk", className: "bg-sunk", use: "Recessed surfaces: wells, hovered rows" },
  { name: "line", className: "bg-line", use: "Borders and dividers" },
  { name: "accent", className: "bg-accent", use: "The primary action, and nothing decorative" },
  { name: "accent-soft", className: "bg-accent-soft", use: "Selected seats, highlights" },
  { name: "ok-soft", className: "bg-ok-soft", use: "Success notices" },
  { name: "warn-soft", className: "bg-warn-soft", use: "Warnings" },
  { name: "bad-soft", className: "bg-bad-soft", use: "Errors" },
] as const;

/**
 * Every text colour on every surface the UI puts it on. Each pairing must meet WCAG's
 * 4.5:1, and the accessibility checks (axe's colour-contrast rule) run on this story in
 * both themes, so a token change that breaks one fails a test.
 */
const PAIRINGS = [
  {
    surface: "bg-paper",
    texts: ["text-ink", "text-ink-2", "text-ink-3", "text-accent", "text-ok", "text-warn", "text-bad"],
  },
  {
    surface: "bg-card",
    texts: ["text-ink", "text-ink-2", "text-ink-3", "text-accent", "text-ok", "text-warn", "text-bad"],
  },
  { surface: "bg-sunk", texts: ["text-ink", "text-ink-2", "text-ink-3"] },
  { surface: "bg-accent", texts: ["text-accent-ink"] },
  { surface: "bg-ok-soft", texts: ["text-ink", "text-ink-2"] },
  { surface: "bg-warn-soft", texts: ["text-ink", "text-ink-2"] },
  { surface: "bg-bad-soft", texts: ["text-ink", "text-ink-2"] },
] as const;

function Colours() {
  return (
    <div className="max-w-4xl space-y-10 p-8">
      <section aria-labelledby="surfaces">
        <h2 id="surfaces" className="font-display text-2xl font-semibold tracking-tight">
          Surfaces
        </h2>
        <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-4">
          {SURFACES.map((token) => (
            <li key={token.name} className="overflow-hidden rounded-lg border border-line bg-card">
              <div className={`h-16 ${token.className}`} />
              <div className="p-3 text-sm">
                <p className="tabular font-medium">{token.name}</p>
                <p className="text-ink-2">{token.use}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="pairings">
        <h2 id="pairings" className="font-display text-2xl font-semibold tracking-tight">
          Text on surfaces
        </h2>
        <ul className="mt-4 space-y-3">
          {PAIRINGS.map(({ surface, texts }) => (
            <li key={surface} className={`flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-line p-4 ${surface}`}>
              {texts.map((text) => (
                <span key={text} className={`tabular text-sm ${text}`}>
                  {text.replace("text-", "")} on {surface.replace("bg-", "")}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const meta = { title: "Foundations/Colour", component: Colours, parameters: { layout: "fullscreen" } } satisfies Meta<
  typeof Colours
>;

export default meta;

export const Tokens: StoryObj<typeof meta> = {};
