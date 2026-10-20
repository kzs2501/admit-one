import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { axeViolations, openStory, type StoryEntry } from "./story";

const INDEX = "storybook-static/index.json";
if (!existsSync(INDEX)) throw new Error(`No ${INDEX}: build the catalogue first (npm run build-storybook).`);

const index = JSON.parse(readFileSync(INDEX, "utf8")) as { entries: Record<string, StoryEntry> };
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story" && !entry.tags.includes("!visual"),
);

/**
 * Every story in the catalogue, screenshotted and checked with axe. The theme and width
 * come from the project (light, dark, mobile).
 */
const isScreen = (story: StoryEntry) => story.tags.includes("screen");
/** Screens with something stuck to the window: a full-page capture would leave it mid-page. */
const isWindowShot = (story: StoryEntry) => story.tags.includes("window");

// Components: clipped to the story.
for (const story of stories.filter((entry) => !isScreen(entry))) {
  test(`${story.title} › ${story.name}`, async ({ page }) => {
    await openStory(page, story.id);
    await expect(page.locator("#storybook-root")).toHaveScreenshot(`${story.id}.png`);
    expect(await axeViolations(page)).toEqual([]);
  });
}

// Whole screens: full-page, and also at 375 px (the mobile project runs only these).
for (const story of stories.filter((entry) => isScreen(entry) && !isWindowShot(entry))) {
  test(`${story.title} › ${story.name}`, { tag: "@screen" }, async ({ page }) => {
    await openStory(page, story.id);
    await expect(page).toHaveScreenshot(`${story.id}.png`, { fullPage: true });
    expect(await axeViolations(page)).toEqual([]);
  });
}

// Screens with a bar stuck to the window: the window, as the visitor sees it.
for (const story of stories.filter((entry) => isScreen(entry) && isWindowShot(entry))) {
  test(`${story.title} › ${story.name}`, { tag: "@screen" }, async ({ page }) => {
    await openStory(page, story.id);
    await expect(page).toHaveScreenshot(`${story.id}.png`);
    expect(await axeViolations(page)).toEqual([]);
  });
}
