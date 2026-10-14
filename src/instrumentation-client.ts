/**
 * Runs in the browser before the app becomes interactive (a Next.js file convention).
 * The demo's backend lives in the browser too: start it here, and make every API
 * request wait until its service worker is answering.
 */
import { startBackend } from "@/backend";
import { setApiReadiness } from "@/lib/api-client";

setApiReadiness(startBackend());
