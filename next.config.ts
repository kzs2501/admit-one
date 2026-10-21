import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

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
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${isWasmAllowed ? " 'wasm-unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
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
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // For browsers that predate `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
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
