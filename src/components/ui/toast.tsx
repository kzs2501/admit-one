"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Long enough to read twice; the message is never the only place the information lives. */
const TOAST_DURATION_MS = 8_000;

interface Toast {
  title: string;
  detail: string;
}

// One toast at a time: a newer message replaces the older one.
let current: Toast | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Show a short, non-blocking message. Repeating the visible one restarts its timer without re-announcing it. */
export function showToast(title: string, detail: string) {
  current = { title, detail };
  emit();
}

function dismissToast() {
  current = null;
  emit();
}

/**
 * Where toasts appear. Rendered once, near the root. The live region is always in the
 * DOM, so screen readers announce what's put into it — politely, without moving focus.
 */
export function Toaster() {
  const toast = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {toast && (
        <div className="pointer-events-auto flex max-w-md items-start gap-4 rounded-lg border border-line bg-card px-4 py-3 text-sm shadow-lg">
          <div>
            <p className="font-medium">{toast.title}</p>
            <p className="mt-0.5 text-ink-2">{toast.detail}</p>
          </div>
          <button
            type="button"
            onClick={dismissToast}
            className="text-ink-3 underline underline-offset-4 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
