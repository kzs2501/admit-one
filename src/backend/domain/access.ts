/**
 * Organiser access. Signing in as a demo account issues a random bearer token, valid
 * for 8 hours — worked out when it's read, like a hold's expiry — or until signing
 * out. What an account may then see or do is `can()` from core, the same rule the
 * dashboard uses to decide what to show.
 */
import { CATALOG, findEvent, type EventInfo } from "@/core/catalog";
import { can, findAccount, type Account, type Permission } from "@/core/organisations";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";

export const SESSION_TTL_MS = 8 * 60 * 60_000;

export function signIn(context: BackendContext, accountId: string): Result<{ token: string; account: Account }> {
  const account = findAccount(accountId);
  if (!account) return fail({ code: "invalid_request", detail: "There’s no demo account with that id." });
  const nowMs = context.deps.now();
  const token = context.deps.newToken();
  // Signing in is also when expired sessions are dropped, so the store can't grow forever.
  const live = Object.entries(context.state.sessions).filter(([, session]) => nowMs < session.expiresAtMs);
  context.state.sessions = Object.fromEntries([...live, [token, { accountId, expiresAtMs: nowMs + SESSION_TTL_MS }]]);
  context.log("auth", `${account.name} signed in.`);
  return ok({ token, account });
}

/** The account a token belongs to, if it's a live session. */
export function authenticate(context: BackendContext, token: string | null): Account | null {
  const session = token === null ? undefined : context.state.sessions[token];
  if (!session || context.deps.now() >= session.expiresAtMs) return null;
  return findAccount(session.accountId) ?? null;
}

export function signOut(context: BackendContext, token: string) {
  const account = authenticate(context, token);
  context.state.sessions = Object.fromEntries(Object.entries(context.state.sessions).filter(([key]) => key !== token));
  if (account) context.log("auth", `${account.name} signed out.`);
}

/** The events whose orders an account may see. */
export const eventsFor = (account: Account) => CATALOG.filter((event) => can(account, "orders:read", event));

/**
 * An event, if this account may do this for it. Events are public, so one that isn't
 * the account's is `forbidden`, not hidden; an event that doesn't exist is `not_found`.
 */
export function eventFor(account: Account, slug: string, permission: Permission = "orders:read"): Result<EventInfo> {
  const event = findEvent(slug);
  if (!event) return fail({ code: "not_found", detail: "No such event." });
  if (!can(account, permission, event)) {
    return fail({
      code: "forbidden",
      detail:
        event.organiserId === account.organisationId
          ? "Your role doesn’t allow that for this event."
          : "This event belongs to another organiser.",
    });
  }
  return ok(event);
}
