/**
 * Runs in the browser before the app becomes interactive (a Next.js file convention).
 * The demo's backend lives in the browser too: start it here, and make every API
 * request wait until its service worker is answering.
 */
import { startBackend } from "@/backend";
import { setApiReadiness } from "@/lib/api-client";
import { isServerMode } from "@/lib/backend-mode";

// In server mode the API is the server's, ready as soon as the page is.
setApiReadiness(isServerMode ? Promise.resolve() : startBackend());
