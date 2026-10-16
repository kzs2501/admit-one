/**
 * What a monitoring tool should hear about: errors nobody planned for, and Core Web
 * Vitals. Everything goes through these two functions, so connecting Sentry or an
 * analytics endpoint changes this file and nothing else. Until then, errors go to the
 * console and vitals are logged in development.
 */

export interface ErrorContext {
  /** Where the error was caught. */
  source: "route" | "root" | "component" | "query" | "mutation";
  /** Next.js's id for the server-side copy of the error, when there is one. */
  digest?: string | undefined;
  /** React's component stack, from an error boundary. */
  componentStack?: string | null | undefined;
}

export function reportError(error: unknown, context: ErrorContext) {
  console.error(`[${context.source}]`, error, context);
}

export interface WebVital {
  name: string;
  value: number;
  rating: "good" | "needs-improvement" | "poor";
}

export function reportWebVital(metric: WebVital) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[web-vitals] ${metric.name} ${Math.round(metric.value)} (${metric.rating})`);
  }
}
