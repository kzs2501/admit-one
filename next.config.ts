import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * A Content Security Policy without nonces — Next.js's "Without Nonces" recipe, since
 * nonces would force every page to render dynamically. Next's inline bootstrap scripts
 * need 'unsafe-inline'; the rest of the policy does the work: no foreign scripts,
 * connections, plugins, form targets or framing. See ADR 009.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
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

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // For browsers that predate `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // Check every literal href against the real routes at build time.
  typedRoutes: true,
  poweredByHeader: false,
  headers: () => Promise.resolve([{ source: "/(.*)", headers: SECURITY_HEADERS }]),
};

export default nextConfig;
