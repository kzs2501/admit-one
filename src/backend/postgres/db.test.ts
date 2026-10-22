/**
 * The safety net for locks: a transaction Postgres aborted to break a deadlock, or a
 * serialisation conflict, is run again; anything else isn't, and neither is a fourth try.
 */
import { describe, expect, it } from "vitest";
import { withRetries } from "./db";

const failure = (code: string) => Object.assign(new Error(code), { code });
/** As Drizzle throws it: the driver's error as the cause. */
const wrapped = (code: string) => Object.assign(new Error("Failed query"), { cause: failure(code) });

describe("running a transaction again", () => {
  it("retries a deadlock or a serialisation failure, and returns what the retry did", async () => {
    for (const code of ["40P01", "40001"]) {
      let calls = 0;
      const result = await withRetries(() => {
        calls += 1;
        return calls < 3 ? Promise.reject(wrapped(code)) : Promise.resolve("done");
      });
      expect([result, calls]).toEqual(["done", 3]);
    }
  });

  it("gives up after three tries in all", async () => {
    let calls = 0;
    await expect(
      withRetries(() => {
        calls += 1;
        return Promise.reject(wrapped("40P01"));
      }),
    ).rejects.toThrow("Failed query");
    expect(calls).toBe(3);
  });

  it("doesn't retry anything else", async () => {
    let calls = 0;
    await expect(
      withRetries(() => {
        calls += 1;
        return Promise.reject(failure("23505"));
      }),
    ).rejects.toThrow("23505");
    expect(calls).toBe(1);
  });
});
