import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * False on the server and while the page hydrates; true once React runs in it. A
 * control whose change only matters once JavaScript has it (a select the page reads
 * from state) waits for this: a choice made on the bare HTML would show on screen and
 * be lost, as the page went on using the old value.
 */
export const useIsInteractive = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
