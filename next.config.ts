import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Server mode taking payment through Razorpay (its keys are set for the build): its
 * Checkout is a third party's script, framed pages and calls, so the policy names
 * Razorpay's origins — on every page, because the checkout is reached without a
 * document load (from the event page, step to step), and a document keeps the policy
 * it was loaded with. Those origins serve only Razorpay's code, and its script is
 * loaded only when a buyer presses Pay. Bank pages open in a popup that reports back
 * to Checkout, so its opener is kept (ADR 020).
 */
const razorpayCheckoutUrl = new URL(
  process.env["NEXT_PUBLIC_RAZORPAY_CHECKOUT_URL"] ?? "https://checkout.razorpay.com/v1/checkout.js",
);
const isRazorpayBuild = process.env["NEXT_PUBLIC_BACKEND"] === "server" && Boolean(process.env["RAZORPAY_KEY_ID"]);
const RAZORPAY_SOURCES = isRazorpayBuild
  ? {
      script: [razorpayCheckoutUrl.origin],
      frame: [razorpayCheckoutUrl.origin, "https://api.razorpay.com"],
      connect: [razorpayCheckoutUrl.origin, "https://api.razorpay.com", "https://lumberjack.razorpay.com"],
      img: ["https://cdn.razorpay.com"],
    }
  : { script: [], frame: [], connect: [], img: [] };
const sources = (list: readonly string[]) => list.map((source) => ` ${source}`).join("");

/**
 * A Content Security Policy without nonces — Next.js's "Without Nonces" recipe, since
 * nonces would force every page to render dynamically. Next's inline bootstrap scripts
 * need 'unsafe-inline'; the rest of the policy does the work: no foreign scripts,
 * connections, plugins, form targets or framing. See ADR 009.
 *
 * The door scanner alone may compile WebAssembly ('wasm-unsafe-eval', for its QR
 * reader where the browser has none) and use the camera. Every other page keeps both
 * off (ADR 019).
 */
const contentSecurityPolicy = ({ isWasmAllowed }: { isWasmAllowed: boolean }) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${isWasmAllowed ? " 'wasm-unsafe-eval'" : ""}${sources(RAZORPAY_SOURCES.script)}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${sources(RAZORPAY_SOURCES.img)}`,
    "font-src 'self'",
    `connect-src 'self'${sources(RAZORPAY_SOURCES.connect)}`,
    ...(RAZORPAY_SOURCES.frame.length ? [`frame-src 'self'${sources(RAZORPAY_SOURCES.frame)}`] : []),
    // The simulated backend runs in a service worker.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

const permissionsPolicy = ({ isCameraAllowed }: { isCameraAllowed: boolean }) =>
  `camera=${isCameraAllowed ? "(self)" : "()"}, microphone=(), geolocation=(), browsing-topics=()`;

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy({ isWasmAllowed: false }) },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: permissionsPolicy({ isCameraAllowed: false }) },
  { key: "Cross-Origin-Opener-Policy", value: isRazorpayBuild ? "same-origin-allow-popups" : "same-origin" },
  // For browsers that predate `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
  // HTTPS only, for two years, subdomains included. Vercel sends this too; saying it
  // here keeps it on any host. Browsers ignore it over plain http, so localhost is fine.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** Later rules win for the same header, so these replace the two above on the scanner. */
const SCANNER_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy({ isWasmAllowed: true }) },
  { key: "Permissions-Policy", value: permissionsPolicy({ isCameraAllowed: true }) },
];

const nextConfig: NextConfig = {
  // A server-mode build goes to its own directory, so it never overwrites the default one.
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  // Check every literal href against the real routes at build time.
  typedRoutes: true,
  poweredByHeader: false,
  // Nothing here uses next/image, so the image optimiser is off: a server endpoint that
  // fetches and transforms images is one more thing to attack (GHSA-2464-fhr4-w9xw).
  images: { unoptimized: true },
  headers: () =>
    Promise.resolve([
      { source: "/(.*)", headers: SECURITY_HEADERS },
      { source: "/scan", headers: SCANNER_HEADERS },
      // Named by version, so a new one has a new name (scripts/copy-zxing-wasm.mjs).
      {
        source: "/vendor/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // The service worker and the MSW script it imports are checked on every load, so a
      // deploy reaches them at once (ADR 019).
      ...["/sw.js", "/mockServiceWorker.js"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      })),
    ]),
};

export default nextConfig;
