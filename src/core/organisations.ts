/**
 * Who runs each event, and who may do what for it. Permissions are checked on both
 * sides of the API: the dashboard hides what an account can't do, and the server
 * refuses it anyway. The UI is a convenience; the server is the authority.
 *
 * All organisations and people are fictional.
 */

/**
 * Each organisation is paid out in one currency and sells every event in it, so its
 * revenue is one sum (the catalogue's tests hold every event to it).
 */
export const ORGANISATIONS = [
  { id: "lakeside-live", name: "Lakeside Live", timeZone: "Asia/Kolkata", currency: "INR" },
  { id: "rangmanch-arts", name: "Rangmanch Arts", timeZone: "Asia/Kolkata", currency: "INR" },
] as const;

export type Organisation = (typeof ORGANISATIONS)[number];
export type OrganisationId = Organisation["id"];

export const PERMISSIONS = ["orders:read", "orders:export", "orders:refund"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["owner", "box-office"] as const;
export type Role = (typeof ROLES)[number];

/** Roles are named sets of permissions; code asks about permissions, never roles. */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ["orders:read", "orders:export", "orders:refund"],
  "box-office": ["orders:read", "orders:export"],
};

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", "box-office": "Box office" };

export interface Account {
  id: string;
  name: string;
  email: string;
  role: Role;
  organisationId: OrganisationId;
}

/** The demo's accounts: signing in means choosing one. A real service would use an identity provider. */
export const DEMO_ACCOUNTS: readonly Account[] = [
  {
    id: "acc-lakeside-owner",
    name: "Nandini Rao",
    email: "nandini@lakeside-live.example",
    role: "owner",
    organisationId: "lakeside-live",
  },
  {
    id: "acc-lakeside-box-office",
    name: "Arjun Mehta",
    email: "arjun@lakeside-live.example",
    role: "box-office",
    organisationId: "lakeside-live",
  },
  {
    id: "acc-rangmanch-owner",
    name: "Farah Iyer",
    email: "farah@rangmanch-arts.example",
    role: "owner",
    organisationId: "rangmanch-arts",
  },
];

export const findAccount = (accountId: string): Account | undefined =>
  DEMO_ACCOUNTS.find((account) => account.id === accountId);

export function getOrganisation(organisationId: OrganisationId): Organisation {
  const organisation = ORGANISATIONS.find((candidate) => candidate.id === organisationId);
  if (!organisation) throw new Error(`Unknown organisation ${organisationId}`);
  return organisation;
}

export const permissionsOf = (account: Account): readonly Permission[] => ROLE_PERMISSIONS[account.role];

/** May this account do this, for this event? Only for its own organisation's events, and only what its role allows. */
export const can = (account: Account, permission: Permission, event: { organiserId: OrganisationId }) =>
  account.organisationId === event.organiserId && ROLE_PERMISSIONS[account.role].includes(permission);
