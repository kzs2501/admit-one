// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestBackend, valueOf } from "@/backend/testing/fixtures";
import { findAccount, type Account } from "@/core/organisations";
import { eventFor, eventsFor, SESSION_TTL_MS } from "./access";

const account = (id: string): Account => {
  const found = findAccount(id);
  if (!found) throw new Error(`No demo account ${id}`);
  return found;
};

describe("organiser sessions", () => {
  it("signs in with a token that names the account, until it's signed out", () => {
    const { backend } = createTestBackend();
    const { token, account: signedIn } = valueOf(backend.signIn("acc-lakeside-owner"));
    expect(signedIn).toMatchObject({ name: "Nandini Rao", organisation: { name: "Lakeside Live" } });
    expect(signedIn.permissions).toEqual(["orders:read", "orders:export", "orders:refund"]);
    expect(backend.authenticate(token)?.id).toBe("acc-lakeside-owner");

    backend.signOut(token);
    expect(backend.authenticate(token)).toBeNull();
    expect(backend.authenticate(null)).toBeNull();
    expect(backend.authenticate("token_made_up")).toBeNull();
  });

  it("ends a session after 8 hours, worked out when it's read", () => {
    const { backend, clock } = createTestBackend();
    const { token } = valueOf(backend.signIn("acc-lakeside-box-office"));
    clock.advance(SESSION_TTL_MS - 1);
    expect(backend.authenticate(token)).not.toBeNull();
    clock.advance(1);
    expect(backend.authenticate(token)).toBeNull();
    expect(backend.getState().sessions[token]).toBeDefined(); // the read didn't write

    valueOf(backend.signIn("acc-rangmanch-owner"));
    expect(backend.getState().sessions[token]).toBeUndefined(); // the next sign-in dropped it
  });

  it("refuses an account that doesn't exist", () => {
    const { backend } = createTestBackend();
    expect(backend.signIn("acc-nobody")).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("event access", () => {
  it("lists only the account's own organisation's events", () => {
    expect(eventsFor(account("acc-lakeside-owner")).map((event) => event.slug)).toEqual([
      "frontend-systems-summit",
      "night-market-jazz",
      "lakeside-lights",
    ]);
    expect(eventsFor(account("acc-rangmanch-owner")).map((event) => event.slug)).toEqual([
      "open-studio-ceramics",
      "monsoon-strings",
    ]);
  });

  it("forbids another organiser's event, and a permission the role lacks, but hides nothing that's public", () => {
    expect(eventFor(account("acc-lakeside-owner"), "lakeside-lights", "orders:refund").ok).toBe(true);
    expect(eventFor(account("acc-lakeside-owner"), "monsoon-strings")).toMatchObject({
      error: { code: "forbidden", detail: "This event belongs to another organiser." },
    });
    expect(eventFor(account("acc-lakeside-box-office"), "lakeside-lights", "orders:refund")).toMatchObject({
      error: { code: "forbidden", detail: "Your role doesn’t allow that for this event." },
    });
    expect(eventFor(account("acc-lakeside-owner"), "no-such-event")).toMatchObject({ error: { code: "not_found" } });
  });

  it("describes each event with what the account may do for it", () => {
    const { backend } = createTestBackend();
    const [summit] = backend.listOrganiserEvents(account("acc-lakeside-box-office"));
    expect(summit).toMatchObject({ slug: "frontend-systems-summit", permissions: ["orders:read", "orders:export"] });
  });
});
