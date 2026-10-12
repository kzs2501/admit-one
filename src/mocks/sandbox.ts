/**
 * The in-browser sandbox: one simulated server per browser tab, persisted to
 * sessionStorage so a refresh resumes exactly where the visitor was.
 *
 * MSW runs request handlers in the page, not in the service worker, so the
 * server's memory is the page's memory. Without persistence a reload would wipe
 * every hold and order — and lose any webhook still waiting to be delivered. With
 * it, the outbox survives the reload and the runtime picks up where it left off.
 */
import { createServer, type Server } from "@/server/server";
import { deserialize, initialState, serialize } from "@/server/state";

const STORAGE_KEY = "admit-one:sandbox:v1";
const CROWD_INTERVAL_MS = 6000;

let server: Server | null = null;

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

function load() {
  try {
    return deserialize(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // storage blocked: the sandbox just won't survive a reload
  }
}

function save(s: Server) {
  try {
    sessionStorage.setItem(STORAGE_KEY, serialize(s.getState()));
  } catch {
    // Quota or privacy mode — nothing useful to do.
  }
}

/**
 * Keeps time-based behaviour running: delivers webhooks when they're due, and lets
 * the crowd buy tickets while that preset is on.
 */
function startRuntime(s: Server) {
  let webhookTimer: ReturnType<typeof setTimeout> | undefined;
  let crowdTimer: ReturnType<typeof setInterval> | undefined;

  const schedule = () => {
    clearTimeout(webhookTimer);
    const at = s.nextDeliveryAt();
    if (at !== null) webhookTimer = setTimeout(() => s.deliverDue(), Math.max(0, at - Date.now()));

    if (s.chaos().crowd && !crowdTimer) crowdTimer = setInterval(() => s.crowdTick(), CROWD_INTERVAL_MS);
    if (!s.chaos().crowd && crowdTimer) {
      clearInterval(crowdTimer);
      crowdTimer = undefined;
    }
  };

  s.subscribe(() => {
    save(s);
    schedule();
  });
  schedule(); // resume: deliver anything that came due while the page was closed
}

/** The tab's simulated server, created (and restored) on first use. Browser only. */
export function getServer(): Server {
  if (!server) {
    server = createServer({ now: Date.now, newId, random: Math.random }, load() ?? initialState());
    startRuntime(server);
  }
  return server;
}
