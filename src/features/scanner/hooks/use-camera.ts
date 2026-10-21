import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  /** The person, or the browser's settings, said no. */
  | { kind: "blocked" }
  /** No camera here, or none the page may use. */
  | { kind: "missing" }
  /** Another app has it, or it failed. */
  | { kind: "failed" };

function stateFor(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "blocked" };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { kind: "missing" };
  return { kind: "failed" };
}

/**
 * The back camera, once asked for: the page asks when someone presses start, never on
 * load, so the permission prompt comes with a reason. Stopped when the page goes.
 */
export function useCamera() {
  const [state, setState] = useState<CameraState>({ kind: "off" });
  const stream = useRef<MediaStream | null>(null);

  const release = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  const start = useCallback(async () => {
    // Missing where the page isn't a secure context, whatever the types say.
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (!devices) {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "starting" });
    try {
      const media = await devices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      release();
      stream.current = media;
      setState({ kind: "on", stream: media });
    } catch (error) {
      setState(stateFor(error));
    }
  }, [release]);

  const stop = useCallback(() => {
    release();
    setState({ kind: "off" });
  }, [release]);

  useEffect(() => release, [release]);

  return { state, start, stop };
}
