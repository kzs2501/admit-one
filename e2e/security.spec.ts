/**
 * The security headers are served, the Content Security Policy is enforced, and
 * nothing a buyer does trips it.
 */
import { expect, test } from "./fixtures";

test("security headers are served, and a whole purchase stays within the content security policy", async ({
  page,
  buyer,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      violations.push(message.text());
    }
  });

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
});
