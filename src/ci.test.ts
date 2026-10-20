// @vitest-environment node
/** The CI workflow agrees with the code it checks. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const { version } = JSON.parse(readFileSync("node_modules/@playwright/test/package.json", "utf8")) as {
  version: string;
};

describe("the visual job", () => {
  // A bump to @playwright/test that left the image behind would compare screenshots
  // from one Chromium against baselines made by another.
  it("runs in the image of the installed Playwright", () => {
    expect(workflow).toContain(`image: mcr.microsoft.com/playwright:v${version}-noble`);
  });

  it("runs on arm64, where the baselines are made", () => {
    expect(workflow).toMatch(/visual:\n(?:.*\n)*?\s+runs-on: ubuntu-24\.04-arm\n/);
  });
});
