/**
 * One worker URL per build: the sandbox's mocks only in the sandbox, caching only in a
 * production build. And the app asks the worker to prepare for offline only once the
 * page has loaded, registering it itself only in server mode.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(env: { nodeEnv: string; backend?: string | undefined }) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.nodeEnv);
  vi.stubEnv("NEXT_PUBLIC_BACKEND", env.backend ?? "");
  return import("./service-worker");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the service worker's URL", () => {
  it.each([
    { nodeEnv: "production", backend: undefined, url: "/sw.js?mocking=1&offline=1" },
    { nodeEnv: "production", backend: "server", url: "/sw.js?offline=1" },
    { nodeEnv: "development", backend: undefined, url: "/sw.js?mocking=1" },
    { nodeEnv: "development", backend: "server", url: "/sw.js" },
  ])("$nodeEnv, backend $backend: $url", async ({ url, ...env }) => {
    expect((await load(env)).SERVICE_WORKER_URL).toBe(url);
  });
});

describe("preparing for offline", () => {
  function stubWorker() {
    const postMessage = vi.fn();
    const register = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", {
      serviceWorker: { register, ready: Promise.resolve({ active: { postMessage } }) },
    });
    return { postMessage, register };
  }

  it("waits for the page to load, then asks the worker to cache the wallet", async () => {
    const { prepareOffline } = await load({ nodeEnv: "production" });
    const { postMessage, register } = stubWorker();
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    prepareOffline();
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "admit-one:prepare-offline" }));
    });
    // In the sandbox, MSW's start registers the worker.
    expect(register).not.toHaveBeenCalled();
  });

  it("registers the worker itself in server mode", async () => {
    const { prepareOffline, SERVICE_WORKER_URL } = await load({ nodeEnv: "production", backend: "server" });
    const { postMessage, register } = stubWorker();
    prepareOffline();
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalled();
    });
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { updateViaCache: "none" });
  });

  it("tells the worker which of the build's files the page loaded before it took over", async () => {
    const { keepForOffline } = await load({ nodeEnv: "production" });
    const { postMessage } = stubWorker();
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${location.origin}/_next/static/chunks/reader.js` },
      { name: `${location.origin}/vendor/zxing_reader-1.0.0.wasm` },
      { name: `${location.origin}/api/events` },
      { name: "https://elsewhere.example/_next/static/chunks/x.js" },
    ] as PerformanceEntry[]);
    keepForOffline();
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "admit-one:prepare-offline",
        urls: [`${location.origin}/_next/static/chunks/reader.js`, `${location.origin}/vendor/zxing_reader-1.0.0.wasm`],
      });
    });
  });

  it("does nothing in development, where caching would hide a change", async () => {
    const { prepareOffline } = await load({ nodeEnv: "development" });
    const { postMessage, register } = stubWorker();
    prepareOffline();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(register).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
