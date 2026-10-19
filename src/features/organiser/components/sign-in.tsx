"use client";

import { DEMO_ACCOUNTS, getOrganisation, permissionsOf, ROLE_LABELS } from "@/core/organisations";
import { Notice } from "@/components/ui/notice";
import { useOrganiserSession } from "@/features/organiser/hooks/use-organiser-session";

const PERMISSION_LABELS = {
  "orders:read": "see orders",
  "orders:export": "export them",
  "orders:refund": "refund them",
} as const;

/** The demo's sign-in: choose who to be. A real dashboard would sign in through an identity provider. */
export function SignIn() {
  const { signIn } = useOrganiserSession();
  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="tabular text-xs tracking-[0.16em] text-ink-3 uppercase">Organisers</p>
      <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Sign in to the dashboard</h1>
      <p className="mt-3 text-ink-2">
        This is a demo, so there’s no password: choose an account. Each one sees only its own organisation’s events, and
        only what its role allows.
      </p>
      {signIn.isError && (
        <div className="mt-6">
          <Notice tone="bad" title="Couldn’t sign in" role="alert">
            {signIn.error.message}
          </Notice>
        </div>
      )}
      <ul className="mt-8 space-y-3">
        {DEMO_ACCOUNTS.map((account) => {
          const organisation = getOrganisation(account.organisationId);
          const allowed = permissionsOf(account).map((permission) => PERMISSION_LABELS[permission]);
          return (
            <li key={account.id}>
              <button
                type="button"
                onClick={() => {
                  signIn.mutate(account.id);
                }}
                disabled={signIn.isPending}
                className="block w-full press rounded-xl border border-line bg-card p-5 text-left hover:border-ink-3 disabled:opacity-60"
              >
                <span className="block font-medium">{account.name}</span>
                <span className="mt-0.5 block text-sm text-ink-2">
                  {ROLE_LABELS[account.role]} at {organisation.name}
                </span>
                <span className="mt-2 block text-sm text-ink-3">Can {allowed.join(", ")}.</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
