/**
 * Runs in the browser before the app becomes interactive (a Next.js file convention).
 * The demo's backend lives in the browser too: start it here, just after the page first
 * paints, and make every API request wait until its service worker is answering. Then,
 * once the page has loaded, get the service worker ready to open the wallet offline.
 *
 * Why after the first paint: the backend is the biggest code the sandbox loads (MSW and
 * the domain, about 120 KB). Started earlier, it competes with the paint on a slow
 * phone, and Lighthouse's simulation charges all of it to the largest paint: on a slow
 * CI runner the seat map's event page fell from 0.93 to 0.82. Nothing needs the API
 * before the page is on screen; the server-rendered text is.
 */
import { restartBackend, startBackend } from "@/backend";
import { afterFirstPaint } from "@/lib/after-first-paint";
import { setApiReadiness, setApiRecovery } from "@/lib/api-client";
import { isServerMode } from "@/lib/backend-mode";
import { prepareOffline, SERVICE_WORKER_OPTIONS, SERVICE_WORKER_URL } from "@/lib/service-worker";

// In server mode the API is the server's, ready as soon as the page is.
const worker = { url: SERVICE_WORKER_URL, options: SERVICE_WORKER_OPTIONS };
setApiReadiness(isServerMode ? Promise.resolve() : afterFirstPaint().then(() => startBackend(worker)));
// The browser may stop the backend's service worker; when an answer says so, start it again.
if (!isServerMode) setApiRecovery(() => restartBackend(worker));
prepareOffline();
