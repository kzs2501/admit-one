// @vitest-environment node
/**
 * Every colour that's read against another, in both themes, measured from globals.css
 * itself: WCAG 2.2's ratio (what an audit checks) and APCA's Lc (stricter in the dark).
 * A token change that loses contrast fails here, before any screenshot does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apcaContrast, oklchToSrgb, wcagRatio, type Oklch } from "@/lib/contrast";

const css = readFileSync("src/app/globals.css", "utf8");

function tokensIn(block: string): Map<string, Oklch> {
  const tokens = new Map<string, Oklch>();
  for (const [, name = "", l = "", c = "", h = ""] of block.matchAll(
    /--([\w-]+): oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/g,
  )) {
    tokens.set(name, [Number(l), Number(c), Number(h)]);
  }
  return tokens;
}

const light = tokensIn(css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = tokensIn(css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@theme inline")));

/** How strict a pair is, by what the foreground is. */
const NEEDS = {
  /** Running text: paragraphs, labels people read. */
  body: { wcag: 4.5, apca: 75 },
  /** Small but secondary text, links and status words; and text on a coloured fill. */
  text: { wcag: 4.5, apca: 60 },
  /** Shapes that carry meaning (a seat's tick, its edge): WCAG's 3:1 for graphics. */
  graphic: { wcag: 3, apca: 0 },
} as const;

const PAIRS: [foreground: string, background: string, need: keyof typeof NEEDS][] = [
  ...["paper", "card", "sunk", "accent-soft", "ok-soft", "warn-soft", "bad-soft"].map(
    (background) => ["ink", background, "body"] as [string, string, "body"],
  ),
  ["ink-2", "paper", "body"],
  ["ink-2", "card", "body"],
  ...["paper", "card", "sunk"].map((background) => ["ink-3", background, "text"] as [string, string, "text"]),
  ...["accent", "ok", "warn", "bad"].flatMap((foreground) =>
    ["paper", "card"].map((background) => [foreground, background, "text"] as [string, string, "text"]),
  ),
  ["accent-ink", "accent", "text"],
  ["accent-ink", "accent-hover", "text"],
  ["action-ink", "action", "text"],
  ["action-ink", "action-hover", "text"],
  ["tier-ink", "tier-1", "text"],
  ["tier-ink", "tier-2", "text"],
  ["tier-ink", "tier-3", "text"],
  ["chosen-ink", "chosen", "graphic"],
  ["chosen", "card", "graphic"],
  ["ink-3", "card", "graphic"],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("the %s theme", (_, tokens) => {
  it("defines every token it's checked for", () => {
    const missing = PAIRS.flatMap(([foreground, background]) => [foreground, background]).filter(
      (name) => !tokens.has(name),
    );
    expect(missing).toEqual([]);
  });

  it.each(PAIRS)("%s on %s is readable as %s", (foreground, background, need) => {
    const text = oklchToSrgb(tokens.get(foreground) ?? [0, 0, 0]);
    const ground = oklchToSrgb(tokens.get(background) ?? [0, 0, 0]);
    expect(wcagRatio(text, ground)).toBeGreaterThanOrEqual(NEEDS[need].wcag);
    expect(apcaContrast(text, ground)).toBeGreaterThanOrEqual(NEEDS[need].apca);
  });
});
