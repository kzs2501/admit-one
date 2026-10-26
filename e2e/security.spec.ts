/**
 * The security headers are served, the Content Security Policy is enforced, and
 * nothing a buyer does trips it.
 */
import type { Page } from "@playwright/test";
import { STUDIO, withoutNativeDetector } from "./door";
import { expect, test } from "./fixtures";

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>;
  }
}

/**
 * Every policy violation on any page this test opens. Listens for the browser's
 * `securitypolicyviolation` events rather than console errors: a blocked call that the
 * page catches (a library probing for eval, say) is still a violation, but logs nothing.
 */
async function collectViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation?.(
        `${event.effectiveDirective} blocked ${event.blockedURI} in ${event.sourceFile}`,
      );
    });
  });
  return violations;
}

test(
  "security headers are served, and a whole purchase stays within the content security policy",
  { tag: "@both" },
  async ({ page, buyer }) => {
    const violations = await collectViolations(page);

    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    // No third party is let in unless Razorpay is the provider (e2e/razorpay.spec.ts).
    expect(headers["content-security-policy"]).not.toContain("razorpay");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
    expect(headers).not.toHaveProperty("x-powered-by");

    await buyer.goToPayment();
    await buyer.pay();
    await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });
    await page.goto("/problems/sold-out");
    await expect(page.getByRole("heading", { name: "Not enough tickets left" })).toBeVisible();
    expect(violations).toEqual([]);

    // Enforced, not just declared: the browser itself refuses a connection to another
    // origin. (A failed fetch alone proves nothing — CORS or no network would fail it too.)
    const violatedDirective = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          document.addEventListener(
            "securitypolicyviolation",
            (event) => {
              resolve(event.effectiveDirective);
            },
            { once: true },
          );
          void fetch("https://example.com", { mode: "no-cors" }).catch(() => undefined);
        }),
    );
    expect(violatedDirective).toBe("connect-src");
  },
);

test("the wallet, the door and the dashboard stay within their policies too", async ({ page, buyer, organiser }) => {
  // The door reads with its WebAssembly reader, as in Safari and Firefox: the one thing
  // only its own, looser policy allows.
  await withoutNativeDetector(page);
  const violations = await collectViolations(page);
  await page.goto("/");
  await buyer.goToPayment(1);
  await buyer.pay();
  await expect(buyer.ticketsHeading).toBeVisible({ timeout: 10_000 });

  await page.goto("/tickets");
  const code = page.getByRole("img", { name: "Code to scan at the door, for Guest 1" });
  const photo = { name: "ticket.png", mimeType: "image/png", buffer: await code.screenshot() };

  await page.goto("/scan");
  await page.getByLabel("Event at this door").selectOption({ label: STUDIO.name });
  const photoInput = page.getByLabel("Or scan a photo of a ticket");
  await expect(photoInput).toBeEnabled();
  await photoInput.setInputFiles(photo);
  await expect(page.getByRole("status", { name: "Last scan" })).toContainText("Admitted");

  // The dashboard: its live stream, its charts and the virtualised table.
  await organiser.signInAs(/Nandini Rao/);
  await expect(organiser.liveStatus).toHaveText("Live");
  await organiser.openOrders();
  await expect(page.getByRole("table")).toBeVisible();
  expect(violations).toEqual([]);
});

test(
  "the image optimiser is off: nothing uses it, so it isn't there to attack",
  { tag: "@both" },
  async ({ request }) => {
    expect((await request.get("/icons/icon-192.png")).status()).toBe(200);
    // GHSA-2464-fhr4-w9xw was in this endpoint. The app has no use for it.
    expect((await request.get("/_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75")).status()).toBe(404);
  },
);
