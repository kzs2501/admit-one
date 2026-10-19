// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  can,
  DEMO_ACCOUNTS,
  findAccount,
  getOrganisation,
  PERMISSIONS,
  permissionsOf,
  type Account,
  type Permission,
} from "./organisations";

const account = (id: string): Account => {
  const found = findAccount(id);
  if (!found) throw new Error(`No demo account ${id}`);
  return found;
};

const lakesideEvent = { organiserId: "lakeside-live" } as const;
const rangmanchEvent = { organiserId: "rangmanch-arts" } as const;

describe("permissions", () => {
  it.each<[string, Permission, boolean, boolean]>([
    // account, permission, on its own organisation's event, on another's
    ["acc-lakeside-owner", "orders:read", true, false],
    ["acc-lakeside-owner", "orders:export", true, false],
    ["acc-lakeside-owner", "orders:refund", true, false],
    ["acc-lakeside-box-office", "orders:read", true, false],
    ["acc-lakeside-box-office", "orders:export", true, false],
    ["acc-lakeside-box-office", "orders:refund", false, false],
  ])("%s may %s: on its own events %s, on another organiser's %s", (id, permission, isOwnAllowed, isOtherAllowed) => {
    expect(can(account(id), permission, lakesideEvent)).toBe(isOwnAllowed);
    expect(can(account(id), permission, rangmanchEvent)).toBe(isOtherAllowed);
  });

  it("gives an owner every permission, and checks permissions, never roles", () => {
    expect(permissionsOf(account("acc-rangmanch-owner"))).toEqual(PERMISSIONS);
    expect(can(account("acc-rangmanch-owner"), "orders:refund", rangmanchEvent)).toBe(true);
    expect(can(account("acc-rangmanch-owner"), "orders:read", lakesideEvent)).toBe(false);
  });

  it("knows every demo account's organisation", () => {
    for (const { organisationId } of DEMO_ACCOUNTS) expect(getOrganisation(organisationId).id).toBe(organisationId);
    expect(findAccount("acc-nobody")).toBeUndefined();
    expect(() => getOrganisation("nobody" as Account["organisationId"])).toThrow("Unknown organisation nobody");
  });
});
