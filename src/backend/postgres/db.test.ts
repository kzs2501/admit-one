/**
 * The safety net for locks: a transaction Postgres aborted to break a deadlock, or a
 * serialisation conflict, is run again; anything else isn't, and neither is a fourth try.
 */
import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describeError, withRetries } from "./db";

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

describe("describing a failure for the log", () => {
  it("says which query failed and why, but not the buyer's details in it", () => {
    // As Postgres reports a unique violation, and Drizzle wraps it with the query's params.
    const violation = Object.assign(
      new Error('duplicate key value violates unique constraint "orders_hold_id_unique"'),
      {
        name: "PostgresError",
        code: "23505",
        constraint_name: "orders_hold_id_unique",
        table_name: "orders",
        detail: "Key (hold_id)=(hold_1) already exists.",
      },
    );
    const error = new DrizzleQueryError(
      'insert into "orders" ("id", "attendees") values ($1, $2)',
      ["ord_1", '[{"name":"Asha Rao","email":"asha@example.com"}]'],
      violation,
    );

    const said = describeError(error);
    expect(said).toContain("code 23505");
    expect(said).toContain("constraint orders_hold_id_unique");
    expect(said).toContain("table orders");
    expect(said).not.toMatch(/asha|Asha Rao|hold_1/);
  });

  it("keeps a bug's message and stack, which fixing it needs", () => {
    const said = describeError(new TypeError("Cannot read properties of undefined (reading 'items')"));
    expect(said).toContain("TypeError: Cannot read properties of undefined (reading 'items')");
    expect(said).toContain("db.test.ts");
  });
});
