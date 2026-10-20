/** Opening a story in Storybook's iframe and waiting until it has stopped changing. */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    /** Storybook's preview. Its render phases aren't public API, so this is the one place that reads them. */
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Storybook's own global
    __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } };
  }
}

/** The moment every screenshot is taken at: Sunday 18 October 2026, noon in Bengaluru. */
export const STORY_NOW = new Date("2026-10-18T06:30:00.000Z");

/** What `storybook-static/index.json` lists for each story. */
export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  type: "story" | "docs";
  tags: string[];
}

const DONE_PHASES = ["finished", "errored", "aborted"];

/**
 * Open a story, with the clock fixed, and wait until it's settled:
 * - its play function has finished (Storybook's render phase);
 * - no query or mutation is in flight, for two frames running (the preview's idle probe);
 * - its fonts have loaded.
 */
export async function openStory(page: Page, id: string) {
  await page.clock.setFixedTime(STORY_NOW);
  await page.goto(`/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`);
  await page.waitForFunction(
    (phases) => phases.includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase ?? ""),
    DONE_PHASES,
  );
  const phase = await page.evaluate(() => window.__STORYBOOK_PREVIEW__?.currentRender?.phase);
  if (phase !== "finished") {
    const error = await page.locator("#error-message, #error-stack").allInnerTexts();
    throw new Error(`Story ${id} ended "${phase ?? "unknown"}": ${error.join("\n")}`);
  }
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const isIdle = () => document.documentElement.dataset["storyIdle"] === "true";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(isIdle());
          });
        });
      }),
  );
  await page.evaluate(() => document.fonts.ready);
}

/** axe's WCAG 2.2 AA rules, as the end-to-end tests run them, on the story alone. */
export async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include("#storybook-root")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}
