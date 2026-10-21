/**
 * The in-browser sandbox: one simulated server per browser tab, persisted to
 * sessionStorage so a refresh resumes exactly where the visitor was.
 *
 * MSW runs request handlers in the page, not in the service worker, so the
 * server's memory is the page's memory. Without persistence a reload would wipe
 * every hold and order — and lose any webhook still waiting to be delivered. With
 * it, the outbox survives the reload and the runtime picks up where it left off.
 */
import { createBackend, type Backend } from "@/backend/backend";
import { createInitialState, deserializeState, SANDBOX_STORAGE_KEY, serializeState } from "@/backend/domain/state";
import { signDemoTicket } from "@/core/demo-ticket-key";

let sandboxInstance: Backend | null = null;

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** 256 random bits, base64url: far beyond guessing (OWASP asks for at least 64 bits of entropy). */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function load() {
  try {
    return deserializeState(sessionStorage.getItem(SANDBOX_STORAGE_KEY));
  } catch {
    return null; // storage blocked: the sandbox just won't survive a reload
  }
}

function save(sandbox: Backend) {
  try {
    sessionStorage.setItem(SANDBOX_STORAGE_KEY, serializeState(sandbox.getState()));
  } catch {
    // Quota or privacy mode — nothing useful to do.
  }
}

/**
 * Keeps time-based behaviour running: delivers webhooks when they're due, and lets
 * the crowd buy tickets while that preset is on.
 */
function startRuntime(sandbox: Backend) {
  let webhookTimer: ReturnType<typeof setTimeout> | undefined;
  let crowdTimer: ReturnType<typeof setInterval> | undefined;
  let crowdIntervalMs = 0;

  const schedule = () => {
    clearTimeout(webhookTimer);
    const dueAtMs = sandbox.nextDeliveryAtMs();
    if (dueAtMs !== null) {
      webhookTimer = setTimeout(() => sandbox.deliverDue(), Math.max(0, dueAtMs - Date.now()));
    }

    // Restart the crowd when it's switched on or off, or its pace changes with the preset.
    const { isCrowdEnabled, crowdIntervalMs: pace } = sandbox.chaos();
    const wanted = isCrowdEnabled ? pace : 0;
    if (wanted !== crowdIntervalMs) {
      clearInterval(crowdTimer);
      crowdTimer = wanted ? setInterval(() => sandbox.runCrowdTick(), wanted) : undefined;
      crowdIntervalMs = wanted;
    }
  };

  sandbox.subscribe(() => {
    save(sandbox);
    schedule();
  });
  schedule(); // resume: deliver anything that came due while the page was closed
}

/** The tab's sandbox, created (and restored) on first use. Browser only. */
export function getSandbox(): Backend {
  if (!sandboxInstance) {
    sandboxInstance = createBackend(
      { now: Date.now, newId, newToken, random: Math.random, signTicket: signDemoTicket },
      load() ?? createInitialState("happy", Date.now()),
    );
    startRuntime(sandboxInstance);
  }
  return sandboxInstance;
}
