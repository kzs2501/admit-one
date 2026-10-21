import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CATALOG } from "@/core/catalog";
import { createTestDatabase } from "./testing/database";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.drop());

describe("a fresh server database", () => {
  it("starts from the catalogue's stock: every general tier, with what it had sold before the demo", async () => {
    const rows = await database.db.query.inventory.findMany();
    const general = CATALOG.filter((event) => event.seating.kind === "general").flatMap((event) => event.tiers);
    expect(rows).toHaveLength(general.length);
    for (const tier of general) {
      expect(rows.find((row) => row.tierId === tier.id)).toMatchObject({
        capacity: tier.capacity,
        sold: tier.baselineSold,
        held: 0,
      });
    }
  });

  it("starts with the hall's seats sold before the demo already claimed", async () => {
    const expected = CATALOG.reduce(
      (count, event) => count + (event.seating.kind === "reserved" ? event.seating.baselineSoldSeatIds.size : 0),
      0,
    );
    const [row] = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM seat_claims WHERE status = 'sold' AND released_at IS NULL`,
    );
    expect(row?.count).toBe(expected);
  });

  it("refuses stock that would go past a tier's capacity, whatever the code above it does", async () => {
    await expect(
      database.db.execute(sql`UPDATE inventory SET held = capacity WHERE tier_id = 'fss-general'`),
    ).rejects.toMatchObject({ cause: { constraint_name: "inventory_within_capacity" } });
  });
});
