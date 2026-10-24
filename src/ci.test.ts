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

describe("the server tests", () => {
  // embedded-postgres registers an exit hook as it's imported, and the hook ends the
  // process with code 0, so a failed run would report success. Its binaries are run by
  // scripts/db.mjs, in a process of its own.
  it("never load embedded-postgres, whose exit hook would turn a failed run into a pass", () => {
    for (const file of ["src/backend/postgres/testing/global-setup.ts", "src/backend/postgres/testing/database.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/from "embedded-postgres"|import\("embedded-postgres"\)/);
    }
  });
});
