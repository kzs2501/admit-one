// @vitest-environment node
/** A server whose first start fails tries again on the next request, rather than failing for good. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./postgres/db", () => ({ connect: () => ({ db: {} }) }));
vi.mock("./postgres/seed", () => ({ seed: () => Promise.resolve() }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("starting the server API", () => {
  it("doesn't keep a failed start", async () => {
    const { getServerApi } = await import("./server");
    vi.stubEnv("TICKET_KEY_ID", "Not A Key Id");
    await expect(getServerApi()).rejects.toThrow("TICKET_KEY_ID");
    vi.stubEnv("TICKET_KEY_ID", "server-1");
    await expect(getServerApi()).resolves.toHaveProperty("handle");
  });
});
