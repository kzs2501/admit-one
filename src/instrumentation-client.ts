/**
 * Runs in the browser before the app becomes interactive (a Next.js file convention).
 * The demo's backend lives in the browser too: start it here, and make every API
 * request wait until its service worker is answering. Then, once the page has loaded,
 * get the service worker ready to open the wallet offline.
 */
import { startBackend } from "@/backend";
import { setApiReadiness } from "@/lib/api-client";
import { isServerMode } from "@/lib/backend-mode";
import { prepareOffline, SERVICE_WORKER_OPTIONS, SERVICE_WORKER_URL } from "@/lib/service-worker";

// In server mode the API is the server's, ready as soon as the page is.
setApiReadiness(
  isServerMode ? Promise.resolve() : startBackend({ url: SERVICE_WORKER_URL, options: SERVICE_WORKER_OPTIONS }),
);
prepareOffline();
