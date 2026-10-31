/**
 * The names this app has already written to people's devices. The product was called
 * admit-one when they were chosen and is Dress Circle now, but these keep the old name:
 * renaming a storage key or a database would quietly empty the wallet, the door's
 * memory and the offline pages on every device that has them. So they are written
 * down once, here, and `persisted-names.test.ts` pins each one. The ticket format,
 * `ao1` in `ticket-token.ts`, stays for the same reason: tickets already issued carry it.
 */
const PREFIX = "admit-one";

/** sessionStorage and localStorage keys. */
export const STORAGE_KEYS = {
  sandbox: (version: number) => `${PREFIX}:sandbox:v${version}`,
  draft: (holdId: string) => `${PREFIX}:draft:${holdId}`,
  queue: (eventSlug: string) => `${PREFIX}:queue:${eventSlug}`,
  organiserSession: `${PREFIX}:organiser-session`,
  doorEvent: `${PREFIX}:door-event`,
} as const;

/** IndexedDB databases. */
export const DATABASES = {
  wallet: `${PREFIX}-wallet`,
  door: `${PREFIX}-door`,
  doorVoids: `${PREFIX}-door-voids`,
} as const;

/**
 * The message that asks the service worker to cache what a ticket needs offline.
 * `public/sw.js` is plain JavaScript and can't import this, so it spells the same
 * string, along with its caches' `admit-one-` prefix; the test checks both.
 */
export const PREPARE_OFFLINE_MESSAGE = `${PREFIX}:prepare-offline`;
