"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { presets, type PresetId } from "@/server/chaos";
import type { Server } from "@/server/server";

/** The tab's simulated server — loaded lazily, and only in the browser. */
function useSandbox() {
  const [server, setServer] = useState<Server | null>(null);
  useEffect(() => {
    let alive = true;
    import("@/mocks/sandbox").then(({ getServer }) => alive && setServer(getServer()));
    return () => {
      alive = false;
    };
  }, []);
  // Re-render whenever the server changes (it mutates in place, so watch its version).
  useSyncExternalStore(
    (cb) => (server ? server.subscribe(cb) : () => {}),
    () => server?.getVersion() ?? -1,
    () => -1,
  );
  return server;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const kindStyle: Record<string, string> = {
  webhook: "text-accent",
  order: "text-ok",
  crowd: "text-warn",
  warn: "text-bad",
};

/**
 * A control room for the simulated backend. Pick a way for things to go wrong, then
 * go through checkout and watch the app handle it — and the server log explain it.
 */
export function ChaosPanel() {
  const server = useSandbox();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const presetId = server?.getState().presetId ?? "happy";
  const active = presets.find((p) => p.id === presetId)!;
  const log = server ? [...server.getState().log].reverse().slice(0, 40) : [];

  const open = () => {
    setConfirmReset(false);
    dialog.current?.showModal();
  };

  const choose = (id: PresetId) => server?.setPreset(id);

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    server?.reset();
    queryClient.invalidateQueries();
    setConfirmReset(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="press inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm hover:bg-sunk"
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${presetId === "happy" ? "bg-ok" : "bg-accent"}`} />
        <span>
          Chaos<span className="sr-only">:</span> <span className="text-ink-2">{active.label}</span>
        </span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="chaos-title"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(26rem,100vw)] max-w-none overflow-y-auto overscroll-contain border-l border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/30"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="chaos-title" className="font-display text-lg font-semibold">
              Chaos panel
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              Bend the simulated backend, then go through checkout. Applies to the next request.
            </p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="press grid size-10 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-sunk hover:text-ink"
            aria-label="Close chaos panel"
          >
            ✕
          </button>
        </div>

        {/* A floated legend escapes the fieldset border, so it lays out like a normal heading. */}
        <fieldset className="px-5 pb-4">
          <legend className="tabular float-left w-full pt-4 pb-2 text-[11px] tracking-[0.14em] text-ink-3 uppercase">Scenario</legend>
          <div className="clear-left space-y-1.5">
            {presets.map((p) => (
              <label
                key={p.id}
                className={`block cursor-pointer rounded-lg border px-3.5 py-2.5 transition-colors ${
                  p.id === presetId ? "border-accent bg-accent-soft" : "border-line bg-card hover:bg-sunk"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="chaos-preset"
                    value={p.id}
                    checked={p.id === presetId}
                    onChange={() => choose(p.id)}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="text-sm font-medium">{p.label}</span>
                </span>
                <span className="mt-0.5 block pl-6.5 text-sm text-ink-2">{p.description}</span>
                {/* Only the chosen scenario spells out what to expect — keeps the list short
                    enough that the server log stays in view. */}
                {p.id === presetId && <span className="mt-1.5 block pl-6.5 text-xs text-ink-2">Expect: {p.expectation}</span>}
              </label>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby="log-title" className="border-t border-line px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h3 id="log-title" className="tabular text-[11px] tracking-[0.14em] text-ink-3 uppercase">
              Server log
            </h3>
            <button
              type="button"
              onClick={reset}
              className={`press rounded-md px-2.5 py-1 text-xs ${confirmReset ? "bg-bad text-paper" : "text-ink-2 hover:bg-sunk"}`}
            >
              {confirmReset ? "Confirm: reset sandbox" : "Reset sandbox"}
            </button>
          </div>
          <ol tabIndex={0} aria-label="Server log, newest first" className="mt-2 max-h-72 space-y-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
            {log.length === 0 && <li className="text-ink-3">Nothing yet.</li>}
            {log.map((entry) => (
              <li key={entry.id} className="flex gap-2">
                <span className="shrink-0 text-ink-3">{time(entry.at)}</span>
                <span className={kindStyle[entry.kind] ?? "text-ink-2"}>{entry.message}</span>
              </li>
            ))}
          </ol>
        </section>
      </dialog>
    </>
  );
}
