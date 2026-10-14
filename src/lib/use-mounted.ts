import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: mounting is a one-way change. */
const subscribeToNothing = () => () => {
  // nothing to unsubscribe
};

/**
 * False during server render and hydration, true after. Lets components that depend
 * on browser-only state (sessionStorage drafts, the clock) avoid acting on the empty
 * server snapshot — e.g. a step guard redirecting before the real draft is read.
 */
export const useMounted = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
