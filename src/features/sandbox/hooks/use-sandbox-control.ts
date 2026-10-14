import { useEffect, useState, useSyncExternalStore } from "react";
import { getSandboxControl, type SandboxControl } from "@/backend";

const noSubscription = () => () => {};

/**
 * The tab's sandbox, through the backend's public control port — loaded lazily, and
 * only in the browser. Re-renders whenever the sandbox changes.
 */
export function useSandboxControl(): SandboxControl | null {
  const [control, setControl] = useState<SandboxControl | null>(null);
  useEffect(() => {
    let isCurrent = true;
    void getSandboxControl().then((loaded) => {
      if (isCurrent) setControl(loaded);
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  // The sandbox mutates in place, so watch its version number rather than its state.
  useSyncExternalStore(
    control ? control.subscribe : noSubscription,
    () => control?.getVersion() ?? -1,
    () => -1,
  );
  return control;
}
