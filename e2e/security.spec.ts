/**
 * The security headers are served, the Content Security Policy is enforced, and
 * nothing a buyer does trips it.
 */
import type { Page } from "@playwright/test";
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
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
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
